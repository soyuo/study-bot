import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test(
    "Challenge registration integration tests require TEST_DATABASE_URL",
    { skip: "TEST_DATABASE_URL is not configured" },
    () => {},
  );
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { createChallengeDraftFromParser } = await import("../services/challenge.service.js");
  const { MockChallengeParser } = await import("../services/challenge-parser.service.js");

  const guildId = randomUUID();
  const authorId = randomUUID();

  after(async () => {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    if (guildConfig) {
      const challenges = await prisma.challenge.findMany({
        where: { guildConfigId: guildConfig.id },
        select: { id: true },
      });

      await prisma.auditLog.deleteMany({ where: { guildConfigId: guildConfig.id } });
      for (const challenge of challenges) {
        const rubrics = await prisma.rubricVersion.findMany({
          where: { challengeId: challenge.id },
          select: { id: true },
        });
        for (const rubric of rubrics) {
          await prisma.gradingCriterion.deleteMany({ where: { rubricVersionId: rubric.id } });
        }
        await prisma.rubricVersion.deleteMany({ where: { challengeId: challenge.id } });
        await prisma.challenge.delete({ where: { id: challenge.id } });
      }
      await prisma.guildConfig.delete({ where: { id: guildConfig.id } });
    }
    await disconnectDatabase();
  });

  test("registers a challenge draft with rubric, source snapshot, and audit log", async () => {
    const sourceAttachments = [
      {
        url: "https://cdn.discordapp.com/attachments/test/brief.txt",
        filename: "brief.txt",
        contentType: "text/plain",
        sizeBytes: 42,
      },
    ];
    const parser = new MockChallengeParser({
      title: "Integration Challenge",
      description: "A challenge created by the integration test.",
      difficulty: "MEDIUM",
      requirements: ["Implement the feature"],
      optionalRequirements: [],
      deliverables: ["Source code"],
      allowedLanguages: ["TypeScript"],
      constraints: [],
      deadlinePolicy: { type: "RELATIVE", durationHours: 72 },
      maxScore: 10,
      rubric: [
        {
          code: "quality",
          name: "Quality",
          description: "Implementation quality",
          maxPoints: 10,
          evaluationGuide: "Review correctness and maintainability",
          verificationMethod: "DOCUMENT_REVIEW",
        },
      ],
    });

    const result = await createChallengeDraftFromParser({
      registration: {
        guildId,
        authorId,
        sourceChannelId: "challenge-channel",
        sourceMessageId: "source-message",
        sourceContent: "Original challenge message",
        sourceAttachments,
      },
      parser,
    });

    const stored = await prisma.challenge.findUnique({
      where: { id: result.id },
      include: {
        guildConfig: true,
        rubrics: { include: { criteria: true } },
        auditLogs: true,
      },
    });

    assert.ok(stored);
    assert.equal(stored.status, "DRAFT");
    assert.equal(stored.title, "Integration Challenge");
    assert.equal(stored.guildConfig.guildId, guildId);
    assert.equal(stored.sourceContent, "Original challenge message");
    assert.deepEqual(stored.sourceAttachments, sourceAttachments);
    assert.ok(stored.deadline);
    assert.equal(stored.deadline.getTime() - stored.createdAt.getTime(), 72 * 60 * 60 * 1000);
    assert.equal(stored.rubrics.length, 1);
    assert.equal(stored.rubrics[0]?.version, 1);
    assert.equal(stored.rubrics[0]?.criteria[0]?.code, "quality");
    assert.equal(stored.rubrics[0]?.criteria[0]?.maxPoints, 10);
    assert.equal(stored.auditLogs.length, 1);
    assert.equal(stored.auditLogs[0]?.action, "CHALLENGE_DRAFT_CREATED");
    assert.equal(stored.auditLogs[0]?.actorId, authorId);
  });
}
