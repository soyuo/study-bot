import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission lifecycle integration tests require TEST_DATABASE_URL",
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
    queueSubmissionGrading,
    reserveSubmission,
    setSubmissionChannel,
  } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { buildChallengePublicEmbed } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");
  const { processNextSubmissionGradingJob } = await import("../workers/submission-grading.worker.js");

  const guildId = randomUUID();
  const authorId = randomUUID();
  const approverId = randomUUID();
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

  test("runs approval, submission, snapshot, and grading as one lifecycle", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "End-to-end submission lifecycle",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Lifecycle Challenge",
        description: "A challenge covering approval through grading.",
        difficulty: "MEDIUM",
        requirements: ["Complete the implementation"],
        optionalRequirements: [],
        deliverables: ["A verified artifact"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "RELATIVE", durationHours: 72 },
        maxScore: 10,
        rubric: [
          {
            code: "lifecycle",
            name: "Lifecycle",
            description: "The lifecycle completes successfully",
            maxPoints: 10,
            evaluationGuide: "Verify the stored artifact and grade",
            verificationMethod: "STATIC_ANALYSIS",
          },
        ],
      }),
    });
    const activated = await approveChallenge({ challengeId: draft.id, approverId });
    const publicEmbed = buildChallengePublicEmbed({
      id: activated.id,
      title: activated.title,
      description: activated.description,
      difficulty: activated.difficulty,
      requirements: ["Complete the implementation"],
      deliverables: ["A verified artifact"],
      deadline: activated.deadline,
      maxScore: activated.maxScore,
    }).toJSON();

    const reserved = await reserveSubmission({ challengeId: draft.id, userId: studentId });
    const connected = await setSubmissionChannel({ submissionId: reserved.id, channelId: "submission-channel" });
    const submittedAt = new Date("2026-10-18T01:00:00.000Z");
    const locked = await lockSubmission(reserved.id, submittedAt);
    const snapshot = await createSubmissionSnapshot({
      submissionId: reserved.id,
      capturedAt: submittedAt,
      messageCount: 2,
      metadata: { channelId: "submission-channel" },
      artifacts: [
        { type: "TEXT", source: "message-1", content: "Implementation complete", sourceMessageId: "message-1" },
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
    const queued = await queueSubmissionGrading({ submissionId: reserved.id, snapshotId: snapshot.id });
    const rubric = await prisma.rubricVersion.findFirstOrThrow({
      where: { challengeId: draft.id, isFrozen: true },
      include: { criteria: true },
    });
    const criterion = rubric.criteria[0];
    assert.ok(criterion);

    const processed = await processNextSubmissionGradingJob(
      {
        grade: async () => ({
          criteria: [{ criterionId: criterion.id, score: 10, maxScore: 10, feedback: "Complete", evidence: ["Artifact"] }],
          summary: "The submission is complete.",
          improvements: [],
        }),
      },
      "test-grader",
    );
    const storedSubmission = await prisma.submission.findUnique({
      where: { id: reserved.id },
      include: { snapshots: { include: { artifacts: true } } },
    });
    const job = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const grade = await prisma.grade.findFirst({ where: { submissionId: reserved.id } });

    assert.equal(activated.status, "ACTIVE");
    assert.equal(publicEmbed.title, "Challenge: Lifecycle Challenge");
    assert.equal(connected.channelId, "submission-channel");
    assert.equal(locked.status, "SUBMITTED");
    assert.equal(storedSubmission?.snapshots[0]?.artifacts.length, 2);
    assert.equal(storedSubmission?.snapshots[0]?.artifacts[1]?.filename, "result.zip");
    assert.equal(processed.processed, true);
    assert.equal(job?.status, "SUCCEEDED");
    assert.equal(grade?.status, "PASSED");
    assert.equal(grade?.totalScore, 10);
  });
}
