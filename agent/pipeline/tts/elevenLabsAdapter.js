// ElevenLabs streaming-input TTS adapter — connects directly to the raw streaming-input
// WebSocket endpoint. @elevenlabs/elevenlabs-js has no convenient client-class wrapper for
// this specific resource (unlike Deepgram's client.listen.v1.connect()), so this talks to
// the socket directly using Node's native WebSocket global.
//
// Wire-level field names (NOT the SDK's TS camelCase names) were verified against the SDK's
// own generated serialization mappers
// (node_modules/@elevenlabs/elevenlabs-js/serialization/types/{InitializeConnection,SendText}.js):
// xiApiKey -> "xi-api-key" (hyphenated, not xi_api_key), flush/text unchanged. AudioOutput's
// `audio`/FinalOutput's `isFinal` are unchanged on the wire.
//
// output_format is pinned to raw PCM (pcm_<sampleRate>) rather than the default MP3, so audio
// bytes can be fed straight into @livekit/rtc-node's AudioSource without an MP3 decoder.
//
// Deliberately synchronous (no async connect) and buffers sends issued before the socket
// actually opens, flushing them in order once it does — this avoids an async race where a
// barge-in arrives during the open handshake and has nothing to call .stop() on yet.
export function createElevenLabsTTS({
  apiKey,
  voiceId,
  model = "eleven_flash_v2_5",
  sampleRate = 16000,
  onAudioChunk, // (Buffer of raw PCM16 mono samples) => void
  onDone, // () => void, fired on FinalOutput
  onError,
  createSocket = (url) => new WebSocket(url),
} = {}) {
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}&output_format=pcm_${sampleRate}`;
  const socket = createSocket(url);
  let open = false;
  let stopped = false;
  const queue = [];

  socket.addEventListener(
    "open",
    () => {
      if (stopped) {
        socket.close();
        return;
      }
      open = true;
      socket.send(JSON.stringify({ text: " ", "xi-api-key": apiKey }));
      for (const obj of queue.splice(0)) socket.send(JSON.stringify(obj));
    },
    { once: true }
  );

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      onError?.(err);
      return;
    }
    if (msg.error || msg.message) {
      // ElevenLabs reports application-level failures (auth, plan/permission limits, bad
      // voice_id, etc.) as a normal message over an already-open socket — not as a WS
      // 'error' event or a non-1000 close — so they must be checked for explicitly here.
      // Missing this originally caused a real silent failure: the socket opened fine, this
      // message arrived, and nothing surfaced it anywhere.
      onError?.(new Error(`ElevenLabs error (${msg.code ?? msg.error}): ${msg.message ?? msg.error}`));
      return;
    }
    if (msg.audio) onAudioChunk?.(Buffer.from(msg.audio, "base64"));
    if (msg.isFinal) onDone?.();
  });

  socket.addEventListener("error", (event) => {
    onError?.(event?.error ?? new Error("elevenlabs websocket error"));
  });

  function send(obj) {
    if (stopped) return;
    if (open) socket.send(JSON.stringify(obj));
    else queue.push(obj);
  }

  return {
    sendText(text) {
      send({ text: `${text} ` });
    },
    flush() {
      send({ text: " ", flush: true });
    },
    stop() {
      stopped = true;
      if (open) {
        try {
          socket.send(JSON.stringify({ text: "" }));
        } catch {
          // socket already closing — fine, we're shutting down anyway
        }
        socket.close();
      }
      // if not yet open, the 'open' handler above sees `stopped` and closes immediately
    },
  };
}
