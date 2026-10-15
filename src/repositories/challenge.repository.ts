import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import type { ParsedChallenge } from "../validators/challenge.schema.js";

export interface CreateDraftChallengeInput {
  registration: {
    guildId: string;
    authorId: string;
    sourceChannelId: string;
    sourceMessageId: string;
    sourceContent: string;
    sourceAttachments: Array<{
      url: string;
      filename?: string;
      contentType?: string;
      sizeBytes?: number;
    }>;
  };
  parsed: ParsedChallenge;
  createdAt?: Date;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function resolveDeadline(policy: ParsedChallenge["deadlinePolicy"], baseTime: Date): Date | null {
  if (policy.type === "NONE") return null;
  if (policy.type === "RELATIVE") {
    return new Date(baseTime.getTime() + policy.durationHours * 60 * 60 * 1_000);
  }
  return new Date(policy.isoDateTime);
}

export async function createDraftChallenge(input: CreateDraftChallengeInput) {
  const createdAt = input.createdAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const guildConfig = await tx.guildConfig.upsert({
      where: { guildId: input.registration.guildId },
      create: { guildId: input.registration.guildId },
      update: {},
    });

    const challenge = await tx.challenge.create({
      data: {
        guildConfigId: guildConfig.id,
        authorId: input.registration.authorId,
        sourceChannelId: input.registration.sourceChannelId,
        sourceMessageId: input.registration.sourceMessageId,
        sourceContent: input.registration.sourceContent,
        sourceAttachments: toJson(input.registration.sourceAttachments),
        title: input.parsed.title,
        description: input.parsed.description,
        difficulty: input.parsed.difficulty,
        requirements: toJson(input.parsed.requirements),
        optionalRequirements: toJson(input.parsed.optionalRequirements),
        deliverables: toJson(input.parsed.deliverables),
        allowedLanguages: toJson(input.parsed.allowedLanguages),
        constraints: toJson(input.parsed.constraints),
        deadline: resolveDeadline(input.parsed.deadlinePolicy, createdAt),
        maxScore: input.parsed.maxScore,
        status: "DRAFT",
        createdAt,
        rubrics: {
          create: {
            version: 1,
            createdById: input.registration.authorId,
            criteria: {
              create: input.parsed.rubric.map((criterion) => ({
                code: criterion.code,
                name: criterion.name,
                description: criterion.description,
                maxPoints: criterion.maxPoints,
                evaluationGuide: criterion.evaluationGuide,
                verificationMethod: criterion.verificationMethod,
              })),
            },
          },
        },
      },
      include: {
        rubrics: { include: { criteria: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: guildConfig.id,
        actorId: input.registration.authorId,
        action: "CHALLENGE_DRAFT_CREATED",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: toJson({
          sourceMessageId: input.registration.sourceMessageId,
          rubricVersion: 1,
        }),
        createdAt,
      },
    });

    return challenge;
  });
}
