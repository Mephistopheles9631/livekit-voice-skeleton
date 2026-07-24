// createInMemoryStore() is the backend these tests exercise directly — it needs no real
// Redis, matching this repo's existing convention of not requiring live infra for `npm test`.
// createRedisStore()/createSessionStore()'s Redis-backed behavior is proven live instead (see
// TESTING.md's manual-verify list): a real `systemctl restart` followed by a real
// /session/resume call is a stronger proof than mocking the Redis client here would be.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore } from "./sessionStore.js";

test("get() returns null for a room that was never set", async () => {
  const store = createInMemoryStore();
  assert.equal(await store.get("no-such-room"), null);
});

test("set() then get() round-trips the same data", async () => {
  const store = createInMemoryStore();
  const data = { startedAt: 12345, participants: new Set(["alice"]) };
  await store.set("room-1", data);
  assert.deepEqual(await store.get("room-1"), data);
});

test("has() reflects set()/delete()", async () => {
  const store = createInMemoryStore();
  assert.equal(await store.has("room-1"), false);
  await store.set("room-1", { startedAt: 1, participants: new Set() });
  assert.equal(await store.has("room-1"), true);
  await store.delete("room-1");
  assert.equal(await store.has("room-1"), false);
});

test("delete() on a room that was never set does not throw", async () => {
  const store = createInMemoryStore();
  await assert.doesNotReject(() => store.delete("no-such-room"));
});

test("size() counts distinct rooms", async () => {
  const store = createInMemoryStore();
  assert.equal(await store.size(), 0);
  await store.set("room-1", { startedAt: 1, participants: new Set() });
  await store.set("room-2", { startedAt: 2, participants: new Set() });
  assert.equal(await store.size(), 2);
  await store.delete("room-1");
  assert.equal(await store.size(), 1);
});
