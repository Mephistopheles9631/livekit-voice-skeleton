// Minimal LiveKit token server.
//
// Real-world equivalent of what the SugarShan-style role calls the
// "Real-Time Orchestration Layer" entry point: this is the backend
// service a client talks to BEFORE it ever touches WebRTC. It decides
// who is allowed into which room, with what permissions, for how long.
//
// This skeleton intentionally keeps the token-issuing logic simple so the
// session-lifecycle logic (start/stop/resume, room naming, participant
// identity) is easy to see and extend.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
  PORT = 3001,
} = process.env;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
  console.warn(
    "[warn] Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL. " +
      "See CONFIG.md — the server will start but /token will fail until set."
  );
}

// In a production orchestration layer, this is where you'd track active
// sessions (Redis/Postgres), enforce concurrency limits, and decide which
// "technology" (voice model, avatar renderer, etc.) is active for this
// session. Kept in-memory here since this is a skeleton, not the product.
const activeSessions = new Map(); // roomName -> { startedAt, participants: Set }

app.post("/session/start", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const roomName = `session-${userId}-${Date.now()}`;
  activeSessions.set(roomName, {
    startedAt: Date.now(),
    participants: new Set([userId]),
  });

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      ttl: "10m", // short-lived token; refresh via /session/resume for long sessions
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    res.json({ roomName, token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("Failed to issue token:", err);
    res.status(500).json({ error: "token_issue_failed" });
  }
});

// Resume an existing session (e.g. app backgrounded and came back, or
// token expired). Real version would validate the session actually still
// exists server-side and hasn't exceeded cost/latency budgets.
app.post("/session/resume", async (req, res) => {
  const { userId, roomName } = req.body;
  if (!userId || !roomName) {
    return res.status(400).json({ error: "userId and roomName are required" });
  }
  if (!activeSessions.has(roomName)) {
    return res.status(404).json({ error: "session_not_found" });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId,
    ttl: "10m",
  });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  res.json({ roomName, token, url: LIVEKIT_URL });
});

app.post("/session/stop", (req, res) => {
  const { roomName } = req.body;
  activeSessions.delete(roomName);
  res.json({ stopped: true });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, activeSessions: activeSessions.size });
});

app.listen(PORT, () => {
  console.log(`Token/orchestration server listening on http://localhost:${PORT}`);
});
