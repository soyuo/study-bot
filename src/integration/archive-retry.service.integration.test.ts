import test, { after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Archive retry service integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";

  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    failArchiveRecord,
    updateGuildConfig,
  } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");
  const { retryArchivesFromInteraction } = await import("../services/archive-retry.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const approverId = randomUUID();
  const studentId = randomUUID();
  const adminId = randomUUID();
  const adminRoleId = "archive-admin-role";

  function parser(title: string) {
    return new MockChallengeParser({
      title,
      description: `Description for ${title}`,
      difficulty: "EASY",
      requirements: ["Complete the challenge"],
      optionalRequirements: [],
      deliverables: ["Source code"],
      allowedLanguages: ["TypeScript"],
      constraints: [],
      deadlinePolicy: { type: "NONE" },
      maxScore: 10,
      rubric: [
        {
          code: "quality",
          name: "Quality",
          description: "The implementation is correct",
          maxPoints: 10,
          evaluationGuide: "Review the implementation",
          verificationMethod: "MANUAL_REVIEW",
        },
      ],
    });
  }

  async function createDraft(title: string) {
    return createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: `${title}-source-message`,
        sourceContent: `Original content for ${title}`,
        sourceAttachments: [],
      },
      parser: parser(title),
    });
  }

  after(async () => {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    if (guildConfig) {
      const challenges = await prisma.challenge.findMany({
        where: { guildConfigId: guildConfig.id },
        select: { id: true },
      });
      const challengeIds = challenges.map((challenge) => challenge.id);

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.archiveRecord.deleteMany({ where: { challengeId: { in: challengeIds } } });
      await prisma.submissionArtifact.deleteMany({ where: { submission: { challengeId: { in: challengeIds } } } });
      await prisma.submission.deleteMany({ where: { challengeId: { in: challengeIds } } });
      for (const challengeId of challengeIds) {
        const rubrics = await prisma.rubricVersion.findMany({
          where: { challengeId },
          select: { id: true },
        });
        for (const rubric of rubrics) {
          await prisma.gradingCriterion.deleteMany({ where: { rubricVersionId: rubric.id } });
        }
        await prisma.rubricVersion.deleteMany({ where: { challengeId } });
        await prisma.challenge.delete({ where: { id: challengeId } });
      }
      await prisma.guildConfig.delete({ where: { id: guildConfig.id } });
    }
    await disconnectDatabase();
  });

  test("retries archive work through Discord channel mocks", async () => {
    const first = await createDraft("Mock Archive Source");
    await approveChallenge({ challengeId: first.id, approverId });
    const submission = await prisma.submission.create({
      data: {
        challengeId: first.id,
        userId: studentId,
        channelId: "submission-channel",
        status: "OPEN",
      },
    });
    await prisma.challenge.update({
      where: { id: first.id },
      data: { deadline: new Date("2026-10-19T00:00:00.000Z") },
    });
    const replacement = await createDraft("Mock Archive Replacement");
    await approveChallenge({ challengeId: replacement.id, approverId });
    const archive = await prisma.archiveRecord.findFirstOrThrow({
      where: { challengeId: first.id, submissionId: submission.id },
    });
    await failArchiveRecord(archive.id, "transient archive failure");
    await updateGuildConfig({
      guildId,
      archiveCategoryId: "archive-category",
      adminRoleId,
    });

    const permissionEdits: Array<{ userId: string; permissions: Record<string, boolean> }> = [];
    const parentChanges: Array<{ categoryId: string; options: { lockPermissions: boolean; reason: string } }> = [];
    const submissionChannel = {
      id: "submission-channel",
      type: ChannelType.GuildText,
      permissionOverwrites: {
        edit: async (userId: string, permissions: Record<string, boolean>) => {
          permissionEdits.push({ userId, permissions });
        },
      },
      setParent: async (categoryId: string, options: { lockPermissions: boolean; reason: string }) => {
        parentChanges.push({ categoryId, options });
      },
    };
    const archiveCategory = { id: "archive-category", type: ChannelType.GuildCategory };
    const guild = {
      id: guildId,
      members: {
        fetch: async (userId: string) => ({
          id: userId,
          permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.Administrator && false },
          roles: { cache: { has: (roleId: string) => roleId === adminRoleId } },
        }),
      },
      channels: {
        fetch: async (channelId: string) => channelId === "submission-channel" ? submissionChannel : archiveCategory,
      },
    };
    const interaction = {
      guild,
      user: { id: adminId },
    } as unknown as ChatInputCommandInteraction;

    const result = await retryArchivesFromInteraction(interaction);
    const stored = await prisma.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });

    assert.deepEqual(result, { queued: 1, completed: 1 });
    assert.equal(permissionEdits.length, 1);
    assert.equal(permissionEdits[0]?.userId, studentId);
    assert.equal(permissionEdits[0]?.permissions.ViewChannel, false);
    assert.equal(permissionEdits[0]?.permissions.SendMessages, false);
    assert.deepEqual(parentChanges, [
      {
        categoryId: "archive-category",
        options: { lockPermissions: true, reason: "Retry archived submission" },
      },
    ]);
    assert.equal(stored.status, "COMPLETED");
    assert.equal(stored.categoryId, "archive-category");
  });
}
