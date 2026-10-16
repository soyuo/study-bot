import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Grading result publication integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const {
    approveChallenge,
    findGradeForResult,
    recordGradeResultPublished,
  } = await import("../repositories/challenge.repository.js");
  const { buildGradingResultEmbed } = await import("../services/grading-result.service.js");
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
      const grades = await prisma.grade.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { id: true },
      });
      const gradeIds = grades.map((grade) => grade.id);

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
      await prisma.gradeCriterionResult.deleteMany({ where: { gradeId: { in: gradeIds } } });
      await prisma.grade.deleteMany({ where: { id: { in: gradeIds } } });
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

  test("builds a grading embed and records its publication audit log", async () => {
    const draft = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Grading result publication challenge",
        sourceAttachments: [],
      },
      parser: new MockChallengeParser({
        title: "Publication Result Challenge",
        description: "A challenge used to verify grading result publication.",
        difficulty: "EASY",
        requirements: ["Publish the grade"],
        optionalRequirements: [],
        deliverables: ["Result embed"],
        allowedLanguages: ["TypeScript"],
        constraints: [],
        deadlinePolicy: { type: "NONE" },
        maxScore: 10,
        rubric: [
          {
            code: "result",
            name: "Result",
            description: "The grade result is presented clearly",
            maxPoints: 10,
            evaluationGuide: "Verify the score and evidence fields",
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
      data: { challengeId: draft.id, userId: studentId, channelId: "submission-channel", status: "GRADED" },
    });
    const grade = await prisma.grade.create({
      data: {
        submissionId: submission.id,
        rubricVersionId: rubric.id,
        attempt: 1,
        totalScore: 10,
        maxScore: 10,
        status: "PASSED",
        feedback: "Excellent implementation",
        modelName: "test-grader",
        results: {
          create: {
            criterionId: criterion.id,
            points: 10,
            feedback: "All requirements are met",
            evidence: "The implementation passes static review",
          },
        },
      },
    });

    const loaded = await findGradeForResult(grade.id);
    assert.ok(loaded);
    const embed = buildGradingResultEmbed(loaded);
    const embedData = embed.toJSON();
    const publicationLog = await recordGradeResultPublished({
      gradeId: grade.id,
      messageId: "grade-result-message",
      channelId: "submission-channel",
    });
    const storedLog = await prisma.auditLog.findUnique({ where: { id: publicationLog.id } });

    assert.equal(embedData.title, "채점 결과: Publication Result Challenge");
    assert.equal(embedData.description, `제출자: <@${studentId}>\n상태: **통과**`);
    assert.equal(embedData.color, 0x57f287);
    assert.equal(embedData.footer?.text, `Grade ID: ${grade.id} · Submission ID: ${grade.submissionId}`);
    assert.equal(embedData.fields?.some((field) => field.name === "총점" && field.value.includes("10 / 10")), true);
    assert.equal(embedData.fields?.some((field) => field.name.startsWith("Result · 10/10")), true);
    assert.equal(storedLog?.action, "GRADE_RESULT_PUBLISHED");
    assert.equal(storedLog?.entityId, grade.id);
    assert.deepEqual(storedLog?.metadata, {
      messageId: "grade-result-message",
      channelId: "submission-channel",
    });
  });
}
