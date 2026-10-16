import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission completion integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    createSubmissionSnapshot,
    lockSubmission,
  } = await import("../repositories/challenge.repository.js");
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
      await prisma.submissionSnapshot.deleteMany({
        where: { submission: { challengeId: { in: challengeIds } } },
      });
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

  test("locks a submission and stores an immutable snapshot with attachments", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Submission completion challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Completion Challenge",
        description: "A challenge used to verify submission completion.",
        difficulty: "MEDIUM",
        requirements: ["Submit the collected work"],
        optionalRequirements: [],
        deliverables: ["Snapshot artifacts"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "completion",
            name: "Completion",
            description: "The submitted snapshot is complete",
            maxPoints: 10,
            evaluationGuide: "Verify all collected artifacts",
            verificationMethod: "MANUAL_REVIEW",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: draft.id, approverId: authorId });
    const submission = await prisma.submission.create({
      data: {
        challengeId: draft.id,
        userId: studentId,
        channelId: "submission-channel",
        controlMessageId: "control-message",
        status: "OPEN",
      },
    });
    const submittedAt = new Date("2026-10-18T01:00:00.000Z");

    const locked = await lockSubmission(submission.id, submittedAt);
    const snapshot = await createSubmissionSnapshot({
      submissionId: submission.id,
      capturedAt: submittedAt,
      messageCount: 3,
      metadata: { channelId: "submission-channel", capturedAt: submittedAt.toISOString() },
      artifacts: [
        {
          type: "TEXT",
          source: "message-1",
          content: "Implementation\u0000 notes",
          sourceMessageId: "message-1",
        },
        {
          type: "FILE",
          source: "https://cdn.discordapp.com/attachments/result.zip",
          filename: "result.zip",
          mimeType: "application/zip",
          sizeBytes: 1024,
          sourceMessageId: "message-2",
          storageKey: "snapshots/result.zip",
        },
      ],
    });
    const stored = await prisma.submission.findUnique({
      where: { id: submission.id },
      include: { snapshots: { include: { artifacts: true } } },
    });

    assert.equal(locked.status, "SUBMITTED");
    assert.equal(locked.submittedAt?.getTime(), submittedAt.getTime());
    assert.equal(locked.lockedAt?.getTime(), submittedAt.getTime());
    assert.equal(snapshot.messageCount, 3);
    assert.equal(snapshot.capturedAt.getTime(), submittedAt.getTime());
    assert.equal(snapshot.artifacts.length, 2);
    assert.equal(snapshot.artifacts[0]?.content, "Implementation notes");
    assert.equal(snapshot.artifacts[1]?.filename, "result.zip");
    assert.equal(snapshot.artifacts[1]?.sizeBytes, 1024);
    assert.equal(stored?.status, "SUBMITTED");
    assert.equal(stored?.snapshots.length, 1);
    assert.equal(stored?.snapshots[0]?.artifacts.length, 2);
    await assert.rejects(
      () => lockSubmission(submission.id, new Date("2026-10-18T02:00:00.000Z")),
      /already completed or unavailable/,
    );
  });
}
