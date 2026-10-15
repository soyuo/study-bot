import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Submission grading queue integration tests require TEST_DATABASE_URL",
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
      await prisma.job.deleteMany({ where: { guildConfigId: guildConfig.id } });
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

  test("queues one grading job and transitions a submitted submission to grading", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Grading queue challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Grading Queue Challenge",
        description: "A challenge used to verify grading queue registration.",
        difficulty: "HARD",
        requirements: ["Queue the grading job"],
        optionalRequirements: [],
        deliverables: ["Queued grading job"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "queue",
            name: "Queue",
            description: "The grading job is queued correctly",
            maxPoints: 10,
            evaluationGuide: "Verify the pending job and dedupe key",
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
        status: "SUBMITTED",
        submittedAt: new Date("2026-10-18T01:00:00.000Z"),
        lockedAt: new Date("2026-10-18T01:00:00.000Z"),
      },
    });
    const snapshot = await createSubmissionSnapshot({
      submissionId: submission.id,
      capturedAt: new Date("2026-10-18T01:00:00.000Z"),
      messageCount: 1,
      metadata: { channelId: "submission-channel" },
      artifacts: [{ type: "TEXT", source: "message-1", content: "Submitted work" }],
    });

    const queued = await queueSubmissionGrading({
      submissionId: submission.id,
      snapshotId: snapshot.id,
    });
    const storedSubmission = await prisma.submission.findUnique({ where: { id: submission.id } });
    const job = await prisma.job.findUnique({ where: { id: queued.jobId } });
    const log = await prisma.auditLog.findFirst({
      where: { submissionId: submission.id, action: "SUBMISSION_GRADING_QUEUED" },
    });

    assert.equal(queued.submissionId, submission.id);
    assert.equal(queued.snapshotId, snapshot.id);
    assert.equal(storedSubmission?.status, "GRADING");
    assert.equal(job?.type, "SUBMISSION_GRADING");
    assert.equal(job?.status, "PENDING");
    assert.equal(job?.submissionId, submission.id);
    assert.equal(job?.challengeId, draft.id);
    assert.equal(job?.dedupeKey, `SUBMISSION_GRADING:${submission.id}:${snapshot.id}`);
    assert.deepEqual(job?.payload, { snapshotId: snapshot.id });
    assert.equal(log?.actorId, studentId);
    assert.deepEqual(log?.metadata, {
      snapshotId: snapshot.id,
      jobId: job?.id,
      dedupeKey: job?.dedupeKey,
    });
    await assert.rejects(
      () => queueSubmissionGrading({ submissionId: submission.id, snapshotId: snapshot.id }),
      /not ready for grading/,
    );
  });
}
