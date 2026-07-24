// Publishes the agent's synthesized voice into the room as its own audio track. TTS audio
// arrives in arbitrarily-sized chunks (whatever ElevenLabs happens to send); pcmFramer.js
// re-slices it into small fixed-duration frames (default 20ms) before handing each to
// AudioSource — per PROJECT_SPEC.md's barge-in design, keeping frames small bounds the
// audible "tail" after an interrupt, since a frame already captured is already in flight
// over WebRTC and can't be recalled, but clearQueue() can drop everything not yet captured.
//
// Two real bugs found live-testing:
// 1. Audio came out as static: the original version called AudioSource.captureFrame()
//    directly inside pushPCM without serializing concurrent calls — two TTS chunks arriving
//    close together (confirmed landing within microseconds of each other in the turn trace
//    logs) raced on a shared pending-bytes buffer and interleaved captureFrame() calls out
//    of order. The serialization fix lives in pcmFramer.js, decoupled from the real
//    AudioSource specifically so it has real regression test coverage (pcmFramer.test.js)
//    instead of only having been caught by ear.
// 2. After fixing #1, audio played back at ~10x speed. Root cause, confirmed by reading
//    node_modules/@livekit/rtc-node/dist/audio_frame.js directly: AudioFrame.protoInfo()
//    serializes frame data via `new Uint8Array(this.data.buffer)`, which reads from byte 0
//    of the underlying ArrayBuffer and completely ignores the Int16Array's own byteOffset.
//    Every frame here was a *view* into pcmFramer's shared pending buffer (sliced via
//    subarray, not copied) — so every frame after the first one taken from the same
//    underlying buffer silently resent the FIRST frame's bytes instead of its own. Most of
//    the actual audio content was being discarded and replaced with repeats, all packed into
//    the same declared duration — which is exactly what "correct speech, compressed in time"
//    sounds like. Fixed below with `.slice()`, which (unlike `.subarray()`) copies into a
//    fresh, standalone ArrayBuffer at byteOffset 0.
import { AudioSource, LocalAudioTrack, AudioFrame, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { createPcmFramer } from "./pcmFramer.js";

const BYTES_PER_SAMPLE = 2; // Int16 PCM

export async function createAudioPublisher(room, { sampleRate = 16000, numChannels = 1, frameMs = 20 } = {}) {
  const source = new AudioSource(sampleRate, numChannels);
  const track = LocalAudioTrack.createAudioTrack("agent-voice", source);
  await room.localParticipant.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })
  );

  const samplesPerFrame = Math.round((sampleRate * frameMs) / 1000);
  const bytesPerFrame = samplesPerFrame * BYTES_PER_SAMPLE * numChannels;

  const framer = createPcmFramer({
    bytesPerFrame,
    onFrame: (chunk) => {
      const view = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / BYTES_PER_SAMPLE);
      const int16 = view.slice(); // copy — see header comment; a raw view here silently
      // resends whatever's at byte 0 of the shared underlying buffer, not this frame's data.
      return source.captureFrame(new AudioFrame(int16, sampleRate, numChannels, samplesPerFrame));
    },
  });

  function clear() {
    framer.clear();
    source.clearQueue();
  }

  async function close() {
    await framer.drain().catch(() => {});
    await track.close(true); // true: also close the underlying AudioSource
  }

  return { pushPCM: framer.pushPCM, flushPending: framer.flushPending, clear, close };
}
