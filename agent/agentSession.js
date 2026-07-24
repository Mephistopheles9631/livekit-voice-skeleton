// Per-room agent: joins the LiveKit room as a bot participant, subscribes to the human's
// audio, streams it to Deepgram (Phase 2), and — once the user finishes an utterance — runs
// it through Claude and ElevenLabs via turnOrchestrator.js (Phase 3/4), which also owns the
// barge-in mechanism (see that file's header comment). The bot mints its own AccessToken
// locally (same LIVEKIT_API_KEY/SECRET already in this process's env) rather than receiving
// one over the internal API call, so /agent/join only ever needs a bare roomName.
import { Room, RoomEvent, TrackKind } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { createTurnState, STATES } from "./state/turnState.js";
import { subscribeAudioFrames } from "./audio/audioBridge.js";
import { createAudioPublisher } from "./audio/audioPublisher.js";
import { createDeepgramSTT } from "./pipeline/stt/deepgramAdapter.js";
import { createClaudeLLM } from "./pipeline/llm/claudeAdapter.js";
import { createElevenLabsTTS } from "./pipeline/tts/elevenLabsAdapter.js";
import { createTurnOrchestrator } from "./turnOrchestrator.js";

const SAMPLE_RATE = 16000;

export async function createAgentSession({ roomName, env, onEnded }) {
  const room = new Room();
  const turnState = createTurnState();
  const llm = createClaudeLLM({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL });
  const tts = {
    connect: (opts) =>
      createElevenLabsTTS({
        apiKey: env.ELEVENLABS_API_KEY,
        voiceId: env.ELEVENLABS_VOICE_ID,
        model: env.ELEVENLABS_MODEL,
        sampleRate: SAMPLE_RATE,
        ...opts,
      }),
  };

  let stt = null;
  let audioPublisher = null;

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: `agent-${roomName}`,
    ttl: "6h",
  });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  function broadcast(topic, payload) {
    if (!room.localParticipant) return;
    const data = new TextEncoder().encode(JSON.stringify(payload));
    room.localParticipant
      .publishData(data, { reliable: true, topic })
      .catch((err) => console.error(`[agent:${roomName}] publishData failed`, err));
  }

  const orchestrator = createTurnOrchestrator({
    turnState,
    llm,
    tts,
    // audioPublisher isn't ready until after room.connect() below; handleTranscript/
    // handleSpeechStarted are only ever invoked from STT messages, which can't arrive
    // before that point (the audio bridge itself only starts after TrackSubscribed, which
    // can't fire before connect()), so this indirection is safe.
    audioPublisher: {
      pushPCM: (buf) => audioPublisher.pushPCM(buf),
      flushPending: () => audioPublisher.flushPending(),
      clear: () => audioPublisher.clear(),
    },
    broadcast,
    roomName,
    onError: (err) => {
      console.error(`[agent:${roomName}] pipeline error`, err);
      // Surface to the client too — a pipeline failure (e.g. TTS auth/plan errors) used to
      // fail completely silently from the user's perspective (audio just never played, no
      // error visible anywhere but the server log) until this was added.
      broadcast("assistant", { event: "error", message: err.message });
    },
  });

  async function handleAudioTrack(track) {
    stt = await createDeepgramSTT({
      apiKey: env.DEEPGRAM_API_KEY,
      model: env.DEEPGRAM_MODEL,
      sampleRate: SAMPLE_RATE,
      onTranscript: orchestrator.handleTranscript,
      onSpeechStarted: orchestrator.handleSpeechStarted,
      onError: (err) => console.error(`[agent:${roomName}] deepgram error`, err),
      onClose: () => console.log(`[agent:${roomName}] deepgram connection closed`),
    });

    for await (const frame of subscribeAudioFrames(track, { sampleRate: SAMPLE_RATE, numChannels: 1 })) {
      stt.sendAudio(frame.data);
    }
  }

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === TrackKind.KIND_AUDIO) {
      handleAudioTrack(track).catch((err) =>
        console.error(`[agent:${roomName}] audio bridge error`, err)
      );
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (room.remoteParticipants.size === 0) {
      leave().catch((err) => console.error(`[agent:${roomName}] auto-leave failed`, err));
    }
  });

  await room.connect(env.LIVEKIT_URL, token, { autoSubscribe: true });
  audioPublisher = await createAudioPublisher(room, { sampleRate: SAMPLE_RATE, numChannels: 1 });
  turnState.transition(STATES.LISTENING);
  console.log(`[agent:${roomName}] joined, listening`);

  async function leave() {
    orchestrator.abortActive();
    stt?.stop();
    await audioPublisher?.close();
    await room.disconnect();
    onEnded?.(roomName);
  }

  return { roomName, turnState, leave };
}
