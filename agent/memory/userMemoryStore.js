// Cross-session conversational memory: a compact, evolving summary of facts about a user,
// keyed by their LiveKit identity (the same userId server/index.js mints their AccessToken
// with — see agentSession.js for how the agent recovers it from RemoteParticipant.identity).
//
// Deliberately a separate, small duplicate of server/sessionStore.js's Redis-wrapper shape
// rather than a shared module: server/ and agent/ are independently deployed processes that
// import nothing from each other today, so a two-call-site shared package would be more
// structural change than the ~40 lines it'd save.
//
// Unlike sessions (ephemeral, 6h TTL), memory is meant to last — 180 days, refreshed on every
// write, so an actively-returning user's memory never expires while a one-off tester's
// quietly self-cleans after ~6 months of inactivity.
import { createClient } from "redis";

const KEY_PREFIX = "livekit-voice-skeleton:memory:";
const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

export function createInMemoryStore() {
  const map = new Map();
  return {
    async get(userId) {
      return map.get(userId) ?? null;
    },
    async set(userId, data) {
      map.set(userId, data);
    },
  };
}

export function createRedisStore({ url, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const client = createClient({ url });
  client.on("error", (err) => console.error("[userMemoryStore] Redis client error:", err));

  const key = (userId) => `${KEY_PREFIX}${userId}`;

  return {
    async connect() {
      await client.connect();
    },
    async get(userId) {
      const raw = await client.get(key(userId));
      return raw ? JSON.parse(raw) : null;
    },
    async set(userId, data) {
      await client.set(key(userId), JSON.stringify(data), { EX: ttlSeconds });
    },
  };
}

export async function createUserMemoryStore({ redisUrl }) {
  if (!redisUrl) {
    console.warn(
      "[warn] REDIS_URL not set — conversational memory is in-memory only and will NOT " +
        "survive an agent restart."
    );
    return createInMemoryStore();
  }

  const store = createRedisStore({ url: redisUrl });
  await store.connect(); // unguarded, same rationale as sessionStore.js: REDIS_URL being set
  // is an explicit persistence request, so a failed connect should crash startup, not
  // silently degrade to in-memory.
  console.log(`[userMemoryStore] Connected to Redis at ${redisUrl} — memory will persist.`);
  return store;
}
