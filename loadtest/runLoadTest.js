// Part 1 entry point: spins up N simulated concurrent sessions against the REAL running
// token server + agent (not mocked), each running `turns` rounds, then reports p50/p95/p99.
// Usage: node loadtest/runLoadTest.js [--sessions 10] [--turns 3] [--server http://127.0.0.1:3011]
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulatedSession } from "./simulateSession.js";
import { printReport } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { sessions: 10, turns: 3, server: "http://127.0.0.1:3011" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sessions") args.sessions = Number(argv[++i]);
    else if (argv[i] === "--turns") args.turns = Number(argv[++i]);
    else if (argv[i] === "--server") args.server = argv[++i];
  }
  return args;
}

async function main() {
  const { sessions, turns, server } = parseArgs(process.argv.slice(2));
  const clipPath = path.join(__dirname, "sample-audio", "generic-turn.pcm");

  console.log(
    `Starting load test: ${sessions} concurrent sessions, ${turns} turns each ` +
      `(${sessions * turns} total turns) against ${server}`
  );
  console.log("(Synthetic concurrent load — see loadtest/README.md before reading these numbers.)\n");

  const started = Date.now();
  const settled = await Promise.allSettled(
    Array.from({ length: sessions }, (_, i) =>
      runSimulatedSession({ index: i, turns, serverUrl: server, clipPath })
    )
  );
  const wallClockMs = Date.now() - started;

  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
    } else {
      // The whole session failed to even connect/run (e.g. /session/start rejected) —
      // recorded as one failed "turn" per missing turn so it's visible in the report, not
      // silently dropped from the denominator.
      for (let t = 0; t < turns; t++) {
        results.push({ sessionIndex: i, turnIndex: t, error: outcome.reason?.message ?? String(outcome.reason) });
      }
    }
  });

  const resultsDir = path.join(__dirname, "results");
  await mkdir(resultsDir, { recursive: true });
  const outFile = path.join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  await writeFile(outFile, results.map((r) => JSON.stringify(r)).join("\n") + "\n");

  console.log(`Wall-clock time for the whole run: ${wallClockMs}ms`);
  console.log(`Raw results written to ${path.relative(process.cwd(), outFile)}`);
  printReport(results);
}

main().catch((err) => {
  console.error("Load test run failed:", err);
  process.exit(1);
});
