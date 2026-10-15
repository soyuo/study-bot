import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission grading recovery integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    createSubmissionSnapshot,
    queueSubmissionGrading,
    recoverStaleSubmissionGradingJobs,
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

  test("requeues recoverable stale jobs and fails exhausted stale jobs", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Stale grading recovery challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Stale Recovery Challenge",
        description: "A challenge used to verify stale grading recovery.",
        difficulty: "MEDIUM",
        requirements: ["Recover stale work"],
        optionalRequirements: [],
        deliverables: ["Recovery state"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "recovery",
            name: "Recovery",
            description: "The stale job is recovered correctly",
            maxPoints: 10,
            evaluationGuide: "Verify requeue and terminal failure paths",
            verificationMethod: "STATIC_ANALYSIS",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: draft.id, approverId: authorId });
    const submission = await prisma.submission.create({
      data: { challengeId: draft.id, userId: studentId, status: "SUBMITTED" },
    });
    const snapshot = await createSubmissionSnapshot({
      submissionId: submission.id,
      capturedAt: new Date("2026-10-18T01:00:00.000Z"),
      messageCount: 1,
      artifacts: [{ type: "TEXT", source: "message-1", content: "Submitted work" }],
    });
    const queued = await queueSubmissionGrading({ submissionId: submission.id, snapshotId: snapshot.id });
    const now = new Date("2026-10-18T02:00:00.000Z");
    await prisma.job.update({
      where: { id: queued.jobId },
      data: { status: "RUNNING", attempt: 1, startedAt: new Date("2026-10-18T00:00:00.000Z") },
    });

    const requeued = await recoverStaleSubmissionGradingJobs(now, 5 * 60_000);
    const requeuedJob = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const recoveredSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.deepEqual(requeued, { recovered: 1, exhausted: 0 });
    assert.equal(requeuedJob?.status, "PENDING");
    assert.equal(requeuedJob?.attempt, 1);
    assert.equal(requeuedJob?.startedAt, null);
    assert.equal(requeuedJob?.availableAt.getTime(), now.getTime());
    assert.equal(recoveredSubmission?.status, "GRADING");

    await prisma.job.update({
      where: { id: queued.jobId },
      data: { status: "RUNNING", attempt: 3, startedAt: new Date("2026-10-18T00:00:00.000Z") },
    });
    const exhausted = await recoverStaleSubmissionGradingJobs(now, 5 * 60_000);
    const failedJob = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const failedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const logs = await prisma.auditLog.findMany({
      where: { submissionId: submission.id },
      orderBy: { createdAt: "asc" },
    });

    assert.deepEqual(exhausted, { recovered: 1, exhausted: 1 });
    assert.equal(failedJob?.status, "FAILED");
    assert.equal(failedJob?.finishedAt?.getTime(), now.getTime());
    assert.equal(failedJob?.lastError, "Recovered stale grading job after 300000ms");
    assert.equal(failedSubmission?.status, "GRADING_FAILED");
    assert.equal(logs.some((log) => log.action === "STALE_GRADING_JOB_REQUEUED"), true);
    assert.equal(logs.some((log) => log.action === "STALE_GRADING_JOB_FAILED"), true);
  });
}
