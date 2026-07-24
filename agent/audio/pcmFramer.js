// Pure PCM re-framing/serialization logic, decoupled from the real @livekit/rtc-node
// AudioSource so it's unit-testable — see pcmFramer.test.js, which specifically regression-
// tests the concurrency bug this was extracted to fix (see audioPublisher.js's header for
// the full story: fire-and-forget pushPCM calls raced on a shared pending buffer and
// interleaved out of order, corrupting playback into audible static).
export function createPcmFramer({ bytesPerFrame, onFrame }) {
  let pending = Buffer.alloc(0);
  let writeQueue = Promise.resolve();

  async function captureAllFrames() {
    while (pending.length >= bytesPerFrame) {
      const chunk = pending.subarray(0, bytesPerFrame);
      pending = pending.subarray(bytesPerFrame);
      await onFrame(chunk);
    }
  }

  function pushPCM(buffer) {
    pending = pending.length ? Buffer.concat([pending, buffer]) : buffer;
    writeQueue = writeQueue.then(captureAllFrames);
    return writeQueue;
  }

  function flushPending() {
    writeQueue = writeQueue.then(async () => {
      if (pending.length === 0) return;
      const padded = Buffer.concat([pending, Buffer.alloc(bytesPerFrame - pending.length)]);
      pending = Buffer.alloc(0);
      await onFrame(padded);
    });
    return writeQueue;
  }

  function clear() {
    pending = Buffer.alloc(0);
    writeQueue = Promise.resolve();
  }

  function drain() {
    return writeQueue;
  }

  return { pushPCM, flushPending, clear, drain };
}
