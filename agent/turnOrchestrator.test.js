// Tests the barge-in mechanism and turn-triggering logic against fake STT/LLM/TTS adapters
// — no real network/API keys needed. This is exactly the "orchestration logic correct
// against a documented/mocked vendor contract" category described in TESTING.md; it does
// NOT prove barge-in sounds clean, that real audio plays correctly, or that the real vendor
// SDKs' streaming behavior matches these fakes' shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { createTurnOrchestrator } from "./turnOrchestrator.js";
import { createTurnState, STATES } from "./state/turnState.js";

function createFakeLLM() {
  const streams = [];
  return {
    streams,
    generate({ onToken }) {
      let resolveFinal, rejectFinal;
      const finalPromise = new Promise((resolve, reject) => {
        resolveFinal = resolve;
        rejectFinal = reject;
      });
      const stream = {
        aborted: false,
        emitToken: (text) => onToken(text),
        resolve: () => resolveFinal({}),
        abort() {
          stream.aborted = true;
          rejectFinal(new APIUserAbortError({ message: "aborted for test" }));
        },
        finalMessage: () => finalPromise,
      };
      streams.push(stream);
      return stream;
    },
  };
}

function createFakeTTS() {
  const connections = [];
  return {
    connections,
    connect({ onAudioChunk, onDone }) {
      const conn = {
        stopped: false,
        sentText: [],
        flushed: false,
        emitAudio: (buf) => onAudioChunk(buf),
        emitDone: () => onDone(),
        sendText(t) {
          conn.sentText.push(t);
        },
        flush() {
          conn.flushed = true;
        },
        stop() {
          conn.stopped = true;
        },
      };
      connections.push(conn);
      return conn;
    },
  };
}

function createFakeAudioPublisher() {
  const pushed = [];
  let clearedCount = 0;
  let flushedCount = 0;
  return {
    pushed,
    get clearedCount() {
      return clearedCount;
    },
    get flushedCount() {
      return flushedCount;
    },
    async pushPCM(buf) {
      pushed.push(buf);
    },
    async flushPending() {
      flushedCount++;
    },
    clear() {
      clearedCount++;
    },
    async close() {},
  };
}

function createRecordingBroadcast() {
  const events = [];
  const fn = (topic, payload) => events.push({ topic, payload });
  fn.events = events;
  return fn;
}

function setup(initialState = STATES.LISTENING) {
  const turnState = createTurnState(initialState);
  const llm = createFakeLLM();
  const tts = createFakeTTS();
  const audioPublisher = createFakeAudioPublisher();
  const broadcast = createRecordingBroadcast();
  const orchestrator = createTurnOrchestrator({
    turnState,
    llm,
    tts,
    audioPublisher,
    broadcast,
    roomName: "test-room",
  });
  return { turnState, llm, tts, audioPublisher, broadcast, orchestrator };
}

test("a final speechFinal transcript while LISTENING starts a turn: LLM tokens forward to TTS, state ends back at LISTENING", async () => {
  const { turnState, llm, tts, broadcast, orchestrator } = setup();

  const pending = orchestrator.handleTranscript({
    text: "hello there",
    isFinal: true,
    speechFinal: true,
  });
  assert.equal(turnState.get(), STATES.THINKING, "should start THINKING immediately");
  assert.equal(llm.streams.length, 1);
  assert.equal(tts.connections.length, 1, "a TTS connection should be opened for the turn");

  llm.streams[0].emitToken("Hi");
  assert.deepEqual(tts.connections[0].sentText, ["Hi"], "LLM tokens are forwarded to TTS as they arrive");

  llm.streams[0].resolve();
  await pending;

  assert.equal(turnState.get(), STATES.LISTENING);
  assert.equal(tts.connections[0].flushed, true, "TTS should be flushed once the LLM finishes");
  const assistantEvents = broadcast.events.filter((e) => e.topic === "assistant");
  assert.deepEqual(
    assistantEvents.map((e) => e.payload.event),
    ["start", "delta", "end"]
  );
  assert.equal(assistantEvents.at(-1).payload.interrupted, false);
});

test("state transitions to SPEAKING on the first TTS audio chunk", async () => {
  const { turnState, llm, tts, audioPublisher, orchestrator } = setup();

  orchestrator.handleTranscript({ text: "hi", isFinal: true, speechFinal: true });
  assert.equal(turnState.get(), STATES.THINKING);

  tts.connections[0].emitAudio(Buffer.from([1, 2, 3, 4]));
  assert.equal(turnState.get(), STATES.SPEAKING);
  assert.equal(audioPublisher.pushed.length, 1);

  llm.streams[0].resolve();
});

