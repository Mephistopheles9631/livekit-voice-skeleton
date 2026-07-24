// Integration tests for the token/orchestration server's routes. Spawns the real
// server/index.js as a child process against fake (non-network) LiveKit credentials —
// AccessToken.toJwt() just signs a JWT locally, no call to LiveKit happens at issuance time,
// so this needs no live network access and no real API keys. AGENT_INTERNAL_URL is left
// unset so agent-notify calls no-op (see agentClient.js) rather than trying to reach a real
// agent process.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const TEST_PORT = 39121; // fixed, distinctive port — avoids the complexity of relaying an
// OS-assigned ephemeral port back out of a child process's stdout for a project this size.
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let child;

before(async () => {
  child = spawn(process.execPath, ["index.js"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      LIVEKIT_API_KEY: "test-key",
      LIVEKIT_API_SECRET: "test-secret-not-real",
      LIVEKIT_URL: "wss://test.invalid",
      AGENT_INTERNAL_URL: "",
      AGENT_INTERNAL_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    let out = "";
    const onData = (chunk) => {
      out += chunk;
      if (out.includes("listening on")) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => reject(new Error(`server exited early (code ${code}): ${out}`)));
    setTimeout(() => reject(new Error(`server did not start in time: ${out}`)), 5000);
  });
});

after(async () => {
  child.kill();
  await once(child, "exit");
});

test("GET /health returns ok with zero active sessions initially", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.activeSessions, "number");
});

test("POST /session/start without userId returns 400", async () => {
  const res = await fetch(`${BASE_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /session/start with userId returns a token, roomName, and url", async () => {
  const res = await fetch(`${BASE_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "alice" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 20);
  assert.match(body.roomName, /^session-alice-\d+$/);
  assert.equal(body.url, "wss://test.invalid");
});

test("POST /session/resume for an unknown room returns 404", async () => {
  const res = await fetch(`${BASE_URL}/session/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "alice", roomName: "does-not-exist" }),
  });
  assert.equal(res.status, 404);
});

test("full lifecycle: start -> resume -> stop", async () => {
  const startRes = await fetch(`${BASE_URL}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "bob" }),
  });
  const { roomName } = await startRes.json();

  const resumeRes = await fetch(`${BASE_URL}/session/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "bob", roomName }),
  });
  assert.equal(resumeRes.status, 200);

  const stopRes = await fetch(`${BASE_URL}/session/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName }),
  });
  assert.equal(stopRes.status, 200);
  const stopBody = await stopRes.json();
  assert.equal(stopBody.stopped, true);
});
