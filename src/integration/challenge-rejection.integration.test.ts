import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Challenge rejection integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { rejectChallenge } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const rejecterId = randomUUID();

  after(async () => {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    if (guildConfig) {
      const challenges = await prisma.challenge.findMany({
        where: { guildConfigId: guildConfig.id },
        select: { id: true },
      });
      const challengeIds = challenges.map((challenge) => challenge.id);

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
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

  test("rejects a draft challenge with a reason and audit history", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Challenge rejection test",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Rejected Challenge",
        description: "A challenge used to verify rejection behavior.",
        difficulty: "HARD",
        requirements: ["Meet the review criteria"],
        optionalRequirements: [],
        deliverables: ["Approved specification"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "review",
            name: "Review",
            description: "The specification passes review",
            maxPoints: 10,
            evaluationGuide: "Review the challenge specification",
            verificationMethod: "MANUAL_REVIEW",
          },
        ],
      }),
    });
    const reason = "Requirements are not sufficiently specific";

    const rejected = await rejectChallenge({
      challengeId: draft.id,
      rejecterId,
      reason,
    });
    const stored = await prisma.challenge.findUnique({ where: { id: draft.id } });
    const log = await prisma.auditLog.findFirst({
      where: { challengeId: draft.id, action: "CHALLENGE_REJECTED" },
    });

    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.rejectedById, rejecterId);
    assert.equal(rejected.rejectionReason, reason);
    assert.ok(rejected.rejectedAt);
    assert.equal(stored?.status, "REJECTED");
    assert.equal(log?.actorId, rejecterId);
    assert.deepEqual(log?.metadata, { reason });
    await assert.rejects(
      () => rejectChallenge({ challengeId: draft.id, rejecterId, reason: "Second rejection" }),
      /no longer awaiting approval/,
    );
  });
}