test("TTS reporting done flushes any trailing partial frame", () => {
  const { audioPublisher, tts, orchestrator } = setup();

  orchestrator.handleTranscript({ text: "hi", isFinal: true, speechFinal: true });
  tts.connections[0].emitAudio(Buffer.from([1, 2]));
  assert.equal(audioPublisher.flushedCount, 0);

  tts.connections[0].emitDone();
  assert.equal(audioPublisher.flushedCount, 1);
});

test("interim (non-final) transcripts do not start a turn", () => {
  const { turnState, llm, tts, orchestrator } = setup();

  orchestrator.handleTranscript({ text: "hello", isFinal: false, speechFinal: false });

  assert.equal(turnState.get(), STATES.LISTENING);
  assert.equal(llm.streams.length, 0);
  assert.equal(tts.connections.length, 0);
});

test("barge-in during THINKING aborts the LLM stream, stops TTS, and returns to LISTENING", async () => {
  const { turnState, llm, tts, broadcast, orchestrator } = setup();

  const firstTurn = orchestrator.handleTranscript({
    text: "tell me a long story",
    isFinal: true,
    speechFinal: true,
  });
  assert.equal(turnState.get(), STATES.THINKING);

  orchestrator.handleTranscript({ text: "wait", isFinal: false, speechFinal: false });

  assert.equal(turnState.get(), STATES.LISTENING, "barge-in returns to LISTENING immediately");
  assert.equal(llm.streams[0].aborted, true);
  assert.equal(tts.connections[0].stopped, true);

  await firstTurn; // let the aborted promise settle, should not throw or double-fire events

  const assistantEvents = broadcast.events.filter((e) => e.topic === "assistant");
  const endEvents = assistantEvents.filter((e) => e.payload.event === "end");
  assert.equal(endEvents.length, 1, "the aborted turn's own completion handler must not also fire an end event");
  assert.equal(endEvents[0].payload.interrupted, true);
});

test("barge-in during SPEAKING (audio already playing) also aborts and clears the audio queue", async () => {
  const { turnState, llm, tts, audioPublisher, broadcast, orchestrator } = setup();

  const firstTurn = orchestrator.handleTranscript({
    text: "here is a story",
    isFinal: true,
    speechFinal: true,
  });
  tts.connections[0].emitAudio(Buffer.from([9, 9]));
  assert.equal(turnState.get(), STATES.SPEAKING);

  orchestrator.handleTranscript({ text: "stop", isFinal: false, speechFinal: false });

  assert.equal(turnState.get(), STATES.LISTENING);
  assert.equal(audioPublisher.clearedCount, 1, "queued-but-unplayed audio frames must be dropped");
  assert.equal(tts.connections[0].stopped, true);
  assert.equal(llm.streams[0].aborted, true);

  await firstTurn;
  const endEvents = broadcast.events.filter((e) => e.topic === "assistant" && e.payload.event === "end");
  assert.equal(endEvents.length, 1);
  assert.equal(endEvents[0].payload.interrupted, true);
});

test("barge-in does not fire while LISTENING — nothing is generating to interrupt", () => {
  const { turnState, llm, tts, audioPublisher, orchestrator } = setup();

  orchestrator.handleTranscript({ text: "hey", isFinal: false, speechFinal: false });
  orchestrator.handleTranscript({ text: "hey again", isFinal: false, speechFinal: false });

  assert.equal(llm.streams.length, 0);
  assert.equal(tts.connections.length, 0);
  assert.equal(audioPublisher.clearedCount, 0);
  assert.equal(turnState.get(), STATES.LISTENING);
});

test("handleSpeechStarted seeds the next turn's trace with a speech_started mark", async () => {
  const { llm, orchestrator } = setup();
  const originalLog = console.log;
  let logged = null;
  console.log = (line) => {
    logged = line;
  };
  try {
    orchestrator.handleSpeechStarted();
    const pending = orchestrator.handleTranscript({ text: "hi", isFinal: true, speechFinal: true });
    llm.streams[0].resolve();
    await pending;
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(logged);
  assert.ok("speech_started" in parsed.marksFromStartMs);
  assert.ok("stt_final" in parsed.marksFromStartMs);
});

test("every transcript, interim or final, is broadcast on the transcript topic", () => {
  const { orchestrator, broadcast } = setup();

  orchestrator.handleTranscript({ text: "partial", isFinal: false, speechFinal: false });

  const transcriptEvents = broadcast.events.filter((e) => e.topic === "transcript");
  assert.equal(transcriptEvents.length, 1);
  assert.equal(transcriptEvents[0].payload.text, "partial");
});
