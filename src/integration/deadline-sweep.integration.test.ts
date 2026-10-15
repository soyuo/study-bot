import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "discord.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Deadline sweep integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");
  const { runDeadlineSweep } = await import("../services/deadline.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const studentOneId = randomUUID();
  const studentTwoId = randomUUID();

  after(async () => {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    if (guildConfig) {
      const challenges = await prisma.challenge.findMany({
        where: { guildConfigId: guildConfig.id },
        select: { id: true },
      });
      const challengeIds = challenges.map((challenge) => challenge.id);
      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
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

  test("closes expired challenges and locks every submission channel", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Deadline sweep challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Deadline Challenge",
        description: "A challenge used to verify deadline sweep behavior.",
        difficulty: "MEDIUM",
        requirements: ["Submit before the deadline"],
        optionalRequirements: [],
        deliverables: ["Submission"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "deadline",
            name: "Deadline",
            description: "The deadline is enforced correctly",
            maxPoints: 10,
            evaluationGuide: "Verify all channels are locked",
            verificationMethod: "MANUAL_REVIEW",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: draft.id, approverId: authorId });
    const now = new Date("2026-10-21T01:00:00.000Z");
    const expiredAt = new Date("2026-10-21T00:00:00.000Z");
    await prisma.challenge.update({ where: { id: draft.id }, data: { deadline: expiredAt } });
    const openSubmission = await prisma.submission.create({
      data: { challengeId: draft.id, userId: studentOneId, channelId: "open-channel", status: "OPEN" },
    });
    const submittedSubmission = await prisma.submission.create({
      data: {
        challengeId: draft.id,
        userId: studentTwoId,
        channelId: "submitted-channel",
        status: "SUBMITTED",
        submittedAt: new Date("2026-10-20T23:00:00.000Z"),
        lockedAt: new Date("2026-10-20T23:00:00.000Z"),
      },
    });
    const permissionEdits: Array<{ channelId: string; userId: string; permissions: Record<string, boolean> }> = [];
    const client = {
      channels: {
        fetch: async (channelId: string) => ({
          id: channelId,
          isTextBased: () => true,
          permissionOverwrites: {
            edit: async (userId: string, permissions: Record<string, boolean>) => {
              permissionEdits.push({ channelId, userId, permissions });
            },
          },
        }),
      },
    } as unknown as Client;

    const result = await runDeadlineSweep(client, now);
    const challenge = await prisma.challenge.findUnique({ where: { id: draft.id } });
    const open = await prisma.submission.findUnique({ where: { id: openSubmission.id } });
    const submitted = await prisma.submission.findUnique({ where: { id: submittedSubmission.id } });
    const log = await prisma.auditLog.findFirst({
      where: { challengeId: draft.id, action: "CHALLENGE_CLOSED_DEADLINE" },
    });

    assert.deepEqual(result, { expiredSubmissions: 2, lockedChannels: 2 });
    assert.equal(challenge?.status, "CLOSED");
    assert.equal(challenge?.closedAt?.getTime(), now.getTime());
    assert.equal(open?.status, "LOCKED");
    assert.equal(open?.lockedAt?.getTime(), now.getTime());
    assert.equal(submitted?.status, "SUBMITTED");
    assert.equal(permissionEdits.length, 2);
    assert.equal(permissionEdits.some((edit) => edit.channelId === "open-channel" && edit.userId === studentOneId), true);
    assert.equal(permissionEdits.some((edit) => edit.channelId === "submitted-channel" && edit.userId === studentTwoId), true);
    assert.equal(permissionEdits.every((edit) => edit.permissions.SendMessages === false), true);
    assert.equal(log?.metadata && JSON.stringify(log.metadata).includes(expiredAt.toISOString()), true);
  });
}
