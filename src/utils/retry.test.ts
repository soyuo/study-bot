import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry.js";

test("retry utility returns after a transient failure", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary");
      return "ok";
    },
    { maxAttempts: 3, delayMs: 100, sleep: async (delay) => { delays.push(delay); } },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("retry utility rethrows the final error", async () => {
  const error = new Error("permanent");
  await assert.rejects(
    withRetry(async () => { throw error; }, { maxAttempts: 2, delayMs: 0, sleep: async () => undefined }),
    error,
  );
});

test("retry utility validates the attempt count", async () => {
  await assert.rejects(
    withRetry(async () => "ok", { maxAttempts: 0, delayMs: 0 }),
    /maxAttempts must be a positive integer/,
  );
});
