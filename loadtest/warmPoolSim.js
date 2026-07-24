// Part 3 (stretch) — GPU warm-pool orchestration simulation, per
// SCOPE_OF_WORK_sugarshan_poc.md: a small, standalone demonstration of the pre-warming idea
// proposed in reply to the avatar cold-start question. NO real GPU/avatar vendor, no LiveKit,
// no network — pure discrete-event simulation, run entirely in virtual/logical time (a sorted
// event list), not real setTimeout waits. Mocked timings throughout — the value here is
// demonstrating the orchestration/decision logic, not real numbers; see loadtest/README.md.
import { computeStats } from "./report.js";

function randomBetween(min, max, random) {
  return min + random() * (max - min);
}

// Generates the SAME request timeline (arrival times + session durations) to be replayed
// against both scenarios below, so the pre-warmed-vs-naive comparison is apples-to-apples,
// not two different random draws.
export function generateRequests({ count, windowMs, durationRange, random = Math.random }) {
  const requests = [];
  for (let i = 0; i < count; i++) {
    requests.push({
      id: i,
      arrivalMs: randomBetween(0, windowMs, random),
      durationMs: randomBetween(durationRange[0], durationRange[1], random),
    });
  }
  requests.sort((a, b) => a.arrivalMs - b.arrivalMs);
  return requests;
}

// One scenario's run: `prewarmCount` slots start pre-warmed (ready before any demand arrives);
// `graceMs` is how long a slot stays warm after its session ends before tearing down to cold
// (0 = instant teardown, the naive baseline). Pool capacity (`poolSize`) is a hard ceiling in
// both scenarios — a request arriving when every slot is busy queues for the next one to free,
// modeling real infrastructure capacity, not just start-latency.
export function simulate({ requests, poolSize, coldStartRange, warmStartRange, graceMs, prewarmCount, random = Math.random }) {
  const slots = Array.from({ length: poolSize }, (_, i) => ({ state: i < prewarmCount ? "warm" : "cold" }));
  const results = [];
  const waitQueue = [];
  const events = requests.map((r) => ({ time: r.arrivalMs, type: "arrival", request: r }));

  function pushEvent(ev) {
    const idx = events.findIndex((e) => e.time > ev.time);
    if (idx === -1) events.push(ev);
    else events.splice(idx, 0, ev);
  }

  function tryAssign(request, atTime) {
    let slotIdx = slots.findIndex((s) => s.state === "warm");
    let startLatencyMs;
    let warmStart;
    if (slotIdx !== -1) {
      startLatencyMs = randomBetween(warmStartRange[0], warmStartRange[1], random);
      warmStart = true;
    } else {
      slotIdx = slots.findIndex((s) => s.state === "cold");
      if (slotIdx === -1) return false; // pool fully busy — caller queues the request
      startLatencyMs = randomBetween(coldStartRange[0], coldStartRange[1], random);
      warmStart = false;
    }
    slots[slotIdx] = { state: "busy" };
    const readyAt = atTime + startLatencyMs;
    const freeAt = readyAt + request.durationMs;
    results.push({
      id: request.id,
      waitMs: atTime - request.arrivalMs,
      startLatencyMs,
      warmStart,
      userPerceivedLatencyMs: atTime - request.arrivalMs + startLatencyMs,
    });
    pushEvent({ time: freeAt, type: "sessionEnd", slotIdx });
    return true;
  }

  function serviceQueue(atTime) {
    if (waitQueue.length === 0) return;
    const next = waitQueue.shift();
    if (!tryAssign(next, atTime)) waitQueue.unshift(next);
  }

  while (events.length > 0) {
    const ev = events.shift();
    if (ev.type === "arrival") {
      if (!tryAssign(ev.request, ev.time)) waitQueue.push(ev.request);
    } else if (ev.type === "sessionEnd") {
      if (graceMs > 0) {
        slots[ev.slotIdx] = { state: "warm" };
        pushEvent({ time: ev.time + graceMs, type: "graceExpire", slotIdx: ev.slotIdx });
      } else {
        slots[ev.slotIdx] = { state: "cold" };
      }
      serviceQueue(ev.time);
    } else if (ev.type === "graceExpire") {
      if (slots[ev.slotIdx].state === "warm") slots[ev.slotIdx] = { state: "cold" };
    }
  }

  return results;
}

const DEFAULTS = {
  count: 30,
  windowMs: 60000,
  poolSize: 8,
  durationRange: [5000, 15000],
  coldStartRange: [2000, 4000],
  warmStartRange: [50, 200],
  graceMs: 20000,
};

function runComparison(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  const requests = generateRequests(cfg);

  const naive = simulate({
    requests,
    poolSize: cfg.poolSize,
    coldStartRange: cfg.coldStartRange,
    warmStartRange: cfg.warmStartRange,
    graceMs: 0,
    prewarmCount: 0,
  });

  const preWarmed = simulate({
    requests,
    poolSize: cfg.poolSize,
    coldStartRange: cfg.coldStartRange,
    warmStartRange: cfg.warmStartRange,
    graceMs: cfg.graceMs,
    prewarmCount: cfg.poolSize,
  });

  return { cfg, requests, naive, preWarmed };
}

function fmt(ms) {
  return ms === null ? "n/a" : `${Math.round(ms)}ms`;
}

function printScenario(label, results) {
  const stats = computeStats(results.map((r) => r.userPerceivedLatencyMs));
  const warmCount = results.filter((r) => r.warmStart).length;
  console.log(`${label} (n=${results.length}, ${warmCount} warm-started / ${results.length - warmCount} cold-started):`);
  console.log(
    `  p50: ${fmt(stats.p50)}   p95: ${fmt(stats.p95)}   p99: ${fmt(stats.p99)}   ` +
      `min: ${fmt(stats.min)}   max: ${fmt(stats.max)}`
  );
}

if (process.argv[1] && process.argv[1].endsWith("warmPoolSim.js")) {
  console.log("=== Part 3 (stretch): GPU warm-pool orchestration — SIMULATION ONLY ===");
  console.log(
    "Mocked timings, virtual/logical simulated time — NOT integrated with any real GPU/avatar\n" +
      "vendor. Demonstrates the orchestration/decision logic (pre-warm ahead of demand +\n" +
      "idle-timeout-with-grace-period teardown), not real numbers. See loadtest/README.md.\n"
  );
  const { cfg, naive, preWarmed } = runComparison();
  console.log(
    `Config: ${cfg.count} requests over a ${cfg.windowMs / 1000}s window, pool size ` +
      `${cfg.poolSize}, cold-start ${cfg.coldStartRange[0]}-${cfg.coldStartRange[1]}ms, ` +
      `warm-start ${cfg.warmStartRange[0]}-${cfg.warmStartRange[1]}ms, grace period ` +
      `${cfg.graceMs / 1000}s. Same request timeline replayed against both scenarios below.\n`
  );
  printScenario("Naive baseline (no pre-warm, instant teardown)", naive);
  console.log();
  printScenario("Pre-warmed pool + grace-period teardown", preWarmed);
}
