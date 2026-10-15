import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_TOKEN ||= "test-discord-token";
process.env.DISCORD_CLIENT_ID ||= "test-client-id";

const { parseConfig } = await import("./config.js");

const requiredEnvironment = {
  DISCORD_TOKEN: "discord-token",
  DISCORD_CLIENT_ID: "client-id",
};

test("config parser applies defaults and normalizes empty optional values", () => {
  const parsed = parseConfig({
    ...requiredEnvironment,
    DISCORD_GUILD_ID: "",
    GEMINI_API_KEY: "",
  });

  assert.equal(parsed.DISCORD_GUILD_ID, undefined);
  assert.equal(parsed.GEMINI_API_KEY, undefined);
  assert.equal(parsed.GEMINI_MODEL, "gemini-2.5-flash");
  assert.equal(parsed.LOG_LEVEL, "info");
  assert.equal(parsed.ARTIFACT_STORAGE_DIR, "data/artifacts");
});

test("config parser preserves configured optional values", () => {
  const parsed = parseConfig({
    ...requiredEnvironment,
    DISCORD_GUILD_ID: "guild-id",
    GEMINI_API_KEY: "gemini-key",
    LOG_LEVEL: "debug",
  });

  assert.equal(parsed.DISCORD_GUILD_ID, "guild-id");
  assert.equal(parsed.GEMINI_API_KEY, "gemini-key");
  assert.equal(parsed.LOG_LEVEL, "debug");
});

test("config parser rejects missing required values", () => {
  assert.throws(() => parseConfig({}), /Invalid environment configuration/);
});
