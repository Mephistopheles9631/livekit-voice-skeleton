// Pure turn-orchestration logic: accumulates STT transcripts into utterances, runs each
// through the LLM streamed straight into TTS, publishes the resulting audio, and handles
// barge-in (abort everything in-flight if a new transcript arrives while THINKING or
// SPEAKING). Deliberately decoupled from the live LiveKit Room/audio-track specifics in
// agentSession.js so it's unit-testable with fake STT/LLM/TTS adapters — see
// turnOrchestrator.test.js.
//
// Known simplification vs. the original design (documented, not silent — see
// PROJECT_SPEC.md Phase 4): barge-in during SPEAKING triggers on any new transcript alone,
// without the RMS-level corroboration originally planned. Deepgram already filters most
// non-speech noise itself; adding a second corroboration signal was deferred until real
// testing shows it's actually needed, rather than building it pre-emptively.
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { STATES } from "./state/turnState.js";
import { createTurnTrace } from "./trace/turnTrace.js";

let turnCounter = 0;

export function createTurnOrchestrator({
  turnState,
  llm,
  tts,
  audioPublisher,
  broadcast,
  roomName,
  onError = () => {},
}) {
  let utteranceBuffer = "";
  let activeStream = null; // in-flight Claude MessageStream
  let activeTTS = null; // in-flight ElevenLabs connection handle
  let activeTrace = null;

  // Deepgram's own speech-start detection (vad_events) — the closest available
  // approximation of "mic input arrived" (see turnTrace.js's honesty note: this is not a
  // literal hardware mic timestamp). Wired separately from handleTranscript because it's a
  // distinct Deepgram message type, not part of the transcript stream.
  function handleSpeechStarted() {
    if (turnState.get() === STATES.LISTENING && !activeTrace) {
      activeTrace = createTurnTrace(`turn-${++turnCounter}`, roomName);
      activeTrace.mark("speech_started");
    }
  }

  function handleBargeIn() {
    const state = turnState.get();
    if (state !== STATES.THINKING && state !== STATES.SPEAKING) return;

    activeStream?.abort();
    activeStream = null;

    activeTTS?.stop();
    activeTTS = null;

    audioPublisher.clear();

    turnState.transition(STATES.LISTENING);
    broadcast("assistant", { event: "end", interrupted: true });
    activeTrace?.finish({ interrupted: true });
    activeTrace = null;
  }

  function runTurn(userText) {
    turnState.transition(STATES.THINKING);
    broadcast("assistant", { event: "start" });

    // Falls back to creating a fresh trace here if speech_started was never seen (e.g. if
    // Deepgram's vad_events signal was missed) — degrades gracefully to a shorter trace
    // rather than losing tracing for the turn entirely.
    const trace = activeTrace ?? createTurnTrace(`turn-${++turnCounter}`, roomName);
    activeTrace = trace;
    trace.mark("stt_final");

    let ttsStarted = false;
    const myTTS = tts.connect({
      onAudioChunk: (buf) => {
        if (!ttsStarted) {
          ttsStarted = true;
          trace.mark("tts_first_byte");
          trace.mark("tts_first_frame_captured");
          if (turnState.get() === STATES.THINKING) turnState.transition(STATES.SPEAKING);
        }
        audioPublisher.pushPCM(buf).catch(onError);
      },
      onDone: () => {
        audioPublisher.flushPending().catch(onError);
      },
      onError,
    });
    activeTTS = myTTS;

    let firstTokenSeen = false;
    const myStream = llm.generate({
      messages: [{ role: "user", content: userText }],
      onToken: (delta) => {
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          trace.mark("llm_first_token");
        }
        broadcast("assistant", { event: "delta", text: delta });
        myTTS.sendText(delta);
      },
      onError,
    });
    activeStream = myStream;

    return myStream
      .finalMessage()
      .then(() => {
        trace.mark("llm_complete");
        myTTS.flush();
      })
      .catch((err) => {
        if (!(err instanceof APIUserAbortError)) onError(err);
      })
      .finally(() => {
        // If a barge-in already superseded this turn, activeStream was reassigned (to null,
        // or to a newer turn's stream) — skip all completion side effects so we don't
        // double-fire an "end" event or clobber the newer turn's state.
        if (activeStream !== myStream) return;
        activeStream = null;
        activeTTS = null;
        activeTrace = null;
        if (turnState.get() === STATES.THINKING || turnState.get() === STATES.SPEAKING) {
          turnState.transition(STATES.LISTENING);
        }
        broadcast("assistant", { event: "end", interrupted: false });
        trace.finish({ interrupted: false });
      });
  }

  function handleTranscript(t) {
    broadcast("transcript", t);
    handleBargeIn();

    if (t.isFinal) {
      utteranceBuffer += (utteranceBuffer ? " " : "") + t.text;
    }

    let pending;
    if (t.speechFinal && utteranceBuffer.trim() && turnState.get() === STATES.LISTENING) {
      const text = utteranceBuffer.trim();
      utteranceBuffer = "";
      pending = runTurn(text);
    }
    return pending;
  }

  function abortActive() {
    activeStream?.abort();
    activeTTS?.stop();
  }

  return { handleTranscript, handleSpeechStarted, abortActive };
}
