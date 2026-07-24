import "dotenv/config";
import { createInternalApi } from "./control/internalApi.js";
import { createAgentSession } from "./agentSession.js";
import { createUserMemoryStore } from "./memory/userMemoryStore.js";

const env = process.env;
const PORT = env.AGENT_PORT || 3012;
const SECRET = env.AGENT_INTERNAL_SECRET;

if (!SECRET) {
  console.warn(
    "[warn] AGENT_INTERNAL_SECRET not set — the internal control API will reject all join/leave calls until it is."
  );
}
if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
  console.warn(
    "[warn] Missing LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET — the agent will fail to join rooms until set."
  );
}
if (!env.DEEPGRAM_API_KEY) {
  console.warn("[warn] Missing DEEPGRAM_API_KEY — STT will fail to start until set.");
}
if (!env.ANTHROPIC_API_KEY) {
  console.warn("[warn] Missing ANTHROPIC_API_KEY — the LLM turn will fail to start until set.");
}
if (!env.ELEVENLABS_API_KEY) {
  console.warn("[warn] Missing ELEVENLABS_API_KEY — TTS will fail to start until set.");
}

const sessions = new Map(); // roomName -> AgentSession
const memoryStore = await createUserMemoryStore({ redisUrl: env.REDIS_URL });

const server = createInternalApi({
  secret: SECRET,
  onHealth: async () => ({ ok: true, activeSessions: sessions.size }),
  onJoin: async ({ roomName }) => {
    if (sessions.has(roomName)) return; // idempotent
    const session = await createAgentSession({
      roomName,
      env,
      memoryStore,
      onEnded: (name) => sessions.delete(name),
    });
    sessions.set(roomName, session);
  },
  onLeave: async ({ roomName }) => {
    const session = sessions.get(roomName);
    if (!session) return; // idempotent
    await session.leave();
    sessions.delete(roomName);
  },
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`livekit-voice-skeleton agent listening on 127.0.0.1:${PORT}`);
});
