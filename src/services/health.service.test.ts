import test from "node:test";
import assert from "node:assert/strict";
import { formatUptime } from "./health.service.js";

test("health uptime formatter renders days, hours, minutes, and seconds", () => {
  assert.equal(formatUptime(90_061), "1d 1h 1m 1s");
});

test("health uptime formatter floors fractional seconds", () => {
  assert.equal(formatUptime(61.99), "0d 0h 1m 1s");
});

test("health uptime formatter clamps negative uptime to zero", () => {
  assert.equal(formatUptime(-1), "0d 0h 0m 0s");
});
