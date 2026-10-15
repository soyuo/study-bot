import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission deletion integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, deleteSubmissionPreservingHistory } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const actorId = randomUUID();
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

  test("deletes only the submission while preserving its history", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Submission deletion preservation test",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Submission Deletion Challenge",
        description: "A challenge used to verify submission deletion history.",
        difficulty: "EASY",
        requirements: ["Preserve submission history"],
        optionalRequirements: [],
        deliverables: ["Historical submission"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "history",
            name: "History",
            description: "The submission history remains available",
            maxPoints: 10,
            evaluationGuide: "Verify related records are preserved",
            verificationMethod: "MANUAL_REVIEW",
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
      data: { challengeId: draft.id, userId: studentId, status: "GRADED", channelId: "submission-channel" },
    });
    const snapshot = await prisma.submissionSnapshot.create({
      data: {
        submissionId: submission.id,
        messageCount: 2,
        artifacts: {
          create: {
            submissionId: submission.id,
            type: "TEXT",
            source: "message-1",
            content: "Submission content",
          },
        },
      },
      include: { artifacts: true },
    });
    const grade = await prisma.grade.create({
      data: {
        submissionId: submission.id,
        rubricVersionId: rubric.id,
        snapshotId: snapshot.id,
        totalScore: 7,
        maxScore: 10,
        status: "REVIEW_REQUIRED",
        feedback: "Needs administrator review",
        reviewRequired: true,
        results: {
          create: {
            criterionId: criterion.id,
            points: 7,
            feedback: "Partial evidence",
            evidence: "Submission content",
          },
        },
      },
    });

    const deleted = await deleteSubmissionPreservingHistory({ submissionId: submission.id, actorId });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const storedSnapshot = await prisma.submissionSnapshot.findUnique({
      where: { id: snapshot.id },
      include: { artifacts: true },
    });
    const storedGrade = await prisma.grade.findUnique({
      where: { id: grade.id },
      include: { results: true },
    });
    const log = await prisma.auditLog.findFirst({
      where: { submissionId: submission.id, action: "SUBMISSION_DELETED" },
    });

    assert.equal(deleted.status, "DELETED");
    assert.equal(storedSubmission?.status, "DELETED");
    assert.ok(storedSubmission?.deletedAt);
    assert.ok(storedSubmission?.lockedAt);
    assert.equal(storedSnapshot?.messageCount, 2);
    assert.equal(storedSnapshot?.artifacts.length, 1);
    assert.equal(storedSnapshot?.artifacts[0]?.content, "Submission content");
    assert.equal(storedGrade?.status, "REVIEW_REQUIRED");
    assert.equal(storedGrade?.totalScore, 7);
    assert.equal(storedGrade?.results.length, 1);
    assert.equal(log?.actorId, actorId);
    assert.deepEqual(log?.metadata, { preservedArtifactsAndGrades: true });
    await assert.rejects(
      () => deleteSubmissionPreservingHistory({ submissionId: submission.id, actorId }),
      /Submission not found/,
    );
  });
}
