import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission grading worker integration tests require TEST_DATABASE_URL",
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
  } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");
  const { processNextSubmissionGradingJob } = await import("../workers/submission-grading.worker.js");

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
      const grades = await prisma.grade.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { id: true },
      });
      const gradeIds = grades.map((grade) => grade.id);

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.gradeCriterionResult.deleteMany({ where: { gradeId: { in: gradeIds } } });
      await prisma.grade.deleteMany({ where: { id: { in: gradeIds } } });
      await prisma.job.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.submissionSnapshot.deleteMany({
        where: { submissionId: { in: submissionIds } },
      });
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

  test("claims a grading job and persists a validated grade", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Grading worker challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Grading Worker Challenge",
        description: "A challenge used to verify the grading worker.",
        difficulty: "MEDIUM",
        requirements: ["Process the grading job"],
        optionalRequirements: [],
        deliverables: ["Stored grade"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "worker",
            name: "Worker",
            description: "The worker stores a valid result",
            maxPoints: 10,
            evaluationGuide: "Verify the grade and criterion result",
            verificationMethod: "STATIC_ANALYSIS",
          },
        ],
      }),
    });
    await approveChallenge({ challengeId: draft.id, approverId: authorId });
    const rubric = await prisma.rubricVersion.findFirstOrThrow({
      where: { challengeId: draft.id, isFrozen: true },
      include: { criteria: true },
    });
    const criterion = rubric.criteria[0];
    assert.ok(criterion);

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
      artifacts: [{ type: "TEXT", source: "message-1", content: "Valid implementation" }],
    });
    const queued = await queueSubmissionGrading({
      submissionId: submission.id,
      snapshotId: snapshot.id,
    });
    const result = await processNextSubmissionGradingJob(
      {
        grade: async () => ({
          criteria: [
            {
              criterionId: criterion.id,
              score: 10,
              maxScore: 10,
              feedback: "The implementation is complete",
              evidence: ["Implementation artifact is present"],
            },
          ],
          summary: "The submission satisfies the rubric.",
          improvements: [],
        }),
      },
      "test-grader",
    );
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const job = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const grade = await prisma.grade.findFirst({
      where: { submissionId: submission.id },
      include: { results: true },
    });
    const log = await prisma.auditLog.findFirst({
      where: { submissionId: submission.id, action: "SUBMISSION_GRADED" },
    });

    assert.equal(result.processed, true);
    assert.ok(result.gradeId);
    assert.equal(storedSubmission?.status, "GRADED");
    assert.equal(job?.status, "SUCCEEDED");
    assert.equal(job?.attempt, 1);
    assert.equal(grade?.id, result.gradeId);
    assert.equal(grade?.totalScore, 10);
    assert.equal(grade?.maxScore, 10);
    assert.equal(grade?.status, "PASSED");
    assert.equal(grade?.modelName, "test-grader");
    assert.equal(grade?.results.length, 1);
    assert.equal(grade?.results[0]?.criterionId, criterion.id);
    assert.equal(grade?.results[0]?.points, 10);
    assert.equal(log?.entityId, grade?.id);
  });
}
