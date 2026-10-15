import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Archive processing integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    completeArchiveRecord,
    failArchiveRecord,
    retryFailedArchiveRecords,
  } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const approverId = randomUUID();
  const studentId = randomUUID();
  const retryActorId = randomUUID();

  function challengeParser(title: string) {
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
      parser: challengeParser(title),
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

  test("fails, retries, and completes an archive record", async () => {
    const first = await createDraft("Archive Source Challenge");
    await approveChallenge({ challengeId: first.id, approverId, activatedAt: new Date("2026-10-19T01:00:00.000Z") });
    const submission = await prisma.submission.create({
      data: {
        challengeId: first.id,
        userId: studentId,
        channelId: "submission-channel",
        status: "OPEN",
      },
    });

    const replacement = await createDraft("Archive Replacement Challenge");
    await approveChallenge({
      challengeId: replacement.id,
      approverId,
      activatedAt: new Date("2026-10-20T01:00:00.000Z"),
    });
    const archive = await prisma.archiveRecord.findFirstOrThrow({
      where: { challengeId: first.id, submissionId: submission.id },
    });
    const guildConfig = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId } });

    const failed = await failArchiveRecord(archive.id, "Archive category unavailable");
    assert.equal(failed.count, 1);
    let stored = await prisma.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });
    assert.equal(stored.status, "FAILED");
    assert.equal(stored.errorMessage, "Archive category unavailable");

    const retry = await retryFailedArchiveRecords({
      guildConfigId: guildConfig.id,
      actorId: retryActorId,
    });
    assert.deepEqual(retry, { count: 1, recordIds: [archive.id] });
    stored = await prisma.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.errorMessage, null);
    assert.ok(stored.startedAt);

    const completed = await completeArchiveRecord(archive.id, "archive-category");
    stored = await prisma.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });
    const retryLog = await prisma.auditLog.findFirst({
      where: { action: "ARCHIVE_RETRY_QUEUED", guildConfigId: guildConfig.id },
    });

    assert.equal(completed.count, 1);
    assert.equal(stored.status, "COMPLETED");
    assert.equal(stored.categoryId, "archive-category");
    assert.ok(stored.completedAt);
    assert.equal(retryLog?.actorId, retryActorId);
    assert.deepEqual(retryLog?.metadata, { count: 1, recordIds: [archive.id] });
  });
}
