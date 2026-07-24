// Part 2: scripted two-session cross-session memory proof, per
// SCOPE_OF_WORK_sugarshan_poc.md. Reuses loadtest/lib/liveClient.js (same headless join/
// publish/subscribe helper Part 1 uses) and talks to Redis directly (same REDIS_URL the real
// agent/server processes use) to observe the actual stored state independently of the agent
// process — not just trusting that a save "should" have happened.
//
// Run as two separate phases, with a manual agent restart in between (the actual thing being
// proven — memory surviving a real process restart, not just living in an in-process
// variable — the same way the session-persistence restart-proof was done earlier in this
// project; see PROJECT_SPEC.md):
//   node loadtest/verifyMemory.js --phase=a
//   sudo systemctl restart livekit-voice-skeleton-agent.service
//   node loadtest/verifyMemory.js --phase=b
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createClient } from "redis";
import { connectSimulatedClient } from "./lib/liveClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = "poc-memory-test-1"; // fixed/reused on purpose — not randomized per run
const SERVER_URL = process.env.LOADTEST_SERVER_URL || "http://127.0.0.1:3011";
const MEMORY_KEY = `livekit-voice-skeleton:memory:${USER_ID}`;
const TURN_TIMEOUT_MS = 20000;
const MEMORY_POLL_MS = 500;
const MEMORY_POLL_TIMEOUT_MS = 15000;

function runOneTurn(client, clipBuffer) {
  return new Promise((resolve, reject) => {
    let text = "";
    let done = false;
    const timer = setTimeout(() => reject(new Error("turn timed out waiting for a reply")), TURN_TIMEOUT_MS);
    client.onAssistant((msg) => {
      if (done) return;
      if (msg.event === "delta") text += msg.text;
      else if (msg.event === "end") {
        done = true;
        clearTimeout(timer);
        resolve(text);
      } else if (msg.event === "error") {
        done = true;
        clearTimeout(timer);
        reject(new Error(`pipeline error: ${msg.message}`));
      }
    });
    client.publishClip(clipBuffer).catch(reject);
  });
}

async function waitForMemoryUpdate(redis, previousUpdatedAt) {
  const deadline = Date.now() + MEMORY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const raw = await redis.get(MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.updatedAt !== previousUpdatedAt) return parsed;
    }
    await new Promise((r) => setTimeout(r, MEMORY_POLL_MS));
  }
  return null;
}

async function connectRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL must be set to independently verify the stored memory.");
  const redis = createClient({ url: redisUrl });
  redis.on("error", (err) => console.error("[verifyMemory] Redis client error:", err));
  await redis.connect();
  return redis;
}

async function phaseA() {
  const redis = await connectRedis();
  const stateFactClip = await readFile(path.join(__dirname, "sample-audio", "state-fact.pcm"));

  const before = await redis.get(MEMORY_KEY);
  const beforeParsed = before ? JSON.parse(before) : null;

  console.log(`=== Part 2, phase A: state a fact (userId: ${USER_ID}) ===\n`);
  console.log(
    beforeParsed
      ? `Existing memory before this run:\n  "${beforeParsed.facts}"\n`
      : "No existing memory for this userId before this run.\n"
  );

  const client = await connectSimulatedClient({ serverUrl: SERVER_URL, userId: USER_ID });
  const reply = await runOneTurn(client, stateFactClip);
  console.log(`Agent replied: "${reply}"`);
  await client.disconnect();
  console.log("Session disconnected.\n");

  console.log("Waiting for the agent to save memory to Redis (independent confirmation, not assumed)...");
  const saved = await waitForMemoryUpdate(redis, beforeParsed?.updatedAt);
  await redis.quit();
  if (!saved) {
    console.error("FAILED: no memory update observed in Redis within the timeout.");
    process.exit(1);
  }
  console.log(`Confirmed via a direct Redis GET ${MEMORY_KEY}:`);
  console.log(`  "${saved.facts}"`);
  console.log(
    "\nNow restart the agent service, then run: node loadtest/verifyMemory.js --phase=b\n" +
      "  sudo systemctl restart livekit-voice-skeleton-agent.service"
  );
}

async function phaseB() {
  const redis = await connectRedis();
  const askNameClip = await readFile(path.join(__dirname, "sample-audio", "ask-name.pcm"));

  const stored = await redis.get(MEMORY_KEY);
  const storedParsed = stored ? JSON.parse(stored) : null;
  await redis.quit();
  if (!storedParsed) {
    console.error(`FAILED: no memory found at ${MEMORY_KEY} — did phase=a run and succeed first?`);
    process.exit(1);
  }

  console.log(`=== Part 2, phase B: new session, same userId, recall question ===\n`);
  console.log(`Stored facts (read directly from Redis, independent of the agent process):`);
  console.log(`  "${storedParsed.facts}"\n`);

  const client = await connectSimulatedClient({ serverUrl: SERVER_URL, userId: USER_ID });
  const reply = await runOneTurn(client, askNameClip);
  console.log(`Agent replied: "${reply}"`);
  await client.disconnect();
  console.log("Session disconnected.\n");

  const heuristicPass = /alex/i.test(reply);
  console.log("=== Result ===");
  console.log(`Stored facts (from Redis, before this session ran): "${storedParsed.facts}"`);
  console.log(`Session B's actual reply: "${reply}"`);
  console.log(
    `Heuristic check (case-insensitive "alex" substring — a heuristic, not semantic proof): ` +
      `${heuristicPass ? "PASS" : "FAIL"}`
  );
  console.log("Judge the full reply text above directly rather than relying on the heuristic alone.");
}

const phase = process.argv.find((a) => a.startsWith("--phase="))?.split("=")[1];
if (phase === "a") await phaseA();
else if (phase === "b") await phaseB();
else {
  console.error("Usage: node loadtest/verifyMemory.js --phase=a | --phase=b");
  process.exit(1);
}
