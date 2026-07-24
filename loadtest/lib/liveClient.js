// Headless simulated client: joins a room exactly like client/client.js does (same
// POST /session/start route, same LiveKit room), but publishes a pre-recorded PCM clip via
// @livekit/rtc-node instead of a browser mic, and exposes the transcript/assistant
// data-channel events plus raw agent-audio-frame arrivals so callers can time a real round
// trip. Reuses the agent's own audio helpers rather than reimplementing them — see
// SCOPE_OF_WORK_sugarshan_poc.md Part 1: "reusing client/client.js's join logic, headless via
// @livekit/rtc-node instead of a browser."
import { Room, RoomEvent, TrackKind } from "@livekit/rtc-node";
import { createAudioPublisher } from "../../agent/audio/audioPublisher.js";
import { subscribeAudioFrames } from "../../agent/audio/audioBridge.js";

const SAMPLE_RATE = 16000;

// AudioStream yields a continuous stream of frames (including silence/comfort-noise) from the
// moment a track is subscribed, decoupled from whether the remote side has actually sent real
// speech yet — confirmed live: the agent publishes its (initially silent) voice track right
// after joining (agentSession.js), so "first frame received" alone fired ~90ms after publish,
// long before Deepgram could plausibly have even returned a transcript. Filtering for actual
// voiced content fixes this — same amplitude-threshold approach and same threshold value this
// project's own barge-in detection already uses (see CONFIG.md's BARGE_IN_LEVEL_THRESHOLD),
// applied here to the same 0-1 normalized RMS scale.
const AUDIO_LEVEL_THRESHOLD = 0.02;

function rms(int16Data) {
  let sumSquares = 0;
  for (let i = 0; i < int16Data.length; i++) {
    const sample = int16Data[i] / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / int16Data.length);
}

export async function connectSimulatedClient({ serverUrl, userId }) {
  const res = await fetch(`${serverUrl}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`/session/start failed: ${res.status}`);
  const { token, url, roomName } = await res.json();

  const room = new Room();
  const transcriptListeners = [];
  const assistantListeners = [];
  let onAgentFrame = null;

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    let msg;
    try {
      msg = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const ts = performance.now();
    if (topic === "transcript") transcriptListeners.forEach((fn) => fn(msg, ts));
    else if (topic === "assistant") assistantListeners.forEach((fn) => fn(msg, ts));
  });

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    (async () => {
      for await (const frame of subscribeAudioFrames(track, { sampleRate: SAMPLE_RATE, numChannels: 1 })) {
        if (onAgentFrame && rms(frame.data) > AUDIO_LEVEL_THRESHOLD) onAgentFrame(performance.now());
      }
    })().catch(() => {
      // Track ends naturally on disconnect — nothing to surface.
    });
  });

  await room.connect(url, token, { autoSubscribe: true });
  const publisher = await createAudioPublisher(room, { sampleRate: SAMPLE_RATE, numChannels: 1 });

  return {
    roomName,
    async publishClip(pcmBuffer) {
      await publisher.pushPCM(pcmBuffer);
      await publisher.flushPending();
    },
    onTranscript(fn) {
      transcriptListeners.push(fn);
    },
    onAssistant(fn) {
      assistantListeners.push(fn);
    },
    setOnAgentFrame(fn) {
      onAgentFrame = fn;
    },
    async disconnect() {
      await publisher.close();
      await room.disconnect();
    },
  };
}
