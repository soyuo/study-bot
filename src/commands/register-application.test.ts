import test from "node:test";
import assert from "node:assert/strict";
import type { Client, REST } from "discord.js";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.DISCORD_CLIENT_ID ??= "test-client-id";

const { registerApplicationCommands } = await import("./register.js");

test("registers all application commands through the configured REST route", async () => {
  const calls: Array<{ route: unknown; body: unknown }> = [];
  const restClient = {
    put: async (route: unknown, options: { body: unknown }) => {
      calls.push({ route, body: options.body });
      return [];
    },
  } as Pick<REST, "put">;
  const client = { user: { id: "bot-user-id" } } as Client;

  const result = await registerApplicationCommands(client, restClient);

  assert.equal(result, "bot-user-id");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.route, "/applications/test-client-id/commands");
  assert.ok(Array.isArray(calls[0]?.body));
  assert.deepEqual(
    (calls[0]?.body as Array<{ name: string }>).map((command) => command.name),
    [
      "regrade",
      "archive-retry",
      "config",
      "submission",
      "challenge-delete",
      "audit",
      "submission-delete",
      "health",
    ],
  );
});
