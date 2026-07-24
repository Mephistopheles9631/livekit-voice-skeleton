// Session bookkeeping for the token/orchestration server — which rooms currently have an
// active session (see PROJECT_SPEC.md Phase 5). Two backends behind the same async interface:
//
// - createInMemoryStore(): a plain Map, used automatically when REDIS_URL is unset. Sessions
//   don't survive a restart, but no infra is needed — good for local dev/tests.
// - createRedisStore(): backed by real Redis, so sessions (and therefore /session/resume)
//   survive a `systemctl restart` of this service.
//
// createSessionStore() picks between them. REDIS_URL being set is treated as an explicit
// request for persistence — if it's set but Redis can't be reached at boot, that's a
// misconfiguration worth crashing loudly for, not silently degrading past. If REDIS_URL is
// unset, persistence was simply never asked for, so falling back to in-memory is fine.
import { createClient } from "redis";

const KEY_PREFIX = "livekit-voice-skeleton:session:";
const DEFAULT_TTL_SECONDS = 6 * 60 * 60; // 6h: generous vs. the 10m access-token TTL (resume
// re-mints tokens far more often than that), while still letting genuinely abandoned sessions
// self-clean instead of accumulating in Redis forever.

export function createInMemoryStore() {
  const map = new Map();
  return {
    async get(roomName) {
      return map.get(roomName) ?? null;
    },
    async set(roomName, data) {
      map.set(roomName, data);
    },
    async delete(roomName) {
      map.delete(roomName);
    },
    async has(roomName) {
      return map.has(roomName);
    },
    async size() {
      return map.size;
    },
  };
}

export function createRedisStore({ url, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const client = createClient({ url });
  client.on("error", (err) => console.error("[sessionStore] Redis client error:", err));

  const key = (roomName) => `${KEY_PREFIX}${roomName}`;

  return {
    async connect() {
      await client.connect();
    },
    async get(roomName) {
      const raw = await client.get(key(roomName));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { ...parsed, participants: new Set(parsed.participants) };
    },
    async set(roomName, data) {
      const serializable = { ...data, participants: [...data.participants] };
      await client.set(key(roomName), JSON.stringify(serializable), { EX: ttlSeconds });
    },
    async delete(roomName) {
      await client.del(key(roomName));
    },
    async has(roomName) {
      return (await client.exists(key(roomName))) === 1;
    },
    async size() {
      let cursor = "0";
      let count = 0;
      do {
        const result = await client.scan(cursor, { MATCH: `${KEY_PREFIX}*`, COUNT: 100 });
        cursor = result.cursor;
        count += result.keys.length;
      } while (cursor !== "0");
      return count;
    },
  };
}

export async function createSessionStore({ redisUrl }) {
  if (!redisUrl) {
    console.warn(
      "[warn] REDIS_URL not set — sessions are in-memory only and will NOT survive a " +
        "restart. See CONFIG.md's Phase 5 section to enable persistence."
    );
    return createInMemoryStore();
  }

  const store = createRedisStore({ url: redisUrl });
  await store.connect(); // intentionally unguarded: REDIS_URL being set means persistence
  // was explicitly requested, so failing to connect should crash startup, not silently fall
  // back to in-memory and pretend persistence is working.
  console.log(`[sessionStore] Connected to Redis at ${redisUrl} — sessions will persist.`);
  return store;
}
