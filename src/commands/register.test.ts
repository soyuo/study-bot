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
    "grade-finalize",
    "score",
    "archive-retry",
    "deadline",
    "config",
    "submission",
    "challenge-delete",
    "challenge-close",
    "challenge-archive",
    "audit",
    "submission-delete",
    "submission-reopen",
    "health",
  ]);
});

test("administrator commands require administrator permissions", () => {
  const commands = buildApplicationCommands();
  const administratorCommands = new Set([
    "regrade",
    "grade-finalize",
    "score",
    "archive-retry",
    "deadline",
    "config",
    "challenge-delete",
    "challenge-close",
    "challenge-archive",
    "audit",
    "submission-delete",
    "submission-reopen",
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
  const gradeFinalize = commands.find((command) => command.name === "grade-finalize");
  const score = commands.find((command) => command.name === "score");
  const deadline = commands.find((command) => command.name === "deadline");

  if (!config || !submission || !regrade || !gradeFinalize || !score || !deadline) throw new Error("Expected commands are missing");
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

  const gradeFinalizeOptions = gradeFinalize.options as Array<{ name: string; required?: boolean }>;
  assert.deepEqual(
    gradeFinalizeOptions.map((option) => [option.name, option.required, (option as { type?: number }).type]),
    [["grade_id", true, 3]],
  );

  const scoreOptions = score.options as Array<{ name: string; required?: boolean; type: number }>;
  assert.deepEqual(scoreOptions.map((option) => [option.name, option.type, option.required]), [["target", 6, true]]);

  const deadlineOptions = deadline.options as Array<{ name: string; required?: boolean; autocomplete?: boolean }>;
  assert.deepEqual(deadlineOptions.map((option) => [option.name, option.required]), [
    ["challenge_id", true],
    ["hours", false],
    ["date", false],
  ]);
  assert.equal(deadlineOptions[0]?.autocomplete, true);
});
