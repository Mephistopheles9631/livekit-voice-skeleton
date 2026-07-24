import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnState, STATES } from "./turnState.js";

test("starts IDLE by default", () => {
  const ts = createTurnState();
  assert.equal(ts.get(), STATES.IDLE);
});

test("allows IDLE -> LISTENING", () => {
  const ts = createTurnState();
  ts.transition(STATES.LISTENING);
  assert.equal(ts.get(), STATES.LISTENING);
});

test("rejects invalid transitions (IDLE -> SPEAKING)", () => {
  const ts = createTurnState();
  assert.throws(() => ts.transition(STATES.SPEAKING), /invalid turn-state transition/);
  assert.equal(ts.get(), STATES.IDLE, "state must not change on a rejected transition");
});

test("happy path: LISTENING -> THINKING -> SPEAKING -> LISTENING", () => {
  const ts = createTurnState(STATES.LISTENING);
  ts.transition(STATES.THINKING);
  ts.transition(STATES.SPEAKING);
  ts.transition(STATES.LISTENING);
  assert.equal(ts.get(), STATES.LISTENING);
});

test("barge-in: SPEAKING -> LISTENING directly, not through IDLE", () => {
  const ts = createTurnState(STATES.SPEAKING);
  ts.transition(STATES.LISTENING);
  assert.equal(ts.get(), STATES.LISTENING);
});

test("THINKING can bail straight back to LISTENING (interrupted before any audio produced)", () => {
  const ts = createTurnState(STATES.THINKING);
  ts.transition(STATES.LISTENING);
  assert.equal(ts.get(), STATES.LISTENING);
});

test("onChange listeners receive (next, prev) and can unsubscribe", () => {
  const ts = createTurnState(STATES.IDLE);
  const seen = [];
  const unsubscribe = ts.onChange((next, prev) => seen.push({ next, prev }));

  ts.transition(STATES.LISTENING);
  unsubscribe();
  ts.transition(STATES.THINKING);

  assert.deepEqual(seen, [{ next: STATES.LISTENING, prev: STATES.IDLE }]);
});
