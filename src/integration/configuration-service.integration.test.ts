import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Guild configuration service integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";

  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { updateGuildConfiguration } = await import("../services/configuration.service.js");

  const guildId = randomUUID();
  const administratorId = randomUUID();

  after(async () => {
    await prisma.guildConfig.deleteMany({ where: { guildId } });
    await disconnectDatabase();
  });

  function createInteraction(input: {
    member: { isAdministrator: boolean };
    channels?: Record<string, { id: string; type: ChannelType } | null>;
    role?: { id: string } | null;
  }) {
    const channels = input.channels ?? {};
    const interaction = {
      guild: {
        id: guildId,
        members: {
          fetch: async () => ({
            permissions: { has: () => input.member.isAdministrator },
          }),
        },
      },
      user: { id: administratorId },
      options: {
        getChannel: (name: string) => channels[name] ?? null,
        getRole: () => input.role ?? null,
      },
    } as unknown as ChatInputCommandInteraction;
    return interaction;
  }

  test("administrator saves per-guild channel and role configuration", async () => {
    const result = await updateGuildConfiguration(
      createInteraction({
        member: { isAdministrator: true },
        channels: {
          challenge_channel: { id: "challenge-channel", type: ChannelType.GuildText },
          submission_category: { id: "submission-category", type: ChannelType.GuildCategory },
          archive_category: { id: "archive-category", type: ChannelType.GuildCategory },
        },
        role: { id: "admin-role" },
      }),
    );

    const stored = await prisma.guildConfig.findUnique({ where: { guildId } });
    assert.deepEqual(result, {
      challengeChannelId: "challenge-channel",
      submissionCategoryId: "submission-category",
      archiveCategoryId: "archive-category",
      adminRoleId: "admin-role",
    });
    assert.equal(stored?.guildId, guildId);
    assert.equal(stored?.timezone, "Asia/Seoul");
    assert.equal(stored?.maxAttachmentBytes, 10 * 1024 * 1024);
  });

  test("rejects an invalid challenge channel type", async () => {
    await assert.rejects(
      () =>
        updateGuildConfiguration(
          createInteraction({
            member: { isAdministrator: true },
            channels: {
              challenge_channel: { id: "voice-channel", type: ChannelType.GuildVoice },
            },
          }),
        ),
      /Challenge channel must be a text channel/,
    );
  });

  test("blocks non-administrators before changing configuration", async () => {
    await assert.rejects(
      () =>
        updateGuildConfiguration(
          createInteraction({
            member: { isAdministrator: false },
            channels: {
              challenge_channel: { id: "should-not-save", type: ChannelType.GuildText },
            },
          }),
        ),
      /Only administrators can change guild configuration/,
    );

    const stored = await prisma.guildConfig.findUnique({ where: { guildId } });
    assert.equal(stored?.challengeChannelId, "challenge-channel");
  });
}
