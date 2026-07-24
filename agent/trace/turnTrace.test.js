import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnTrace } from "./turnTrace.js";

function captureLog(fn) {
  const original = console.log;
  let logged = null;
  console.log = (line) => {
    logged = line;
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logged;
}

test("finish() logs nothing if no marks were recorded", () => {
  const logged = captureLog(() => createTurnTrace("t1", "room1").finish());
  assert.equal(logged, null);
});

test("finish() computes deltas from the first mark and logs one JSON line", () => {
  const logged = captureLog(() => {
    const trace = createTurnTrace("t1", "room1");
    trace.mark("a");
    trace.mark("b");
    trace.finish({ interrupted: false });
  });

  assert.ok(logged);
  const parsed = JSON.parse(logged);
  assert.equal(parsed.event, "turn_trace");
  assert.equal(parsed.turnId, "t1");
  assert.equal(parsed.roomName, "room1");
  assert.equal(parsed.interrupted, false);
  assert.equal(parsed.marksFromStartMs.a, 0, "the first mark is the zero point");
  assert.ok(parsed.marksFromStartMs.b >= 0);
  assert.ok(parsed.totalMs >= 0);
});
