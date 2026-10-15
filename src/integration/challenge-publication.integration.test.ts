import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Challenge publication integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, setChallengePublicMessage } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const approverId = randomUUID();

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

  test("records public channel and message after an active challenge is published", async () => {
    const challenge = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Challenge source message",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Publication Challenge",
        description: "A challenge used to verify publication persistence.",
        difficulty: "MEDIUM",
        requirements: ["Publish the challenge"],
        optionalRequirements: [],
        deliverables: ["Published challenge"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "publication",
            name: "Publication",
            description: "The challenge is published correctly",
            maxPoints: 10,
            evaluationGuide: "Verify the stored public Discord identifiers",
            verificationMethod: "MANUAL_REVIEW",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: challenge.id, approverId });

    const published = await setChallengePublicMessage({
      challengeId: challenge.id,
      publicChannelId: "public-challenge-channel",
      publicMessageId: "public-challenge-message",
    });
    const stored = await prisma.challenge.findUnique({
      where: { id: challenge.id },
      include: { auditLogs: true },
    });

    assert.equal(published.status, "ACTIVE");
    assert.equal(published.publicChannelId, "public-challenge-channel");
    assert.equal(published.publicMessageId, "public-challenge-message");
    assert.equal(stored?.publicChannelId, "public-challenge-channel");
    assert.equal(stored?.publicMessageId, "public-challenge-message");
    const publicationLog = stored?.auditLogs.find((log) => log.action === "CHALLENGE_PUBLISHED");
    assert.ok(publicationLog);
    assert.equal(publicationLog.actorId, approverId);
    assert.deepEqual(publicationLog.metadata, {
      publicChannelId: "public-challenge-channel",
      publicMessageId: "public-challenge-message",
    });
  });
}
