import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatInputCommandInteraction, Client } from "discord.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Operations integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, connectDatabase, disconnectDatabase } = await import("../db/prisma.js");
  const { approveChallenge, createSubmissionSnapshot } = await import("../repositories/challenge.repository.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");
  const { getAuditLogEmbed } = await import("../services/audit-query.service.js");
  const { getHealthEmbed } = await import("../services/health.service.js");
  const { getSubmissionQueryEmbed } = await import("../services/submission-query.service.js");

  await connectDatabase();

  const guildId = randomUUID();
  const authorId = randomUUID();
  const studentId = randomUUID();
  const adminId = randomUUID();

  function interaction(input: { userId: string; administrator: boolean; guild?: boolean }) {
    return {
      guild: input.guild === false ? null : {
        id: guildId,
        members: { fetch: async () => ({ permissions: { has: () => input.administrator } }) },
      },
      user: { id: input.userId },
      member: { permissions: { has: () => input.administrator }, roles: { cache: { has: () => false } } },
    } as unknown as ChatInputCommandInteraction;
  }

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
        const rubrics = await prisma.rubricVersion.findMany({ where: { challengeId }, select: { id: true } });
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

  test("supports submission, audit, health queries and a live database connection", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Operations query test",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Operations Challenge",
        description: "A challenge used to verify operations queries.",
        difficulty: "EASY",
        requirements: ["Complete the task"],
        optionalRequirements: [],
        deliverables: ["A result"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [{
          code: "ops",
          name: "Operations",
          description: "The result is valid",
          maxPoints: 10,
          evaluationGuide: "Inspect the stored result",
          verificationMethod: "STATIC_ANALYSIS",
        }],
      }),
    });
    const active = await approveChallenge({ challengeId: draft.id, approverId: adminId });
    const rubric = await prisma.rubricVersion.findFirstOrThrow({
      where: { challengeId: draft.id, isFrozen: true },
      include: { criteria: true },
    });
    const criterion = rubric.criteria[0];
    assert.ok(criterion);
    const submission = await prisma.submission.create({
      data: { challengeId: active.id, userId: studentId, channelId: "submission-channel", status: "GRADED", submittedAt: new Date() },
    });
    const snapshot = await createSubmissionSnapshot({
      submissionId: submission.id,
      capturedAt: new Date(),
      messageCount: 1,
      artifacts: [{ type: "TEXT", source: "message-1", content: "Result" }],
    });
    const grade = await prisma.grade.create({
      data: {
        submissionId: submission.id,
        rubricVersionId: rubric.id,
        snapshotId: snapshot.id,
        totalScore: 10,
        maxScore: 10,
        status: "PASSED",
        feedback: "All checks passed",
        modelName: "test-model",
        results: { create: { criterionId: criterion.id, points: 10, feedback: "Valid", evidence: "Result artifact" } },
      },
    });
    const guildConfig = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId } });
    await prisma.auditLog.create({
      data: {
        guildConfigId: guildConfig.id,
        actorId: adminId,
        action: "OPERATIONS_TEST",
        entityType: "Submission",
        entityId: submission.id,
        submissionId: submission.id,
        metadata: { gradeId: grade.id },
      },
    });

    const statusEmbed = await getSubmissionQueryEmbed(interaction({ userId: studentId, administrator: false }), submission.id, false);
    const inspectionEmbed = await getSubmissionQueryEmbed(interaction({ userId: adminId, administrator: true }), submission.id, true);
    const auditEmbed = await getAuditLogEmbed(interaction({ userId: adminId, administrator: true }), submission.id);
    const healthEmbed = await getHealthEmbed(
      interaction({ userId: adminId, administrator: true }),
      { isReady: () => true } as Client,
    );

    assert.equal(statusEmbed.toJSON().title, "제출 상태: Operations Challenge");
    assert.equal(statusEmbed.toJSON().fields?.some((field) => field.name === "채점 결과" && field.value.includes("10 / 10")), true);
    assert.equal(inspectionEmbed.toJSON().title, "제출 상세: Operations Challenge");
    assert.equal(inspectionEmbed.toJSON().fields?.some((field) => field.name === "스냅샷 자료"), true);
    assert.equal(auditEmbed.toJSON().description?.includes("OPERATIONS_TEST"), true);
    assert.equal(healthEmbed.toJSON().title, "Study Bot 운영 상태");
    assert.equal(healthEmbed.toJSON().fields?.find((field) => field.name === "Database")?.value, "정상");
    await assert.rejects(
      () => getSubmissionQueryEmbed(interaction({ userId: randomUUID(), administrator: false }), submission.id, true),
      /You cannot inspect this submission/,
    );
    await assert.rejects(
      () => getAuditLogEmbed(interaction({ userId: studentId, administrator: false }), submission.id),
      /Only administrators can view audit logs/,
    );
  });
}
