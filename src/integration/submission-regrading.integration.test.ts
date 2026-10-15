import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission regrading integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, queueSubmissionRegrading } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const studentId = randomUUID();
  const actorId = randomUUID();

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
      await prisma.submissionSnapshot.deleteMany({ where: { submissionId: { in: submissionIds } } });
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

  test("queues regrading against the latest snapshot without deleting the prior grade", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Regrading challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Regrading Challenge",
        description: "A challenge used to verify regrading behavior.",
        difficulty: "MEDIUM",
        requirements: ["Request regrading"],
        optionalRequirements: [],
        deliverables: ["Preserved grade"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "regrade",
            name: "Regrade",
            description: "The submission can be regraded",
            maxPoints: 10,
            evaluationGuide: "Verify the new job and old grade",
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
      data: { challengeId: draft.id, userId: studentId, status: "GRADED" },
    });
    const snapshot = await prisma.submissionSnapshot.create({
      data: {
        submissionId: submission.id,
        capturedAt: new Date("2026-10-18T01:00:00.000Z"),
        messageCount: 1,
        artifacts: {
          create: {
            submissionId: submission.id,
            type: "TEXT",
            source: "message-1",
            content: "Original submission",
          },
        },
      },
    });
    const previousGrade = await prisma.grade.create({
      data: {
        submissionId: submission.id,
        rubricVersionId: rubric.id,
        snapshotId: snapshot.id,
        attempt: 1,
        totalScore: 8,
        maxScore: 10,
        status: "FAILED",
        feedback: "Needs improvement",
        modelName: "previous-model",
        results: {
          create: {
            criterionId: criterion.id,
            points: 8,
            feedback: "Partial result",
            evidence: "Original evidence",
          },
        },
      },
    });

    const queued = await queueSubmissionRegrading({ submissionId: submission.id, actorId });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const job = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const grades = await prisma.grade.findMany({ where: { submissionId: submission.id } });
    const log = await prisma.auditLog.findFirst({
      where: { submissionId: submission.id, action: "SUBMISSION_REGRADING_QUEUED" },
    });

    assert.equal(queued.submissionId, submission.id);
    assert.equal(queued.snapshotId, snapshot.id);
    assert.equal(storedSubmission?.status, "GRADING");
    assert.equal(job?.type, "SUBMISSION_REGRADING");
    assert.equal(job?.status, "PENDING");
    assert.equal(job?.payload && JSON.stringify(job.payload), JSON.stringify({ snapshotId: snapshot.id, actorId }));
    assert.equal(grades.length, 1);
    assert.equal(grades[0]?.id, previousGrade.id);
    assert.equal(log?.actorId, actorId);
    assert.equal(log?.metadata && JSON.stringify(log.metadata).includes(snapshot.id), true);
    await assert.rejects(
      () => queueSubmissionRegrading({ submissionId: submission.id, actorId }),
      /Only graded or failed submissions can be regraded/,
    );
  });
}
