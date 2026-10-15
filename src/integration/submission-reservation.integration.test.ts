import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission reservation integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, reserveSubmission, setSubmissionChannel } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const studentId = randomUUID();

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

  test("reserves one submission per user and persists its channel", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Submission reservation challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Submission Challenge",
        description: "A challenge used to verify submission reservation.",
        difficulty: "EASY",
        requirements: ["Create a submission"],
        optionalRequirements: [],
        deliverables: ["Submission channel"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "RELATIVE", durationHours: 72 },
        maxScore: 10,
        rubric: [
          {
            code: "submission",
            name: "Submission",
            description: "The submission is registered correctly",
            maxPoints: 10,
            evaluationGuide: "Verify the unique submission record",
            verificationMethod: "MANUAL_REVIEW",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: draft.id, approverId: authorId });

    const firstReservation = await reserveSubmission({ challengeId: draft.id, userId: studentId });
    const secondReservation = await reserveSubmission({ challengeId: draft.id, userId: studentId });
    const connected = await setSubmissionChannel({
      submissionId: firstReservation.id,
      channelId: "submission-channel",
    });
    const stored = await prisma.submission.findUnique({ where: { id: firstReservation.id } });
    const count = await prisma.submission.count({
      where: { challengeId: draft.id, userId: studentId },
    });

    assert.equal(secondReservation.id, firstReservation.id);
    assert.equal(count, 1);
    assert.equal(firstReservation.status, "OPEN");
    assert.equal(firstReservation.channelId, null);
    assert.equal(connected.status, "OPEN");
    assert.equal(connected.channelId, "submission-channel");
    assert.equal(stored?.channelId, "submission-channel");
  });
}
