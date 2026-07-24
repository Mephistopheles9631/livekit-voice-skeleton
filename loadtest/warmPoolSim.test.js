// Pure discrete-event simulation logic, zero vendor/network dependency — tested the same way
// agent/state/turnState.js and agent/audio/pcmFramer.js are (pure logic gets real tests in
// this project, even when adjacent vendor-touching code doesn't). Uses an injected,
// deterministic `random` (returns a fixed sequence) instead of Math.random so results are
// reproducible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, generateRequests } from "./warmPoolSim.js";

function fixedRandom(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("generateRequests: deterministic with a fixed random source, sorted by arrival", () => {
  const requests = generateRequests({
    count: 3,
    windowMs: 1000,
    durationRange: [100, 200],
    random: fixedRandom(0.5, 0.1, 0.1, 0.9, 0.9, 0.1),
  });
  assert.equal(requests.length, 3);
  for (let i = 1; i < requests.length; i++) {
    assert.ok(requests[i].arrivalMs >= requests[i - 1].arrivalMs, "sorted by arrival time");
  }
});

test("a request gets a warm-start when a pre-warmed slot is available", () => {
  const requests = [{ id: 0, arrivalMs: 0, durationMs: 1000 }];
  const [result] = simulate({
    requests,
    poolSize: 2,
    coldStartRange: [2000, 4000],
    warmStartRange: [50, 200],
    graceMs: 0,
    prewarmCount: 2, // both slots pre-warmed ahead of demand
    random: fixedRandom(0.5),
  });
  assert.equal(result.warmStart, true);
  assert.equal(result.startLatencyMs, 50 + 0.5 * (200 - 50));
  assert.equal(result.waitMs, 0, "a slot was immediately available, no queueing");
});

test("with no pre-warmed slots, a request cold-starts", () => {
  const requests = [{ id: 0, arrivalMs: 0, durationMs: 1000 }];
  const [result] = simulate({
    requests,
    poolSize: 2,
    coldStartRange: [2000, 4000],
    warmStartRange: [50, 200],
    graceMs: 0,
    prewarmCount: 0,
    random: fixedRandom(0.5),
  });
  assert.equal(result.warmStart, false);
  assert.equal(result.startLatencyMs, 2000 + 0.5 * (4000 - 2000));
});

test("pool exhaustion: a request arriving when every slot is busy queues and pays wait time", () => {
  const requests = [
    { id: 0, arrivalMs: 0, durationMs: 100 },
    { id: 1, arrivalMs: 0, durationMs: 100 }, // arrives at the same instant, no free slot left
  ];
  const results = simulate({
    requests,
    poolSize: 1,
    coldStartRange: [1000, 1000],
    warmStartRange: [100, 100],
    graceMs: 0,
    prewarmCount: 1,
    random: fixedRandom(0),
  });
  assert.equal(results.length, 2);
  const [first, second] = results;
  assert.equal(first.waitMs, 0, "the first request claims the only slot immediately");
  // Slot frees at readyAt(100) + duration(100) = 200 — the second request must wait until then.
  assert.equal(second.waitMs, 200, "the second request queues until the slot frees");
});

test("grace-period teardown: a slot freed within the grace window is reused warm", () => {
  const requests = [
    { id: 0, arrivalMs: 0, durationMs: 100 },
    { id: 1, arrivalMs: 500, durationMs: 100 }, // arrives well within the 1000ms grace window
  ];
  const results = simulate({
    requests,
    poolSize: 1,
    coldStartRange: [2000, 2000],
    warmStartRange: [50, 50],
    graceMs: 1000,
    prewarmCount: 1,
    random: fixedRandom(0),
  });
  // First request: slot pre-warmed -> warm start. Slot frees at 50+100=150, stays warm until
  // 150+1000=1150. Second request arrives at 500, well inside that window -> also warm start.
  assert.equal(results[0].warmStart, true);
  assert.equal(results[1].warmStart, true);
});

test("grace-period teardown: a slot reused AFTER the grace window has expired cold-starts", () => {
  const requests = [
    { id: 0, arrivalMs: 0, durationMs: 100 },
    { id: 1, arrivalMs: 5000, durationMs: 100 }, // arrives long after the 1000ms grace window
  ];
  const results = simulate({
    requests,
    poolSize: 1,
    coldStartRange: [2000, 2000],
    warmStartRange: [50, 50],
    graceMs: 1000,
    prewarmCount: 1,
    random: fixedRandom(0),
  });
  assert.equal(results[0].warmStart, true);
  assert.equal(results[1].warmStart, false, "the grace window (ended at 1150ms) had long since expired by 5000ms");
});
