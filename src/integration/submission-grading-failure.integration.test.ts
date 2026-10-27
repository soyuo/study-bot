import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission grading failure integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    claimNextSubmissionGradingJob,
    createSubmissionSnapshot,
    failSubmissionGrading,
    queueSubmissionGrading,
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
      const submissions = await prisma.submission.findMany({
        where: { challengeId: { in: challengeIds } },
        select: { id: true },
      });
      const submissionIds = submissions.map((submission) => submission.id);

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.job.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.submissionSnapshot.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await prisma.submissionArtifact.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await prisma.submission.deleteMany({ where: { id: { in: submissionIds } } });
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

  test("reschedules transient grading failures and marks exhausted jobs failed", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Grading failure challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Grading Failure Challenge",
        description: "A challenge used to verify grading retry behavior.",
        difficulty: "HARD",
        requirements: ["Recover from grading failures"],
        optionalRequirements: [],
        deliverables: ["Failure state"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "recovery",
            name: "Recovery",
            description: "The grading job recovers or fails clearly",
            maxPoints: 10,
            evaluationGuide: "Verify retry and terminal failure state",
            verificationMethod: "STATIC_ANALYSIS",
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
        status: "SUBMITTED",
      },
    });
    const snapshot = await createSubmissionSnapshot({
      submissionId: submission.id,
      capturedAt: new Date("2026-10-18T01:00:00.000Z"),
      messageCount: 1,
      artifacts: [{ type: "TEXT", source: "message-1", content: "Submitted work" }],
    });
    const queued = await queueSubmissionGrading({ submissionId: submission.id, snapshotId: snapshot.id });
    const guildConfig = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId } });
    const now = new Date();

    const firstJob = await claimNextSubmissionGradingJob(now, guildConfig.id);
    assert.equal(firstJob?.id, queued.jobId);
    const firstFailure = await failSubmissionGrading({
      jobId: queued.jobId,
      submissionId: submission.id,
      errorMessage: "Temporary grader timeout",
      retryDelayMs: 0,
    });
    assert.equal(firstFailure.exhausted, false);
    assert.equal(firstFailure.attempt, 1);

    const secondJob = await claimNextSubmissionGradingJob(new Date(Date.now() + 1_000), guildConfig.id);
    assert.equal(secondJob?.id, queued.jobId);
    await failSubmissionGrading({
      jobId: queued.jobId,
      submissionId: submission.id,
      errorMessage: "Second grader timeout",
      retryDelayMs: 0,
    });

    const thirdJob = await claimNextSubmissionGradingJob(new Date(Date.now() + 1_000), guildConfig.id);
    assert.equal(thirdJob?.id, queued.jobId);
    const terminalFailure = await failSubmissionGrading({
      jobId: queued.jobId,
      submissionId: submission.id,
      errorMessage: "Persistent grader failure",
      retryDelayMs: 0,
    });
    const storedJob = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const logs = await prisma.auditLog.findMany({
      where: { submissionId: submission.id },
      orderBy: { createdAt: "asc" },
    });

    assert.equal(terminalFailure.exhausted, true);
    assert.equal(terminalFailure.attempt, 3);
    assert.equal(storedJob?.status, "FAILED");
    assert.equal(storedJob?.attempt, 3);
    assert.equal(storedJob?.lastError, "Persistent grader failure");
    assert.equal(storedSubmission?.status, "GRADING_FAILED");
    assert.equal(logs.filter((log) => log.action === "SUBMISSION_GRADING_RETRY_SCHEDULED").length, 2);
    assert.equal(logs.at(-1)?.action, "SUBMISSION_GRADING_FAILED");
  });
}
