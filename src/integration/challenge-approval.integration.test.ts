import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Challenge approval integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser, } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const approverId = randomUUID();
  const studentId = randomUUID();

  function parser(title: string) {
    return new MockChallengeParser({
      title,
      description: `Description for ${title}`,
      difficulty: "EASY",
      requirements: ["Implement the requested change"],
      optionalRequirements: [],
      deliverables: ["Source code"],
      allowedLanguages: ["TypeScript"],
      constraints: [],
      deadlinePolicy: { type: "NONE" },
      maxScore: 10,
      rubric: [
        {
          code: "correctness",
          name: "Correctness",
          description: "The implementation works as requested",
          maxPoints: 10,
          evaluationGuide: "Verify the expected behavior",
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

  test("approving a new challenge closes the previous challenge and locks its channel", async () => {
    const first = await createDraft("First Challenge");
    const firstActivatedAt = new Date("2026-10-16T01:00:00.000Z");
    await approveChallenge({
      challengeId: first.id,
      approverId,
      activatedAt: firstActivatedAt,
    });
    await prisma.challenge.update({
      where: { id: first.id },
      data: { deadline: new Date("2026-10-16T00:00:00.000Z") },
    });

    const submission = await prisma.submission.create({
      data: {
        challengeId: first.id,
        userId: studentId,
        channelId: "submission-channel-1",
        status: "OPEN",
      },
    });
    const second = await createDraft("Second Challenge");
    const secondActivatedAt = new Date("2026-10-17T01:00:00.000Z");

    const activated = await approveChallenge({
      challengeId: second.id,
      approverId,
      activatedAt: secondActivatedAt,
    });

    const storedFirst = await prisma.challenge.findUnique({
      where: { id: first.id },
      include: { rubrics: true, auditLogs: true },
    });
    const storedSecond = await prisma.challenge.findUnique({
      where: { id: second.id },
      include: { rubrics: true, auditLogs: true },
    });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const archive = await prisma.archiveRecord.findFirst({
      where: { challengeId: first.id, submissionId: submission.id },
    });

    assert.equal(activated.id, second.id);
    assert.equal(storedFirst?.status, "CLOSED");
    assert.equal(storedFirst?.closedAt?.getTime(), secondActivatedAt.getTime());
    assert.equal(storedSecond?.status, "ACTIVE");
    assert.equal(storedSecond?.activatedAt?.getTime(), secondActivatedAt.getTime());
    assert.equal(storedSecond?.approvedById, approverId);
    assert.equal(storedSecond?.rubrics[0]?.isFrozen, true);
    assert.equal(storedSubmission?.status, "LOCKED");
    assert.equal(storedSubmission?.lockedAt?.getTime(), secondActivatedAt.getTime());
    assert.equal(archive?.status, "PENDING");
    assert.equal(archive?.channelId, "submission-channel-1");
    assert.equal(
      storedFirst?.auditLogs.some((log) => log.action === "CHALLENGE_CLOSED_FOR_NEW_CHALLENGE"),
      true,
    );
    assert.equal(
      storedSecond?.auditLogs.some((log) => log.action === "CHALLENGE_APPROVED"),
      true,
    );
  });
}
