// Regression test for a real bug found live-testing Phase 4 (see audioPublisher.js's header
// comment for the full story): @livekit/rtc-node's AudioFrame.protoInfo() serializes frame
// data via `new Uint8Array(this.data.buffer)`, which reads from byte 0 of the underlying
// ArrayBuffer and ignores the Int16Array's own byteOffset. A raw *view* into a shared buffer
// (via subarray) therefore silently resends whichever frame happens to sit at byte 0 of that
// buffer, not its own data — every frame after the first one sliced from the same underlying
// buffer was corrupted this way. This doesn't touch the real native SDK; it verifies the
// browser/Node TypedArray semantics the fix (and the bug) actually depend on.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors AudioFrame.protoInfo()'s exact behavior — see
// node_modules/@livekit/rtc-node/dist/audio_frame.js.
function simulateNativeSerialization(int16Array) {
  return new Uint8Array(int16Array.buffer).slice(0, int16Array.byteLength);
}

// Buffer.from()/Buffer.concat() can return small buffers backed by Node's shared internal
// allocation pool, where byteOffset depends on unrelated allocations elsewhere in the
// process — not deterministic enough for a test. allocUnsafeSlow forces a real, dedicated,
// byteOffset-0 allocation, isolating the test from that.
function makeUnpooledBuffer(bytes) {
  const buf = Buffer.allocUnsafeSlow(bytes.length);
  Buffer.from(bytes).copy(buf);
  return buf;
}

test("BUG: a raw view (subarray) into a shared buffer serializes the wrong frame's bytes", () => {
  const shared = makeUnpooledBuffer([10, 10, 20, 20, 30, 30, 40, 40]);
  const frame1 = new Int16Array(shared.buffer, shared.byteOffset, 2); // bytes [0,4)
  const frame2 = new Int16Array(shared.buffer, shared.byteOffset + 4, 2); // bytes [4,8)

  const sent1 = simulateNativeSerialization(frame1);
  const sent2 = simulateNativeSerialization(frame2);

  assert.deepEqual([...sent1], [10, 10, 20, 20], "frame1 happens to be correct (byteOffset 0)");
  // this is the bug: frame2's own bytes are [30,30,40,40], but ignoring byteOffset resends frame1's
  assert.deepEqual([...sent2], [10, 10, 20, 20], "demonstrates the corruption: frame2 wrongly matches frame1");
});

test("FIX: .slice() copies into a fresh buffer at byteOffset 0, serializing correctly", () => {
  const shared = makeUnpooledBuffer([10, 10, 20, 20, 30, 30, 40, 40]);
  const frame1 = new Int16Array(shared.buffer, shared.byteOffset, 2).slice();
  const frame2 = new Int16Array(shared.buffer, shared.byteOffset + 4, 2).slice();

  assert.equal(frame1.byteOffset, 0);
  assert.equal(frame2.byteOffset, 0);

  const sent1 = simulateNativeSerialization(frame1);
  const sent2 = simulateNativeSerialization(frame2);

  assert.deepEqual([...sent1], [10, 10, 20, 20]);
  assert.deepEqual([...sent2], [30, 30, 40, 40], "frame2 now correctly serializes its own bytes");
});
