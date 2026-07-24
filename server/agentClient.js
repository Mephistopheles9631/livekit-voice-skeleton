// Notifies the agent process to join/leave a room when a session starts/stops, over the
// localhost-only internal control channel. Fire-and-forget with a short timeout: if the
// agent is down, the token server still issues tokens and the client still works for plain
// audio (just without STT/LLM/TTS) — matches the existing "warn, don't crash" convention
// already used here for missing LiveKit credentials.
const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_INTERNAL_SECRET = process.env.AGENT_INTERNAL_SECRET;
const TIMEOUT_MS = 2000;

async function callAgent(path, body) {
  if (!AGENT_INTERNAL_URL || !AGENT_INTERNAL_SECRET) {
    console.warn(`[warn] AGENT_INTERNAL_URL/AGENT_INTERNAL_SECRET not set — skipping agent notify (${path})`);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AGENT_INTERNAL_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": AGENT_INTERNAL_SECRET },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[warn] agent notify ${path} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[warn] agent notify ${path} failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function notifyAgentJoin(roomName) {
  return callAgent("/agent/join", { roomName });
}

export function notifyAgentLeave(roomName) {
  return callAgent("/agent/leave", { roomName });
}
