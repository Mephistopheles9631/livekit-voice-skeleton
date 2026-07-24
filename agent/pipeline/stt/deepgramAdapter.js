// Deepgram streaming STT adapter. API verified directly against the installed
// @deepgram/sdk@5.7.0 source (its own README described an older/different shape) —
// see node_modules/@deepgram/sdk/dist/cjs/api/resources/listen/resources/v1/client/Socket.d.ts.
//
// The connection is opened once per session and stays open for the session's whole
// lifetime (including while the agent is speaking, once Phase 4 lands) — never
// reconnected per turn, since reconnect latency would directly hurt round-trip time.
import { DeepgramClient } from "@deepgram/sdk";

// sampleRate/channels here must match what agent/audio/audioBridge.js requests from
// @livekit/rtc-node's AudioStream — Deepgram needs these declared explicitly for raw
// linear16 PCM, which has no self-describing header (unlike compressed formats).
export async function createDeepgramSTT({
  apiKey,
  model = "nova-3",
  sampleRate = 16000,
  channels = 1,
  onOpen,
  onTranscript,
  onSpeechStarted,
  onError,
  onClose,
  createClient = (opts) => new DeepgramClient(opts),
} = {}) {
  const client = createClient({ apiKey });

  const connection = await client.listen.v1.connect({
    model,
    language: "en",
    encoding: "linear16",
    sample_rate: sampleRate,
    channels,
    punctuate: "true",
    interim_results: "true",
    smart_format: "true",
    vad_events: "true",
  });

  connection.on("open", () => onOpen?.());
  connection.on("error", (err) => onError?.(err));
  connection.on("close", (event) => onClose?.(event));
  connection.on("message", (data) => {
    if (data?.type === "SpeechStarted") {
      onSpeechStarted?.();
      return;
    }
    if (data?.type !== "Results") return;
    const alt = data.channel?.alternatives?.[0];
    if (!alt || !alt.transcript) return;
    onTranscript?.({
      text: alt.transcript,
      isFinal: Boolean(data.is_final),
      speechFinal: Boolean(data.speech_final),
    });
  });

  connection.connect();
  await connection.waitForOpen();

  return {
    sendAudio(int16Data) {
      // int16Data: Int16Array of raw PCM samples from an AudioFrame
      connection.sendMedia(int16Data.buffer);
    },
    stop() {
      connection.close();
    },
  };
}
