// Subscribes to a remote (human) audio track and yields PCM frames resampled to a target
// format (default 16kHz mono — matches what deepgramAdapter.js declares to Deepgram).
// @livekit/rtc-node's AudioStream does the resampling itself; we just declare the target.
// AudioStream extends the standard web ReadableStream, which Node supports iterating with
// `for await` natively (verified at agent-build time against the installed Node version).
import { AudioStream } from "@livekit/rtc-node";

export async function* subscribeAudioFrames(track, { sampleRate = 16000, numChannels = 1 } = {}) {
  const stream = new AudioStream(track, { sampleRate, numChannels });
  for await (const frame of stream) {
    yield frame;
  }
}
