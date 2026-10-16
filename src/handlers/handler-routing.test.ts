import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.DISCORD_CLIENT_ID ??= "test-client-id";

const { shouldProcessChallengeMessage } = await import("./message-create.js");
const { resolveInteractionRoute } = await import("./interaction-create.js");

function createMessage(input: {
  bot?: boolean;
  guild?: boolean;
  channelId?: string;
  content?: string;
  attachmentCount?: number;
  administrator?: boolean;
}) {
  return {
    author: { bot: input.bot ?? false },
    guild: input.guild === false ? null : { id: "guild-id" },
    channelId: input.channelId ?? "challenge-channel",
    content: input.content ?? "Challenge content",
    attachments: { size: input.attachmentCount ?? 0 },
    member: {
      permissions: { has: () => input.administrator ?? false },
      roles: { cache: { has: () => false } },
    },
  } as never;
}

test("challenge message routing accepts only configured administrator messages", () => {
  const guildConfig = { challengeChannelId: "challenge-channel", adminRoleId: "admin-role" };

  assert.equal(shouldProcessChallengeMessage(createMessage({ administrator: true }), guildConfig), true);
  assert.equal(
    shouldProcessChallengeMessage(createMessage({ administrator: true, channelId: "general" }), guildConfig),
    false,
  );
  assert.equal(
    shouldProcessChallengeMessage(createMessage({ administrator: true, content: "", attachmentCount: 0 }), guildConfig),
    false,
  );
  assert.equal(shouldProcessChallengeMessage(createMessage({ bot: true, administrator: true }), guildConfig), false);
  assert.equal(shouldProcessChallengeMessage(createMessage({ administrator: false }), guildConfig), false);
});

test("interaction routing resolves slash commands and custom button IDs", () => {
  assert.deepEqual(resolveInteractionRoute({ kind: "chat", commandName: "config" }), {
    kind: "chat",
    commandName: "config",
  });
  assert.deepEqual(resolveInteractionRoute({ kind: "button", customId: "challenge:approve:challenge-1" }), {
    kind: "button",
    action: "challenge:approve",
    resourceId: "challenge-1",
  });
  assert.deepEqual(resolveInteractionRoute({ kind: "button", customId: "challenge:hint:challenge-1" }), {
    kind: "button",
    action: "challenge:hint",
    resourceId: "challenge-1",
  });
  assert.equal(resolveInteractionRoute({ kind: "button", customId: "not-a-custom-id" }), null);
  assert.equal(resolveInteractionRoute({ kind: "other" }), null);
});
