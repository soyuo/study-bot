import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.DISCORD_CLIENT_ID ??= "test-client-id";

const { buildApplicationCommands } = await import("./register.js");

test("application commands expose the expected command set", () => {
  const commands = buildApplicationCommands();
  const names = commands.map((command) => command.name);

  assert.deepEqual(names, [
    "regrade",
    "archive-retry",
    "config",
    "submission",
    "challenge-delete",
    "audit",
    "submission-delete",
    "health",
  ]);
});

test("administrator commands require administrator permissions", () => {
  const commands = buildApplicationCommands();
  const administratorCommands = new Set([
    "regrade",
    "archive-retry",
    "config",
    "challenge-delete",
    "audit",
    "submission-delete",
    "health",
  ]);

  for (const command of commands) {
    if (administratorCommands.has(command.name)) {
      assert.equal(command.default_member_permissions, "8", command.name);
    } else {
      assert.equal(command.default_member_permissions, undefined, command.name);
    }
  }
});

test("config and submission commands preserve required option contracts", () => {
  const commands = buildApplicationCommands();
  const config = commands.find((command) => command.name === "config");
  const submission = commands.find((command) => command.name === "submission");
  const regrade = commands.find((command) => command.name === "regrade");

  if (!config || !submission || !regrade) throw new Error("Expected commands are missing");
  const configOptions = config.options as Array<{
    name: string;
    type: number;
    required?: boolean;
    channel_types?: number[];
  }>;
  assert.deepEqual(
    configOptions.map((option) => [option.name, option.type, option.required]),
    [
      ["challenge_channel", 7, false],
      ["submission_category", 7, false],
      ["archive_category", 7, false],
      ["admin_role", 8, false],
    ],
  );
  assert.equal(configOptions[0]?.channel_types?.[0], 0);
  assert.equal(configOptions[1]?.channel_types?.[0], 4);
  assert.equal(configOptions[2]?.channel_types?.[0], 4);

  const submissionOptions = submission.options as Array<{
    name: string;
    options?: Array<{ required?: boolean }>;
  }>;
  assert.deepEqual(submissionOptions.map((option) => option.name), ["status", "inspect"]);
  assert.equal(submissionOptions[0]?.options?.[0]?.required, true);
  assert.equal(submissionOptions[1]?.options?.[0]?.required, true);

  const regradeOptions = regrade.options as Array<{ name: string; required?: boolean }>;
  assert.equal(regradeOptions[0]?.name, "submission_id");
  assert.equal(regradeOptions[0]?.required, true);
});
