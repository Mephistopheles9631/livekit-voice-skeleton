// Pure percentile/summary math over a list of latency numbers (ms) — no I/O, no vendor
// calls, so it's unit-tested (report.test.js), matching how agent/trace/turnTrace.js's pure
// delta math is tested even though it sits next to un-unit-tested vendor adapters. Nearest-
// rank method: sort ascending, index = ceil(p/100 * n) - 1.
import { readFileSync } from "node:fs";

export function computeStats(latenciesMs) {
  const values = [...latenciesMs].sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return { count: 0, min: null, max: null, p50: null, p95: null, p99: null };

  const percentile = (p) => values[Math.min(n - 1, Math.ceil((p / 100) * n) - 1)];

  return {
    count: n,
    min: values[0],
    max: values[n - 1],
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
  };
}

function fmt(ms) {
  return ms === null ? "n/a" : `${Math.round(ms)}ms`;
}

// Defensive floor, not the primary filtering mechanism below — a round-trip this low is
// physically impossible for a real STT+LLM+TTS turn (every genuinely-measured value across
// every run of this harness, at every concurrency level, has landed between ~3.9s-5.2s).
const MIN_PLAUSIBLE_ROUND_TRIP_MS = 300;

// Round-trip (publish -> first audible response frame) is only trustworthy for each session's
// FIRST turn. Real, root-caused finding, not a guess: turn-0 measurements were consistently
// sane (~3958-4553ms) across every run at every concurrency level tested (2 and 10 concurrent
// sessions); turn-1/turn-2 measurements were near-zero in the large majority of cases (visible
// directly in the raw per-turn results — see loadtest/README.md's Known Limitations section
// for the full data and reasoning). Two contributing causes were found and one was fixed along
// the way (see PROJECT_SPEC.md's SugarShan POC log and agent/turnOrchestrator.js's onError
// guard), but a residual, unresolved cause remains: at load, this harness's own single Node
// process running N concurrent native-audio-FFI consumers appears to fall behind and deliver
// buffered frames in backlogged bursts rather than at a reliable real-time pace, which no
// purely reactive JS-side gating (an inter-turn quiet-period wait was tried and measurably
// helped, but did not fully resolve it) can fully correct. Reported honestly as a real,
// investigated, partially-mitigated limitation of this test harness — not of the pipeline
// under test — rather than presenting numbers derived from an unreliable signal as if solid.
// Transcript latency has no equivalent issue (it comes over the data channel, not native audio
// decode) and is reported across every turn, all conditions, no filtering needed.
export function printReport(results) {
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  const firstTurns = ok.filter((r) => r.turnIndex === 0);
  const laterTurns = ok.filter((r) => r.turnIndex !== 0);
  const roundTrip = computeStats(
    firstTurns.map((r) => r.roundTripMs).filter((ms) => ms >= MIN_PLAUSIBLE_ROUND_TRIP_MS)
  );
  const transcript = computeStats(ok.map((r) => r.transcriptLatencyMs));

  console.log("\n=== Load test report ===");
  console.log(`Turns completed: ${ok.length}   Turns errored: ${failed.length}`);
  console.log(
    `Round-trip (publish -> first audible agent response frame), FIRST TURN OF EACH SESSION ` +
      `ONLY (n=${firstTurns.length}) — see report.js's header comment for why:\n` +
      `  p50: ${fmt(roundTrip.p50)}   p95: ${fmt(roundTrip.p95)}   p99: ${fmt(roundTrip.p99)}   ` +
      `min: ${fmt(roundTrip.min)}   max: ${fmt(roundTrip.max)}`
  );
  console.log(
    `Transcript latency (publish -> final transcript), ALL turns (n=${ok.length}): ` +
      `p50: ${fmt(transcript.p50)}   p95: ${fmt(transcript.p95)}   p99: ${fmt(transcript.p99)}   ` +
      `min: ${fmt(transcript.min)}   max: ${fmt(transcript.max)}`
  );
  console.log(
    `(${laterTurns.length} second/third-turn round-trip measurement(s) NOT included above — ` +
      `see report.js's header comment. Still counted in "Turns completed.")`
  );
  if (failed.length > 0) {
    console.log(`\nErrors (${failed.length}):`);
    for (const r of failed.slice(0, 10)) {
      console.log(`  session ${r.sessionIndex} turn ${r.turnIndex}: ${r.error}`);
    }
    if (failed.length > 10) console.log(`  ... and ${failed.length - 10} more`);
  }
  console.log(
    "\nHonesty notes:\n" +
      "- Synthetic concurrent load (scripted clients, not real users) — see loadtest/README.md.\n" +
      "- Measures agent-process-boundary timing (publish -> first received response audio\n" +
      "  frame), not literal mic-to-speaker hardware latency — same caveat as\n" +
      "  agent/trace/turnTrace.js's own documented scope.\n" +
      "- Audio input is clean synthesized speech, not noisy real-world mic conditions — not a\n" +
      "  measure of STT accuracy under real acoustic conditions.\n" +
      "- Round-trip is first-turn-only, not all turns — see loadtest/README.md's Known\n" +
      "  Limitations section for the real data and reasoning behind that choice.\n"
  );
  return { roundTrip, transcript, failed: failed.length, completed: ok.length, laterTurnsExcluded: laterTurns.length };
}

// Standalone re-analysis: node loadtest/report.js loadtest/results/<file>.jsonl
if (process.argv[1] && process.argv[1].endsWith("report.js") && process.argv[2]) {
  const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean);
  const results = lines.map((line) => JSON.parse(line));
  printReport(results);
}
