// Regression coverage for the real concurrency bug found live-testing Phase 4 (see
// audioPublisher.js's header comment): fire-and-forget pushPCM calls raced on the shared
// pending-bytes buffer and could interleave frame-capture calls out of order, corrupting
// synthesized speech into audible static. The critical assertion here is
// "onFrame is never re-entered while a previous call is still in flight" — that's exactly
// the property whose absence caused the bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPcmFramer } from "./pcmFramer.js";

const BYTES_PER_FRAME = 4; // small, for easy test bookkeeping

function createRecordingFrameSink({ delayMs = 0 } = {}) {
  const frames = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  return {
    frames,
    get maxConcurrent() {
      return maxConcurrent;
    },
    async onFrame(chunk) {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      frames.push(Buffer.from(chunk)); // copy — chunk is a view that gets recycled
      inFlight--;
    },
  };
}

test("frames are captured in order with correct bytes for a single push", async () => {
  const sink = createRecordingFrameSink();
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  await framer.pushPCM(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

  assert.equal(sink.frames.length, 2);
  assert.deepEqual([...sink.frames[0]], [1, 2, 3, 4]);
  assert.deepEqual([...sink.frames[1]], [5, 6, 7, 8]);
});

test("a chunk smaller than one frame is buffered, not dropped, and completed by the next push", async () => {
  const sink = createRecordingFrameSink();
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  await framer.pushPCM(Buffer.from([1, 2]));
  assert.equal(sink.frames.length, 0, "not enough bytes for a full frame yet");

  await framer.pushPCM(Buffer.from([3, 4, 5, 6]));
  assert.equal(sink.frames.length, 1);
  assert.deepEqual([...sink.frames[0]], [1, 2, 3, 4]);
});

test("concurrent fire-and-forget pushPCM calls never overlap onFrame, and preserve exact byte order", async () => {
  // delayMs makes the bug reproducible on demand: without serialization, a second pushPCM
  // call's synchronous buffer-append would race the first call's still-pending onFrame await.
  const sink = createRecordingFrameSink({ delayMs: 5 });
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  const original = Buffer.from(Array.from({ length: 40 }, (_, i) => i)); // 0..39
  const chunks = [];
  for (let i = 0; i < original.length; i += 3) chunks.push(original.subarray(i, i + 3));

  // Deliberately NOT awaited per-call — this is exactly the fire-and-forget pattern in
  // turnOrchestrator.js's onAudioChunk handler that triggered the real bug.
  const pending = chunks.map((c) => framer.pushPCM(c));
  await Promise.all(pending);

  assert.equal(sink.maxConcurrent, 1, "onFrame must never be re-entered while still in flight");
  const reassembled = Buffer.concat(sink.frames);
  assert.ok(reassembled.equals(original.subarray(0, reassembled.length)), "byte order must be preserved exactly");
});

test("flushPending pads a trailing partial frame with silence instead of dropping it", async () => {
  const sink = createRecordingFrameSink();
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  await framer.pushPCM(Buffer.from([9, 9]));
  await framer.flushPending();

  assert.equal(sink.frames.length, 1);
  assert.deepEqual([...sink.frames[0]], [9, 9, 0, 0], "padded with zero bytes to complete the frame");
});

test("flushPending is a no-op when there's nothing pending", async () => {
  const sink = createRecordingFrameSink();
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  await framer.pushPCM(Buffer.from([1, 2, 3, 4])); // exactly one frame, nothing left pending
  await framer.flushPending();

  assert.equal(sink.frames.length, 1, "flush must not emit a spurious empty/silent frame");
});

test("clear() discards pending unflushed bytes so they don't leak into the next utterance", async () => {
  const sink = createRecordingFrameSink();
  const framer = createPcmFramer({ bytesPerFrame: BYTES_PER_FRAME, onFrame: sink.onFrame });

  await framer.pushPCM(Buffer.from([1, 2])); // buffered, incomplete
  framer.clear();
  await framer.pushPCM(Buffer.from([9, 9, 9, 9]));

  assert.equal(sink.frames.length, 1);
  assert.deepEqual([...sink.frames[0]], [9, 9, 9, 9], "the pre-clear partial bytes must not resurface");
});
