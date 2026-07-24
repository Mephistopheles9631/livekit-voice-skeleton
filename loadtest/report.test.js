import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "./report.js";

test("computeStats: empty input", () => {
  const s = computeStats([]);
  assert.equal(s.count, 0);
  assert.equal(s.min, null);
  assert.equal(s.p50, null);
});

test("computeStats: single value — all percentiles equal that value", () => {
  const s = computeStats([500]);
  assert.equal(s.count, 1);
  assert.equal(s.min, 500);
  assert.equal(s.max, 500);
  assert.equal(s.p50, 500);
  assert.equal(s.p95, 500);
  assert.equal(s.p99, 500);
});

test("computeStats: nearest-rank percentiles over a known set", () => {
  // 1..100 ms — nearest-rank p50 = 50th smallest = 50, p95 = 95, p99 = 99.
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = computeStats(values);
  assert.equal(s.min, 1);
  assert.equal(s.max, 100);
  assert.equal(s.p50, 50);
  assert.equal(s.p95, 95);
  assert.equal(s.p99, 99);
});

test("computeStats: unsorted input is sorted before computing", () => {
  const s = computeStats([300, 100, 200]);
  assert.equal(s.min, 100);
  assert.equal(s.max, 300);
  assert.equal(s.p50, 200);
});

test("computeStats: does not mutate the input array", () => {
  const input = [300, 100, 200];
  computeStats(input);
  assert.deepEqual(input, [300, 100, 200]);
});
