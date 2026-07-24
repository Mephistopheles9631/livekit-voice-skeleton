// createInMemoryStore() is the backend exercised here — no real Redis needed, same
// convention as server/sessionStore.test.js. createRedisStore()'s real persistence is proven
// live instead (see TESTING.md's manual-verify list): a real cross-session recall test is a
// stronger proof than mocking the Redis client here would be.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore } from "./userMemoryStore.js";

test("get() returns null for a user that was never set", async () => {
  const store = createInMemoryStore();
  assert.equal(await store.get("no-such-user"), null);
});

test("set() then get() round-trips the same data", async () => {
  const store = createInMemoryStore();
  const data = { facts: "- likes concise answers", updatedAt: 12345 };
  await store.set("user-1", data);
  assert.deepEqual(await store.get("user-1"), data);
});

test("set() overwrites a previous value for the same user", async () => {
  const store = createInMemoryStore();
  await store.set("user-1", { facts: "- old fact", updatedAt: 1 });
  await store.set("user-1", { facts: "- new fact", updatedAt: 2 });
  assert.deepEqual(await store.get("user-1"), { facts: "- new fact", updatedAt: 2 });
});
