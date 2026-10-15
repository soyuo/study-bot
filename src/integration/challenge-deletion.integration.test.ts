import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Challenge deletion integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, deleteChallengeWithSubmissions } = await import("../repositories/challenge.repository.js");
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

  test("deletes a challenge and submissions while preserving grades and artifacts", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Challenge deletion preservation test",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Deletion Challenge",
        description: "A challenge used to verify deletion preservation.",
        difficulty: "MEDIUM",
        requirements: ["Preserve historical records"],
        optionalRequirements: [],
        deliverables: ["Historical grade"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "history",
            name: "History",
            description: "Historical data remains available",
            maxPoints: 10,
            evaluationGuide: "Verify artifacts and grades survive deletion",
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
        messageCount: 1,
        artifacts: {
          create: {
            submissionId: submission.id,
            type: "FILE",
            source: "https://cdn.discordapp.com/result.zip",
            filename: "result.zip",
            storageKey: "submissions/result.zip",
            sizeBytes: 1024,
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
        totalScore: 8,
        maxScore: 10,
        status: "FAILED",
        feedback: "Needs improvement",
        results: {
          create: {
            criterionId: criterion.id,
            points: 8,
            feedback: "Partial completion",
            evidence: "Result artifact",
          },
        },
      },
    });

    const deleted = await deleteChallengeWithSubmissions({ challengeId: draft.id, actorId });
    const storedChallenge = await prisma.challenge.findUnique({ where: { id: draft.id } });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const storedArtifact = await prisma.submissionArtifact.findUnique({ where: { id: snapshot.artifacts[0]!.id } });
    const storedGrade = await prisma.grade.findUnique({
      where: { id: grade.id },
      include: { results: true },
    });
    const log = await prisma.auditLog.findFirst({
      where: { challengeId: draft.id, action: "CHALLENGE_DELETED" },
    });

    assert.equal(deleted.status, "DELETED");
    assert.equal(deleted.deletedSubmissionCount, 1);
    assert.equal(storedChallenge?.status, "DELETED");
    assert.ok(storedChallenge?.deletedAt);
    assert.equal(storedSubmission?.status, "DELETED");
    assert.ok(storedSubmission?.deletedAt);
    assert.equal(storedArtifact?.filename, "result.zip");
    assert.equal(storedArtifact?.deletedAt, null);
    assert.equal(storedGrade?.totalScore, 8);
    assert.equal(storedGrade?.results.length, 1);
    assert.equal(log?.actorId, actorId);
    assert.deepEqual(log?.metadata, {
      deletedSubmissionCount: 1,
      preservedArtifactsAndGrades: true,
    });
  });
}
