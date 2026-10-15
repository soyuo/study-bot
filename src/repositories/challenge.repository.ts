import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import type { ParsedChallenge } from "../validators/challenge.schema.js";
import { resolveDeadline } from "../utils/deadline.js";

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

export async function setChallengePreviewMessage(input: {
  challengeId: string;
  previewUserId: string;
  previewMessageId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.update({
      where: { id: input.challengeId, status: "DRAFT" },
      data: {
        previewUserId: input.previewUserId,
        previewMessageId: input.previewMessageId,
      },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: challenge.guildConfigId,
        actorId: challenge.authorId,
        action: "CHALLENGE_PREVIEW_SENT",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: {
          previewUserId: input.previewUserId,
          previewMessageId: input.previewMessageId,
        },
      },
    });

    return challenge;
  });
}

export async function findChallengeForApproval(challengeId: string) {
  return prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      guildConfig: true,
      rubrics: { include: { criteria: true } },
    },
  });
}

export async function approveChallenge(input: {
  challengeId: string;
  approverId: string;
  activatedAt?: Date;
}) {
  const activatedAt = input.activatedAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const result = await tx.challenge.updateMany({
      where: { id: input.challengeId, status: "DRAFT", deletedAt: null },
      data: {
        status: "ACTIVE",
        approvedById: input.approverId,
        approvedAt: activatedAt,
        activatedAt,
      },
    });

    if (result.count !== 1) {
      throw new Error("Challenge is no longer awaiting approval");
    }

    await tx.rubricVersion.updateMany({
      where: { challengeId: input.challengeId },
      data: { isFrozen: true },
    });

    const challenge = await tx.challenge.findUniqueOrThrow({
      where: { id: input.challengeId },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: challenge.guildConfigId,
        actorId: input.approverId,
        action: "CHALLENGE_APPROVED",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: { activatedAt: activatedAt.toISOString() },
      },
    });

    return challenge;
  });
}

export async function rejectChallenge(input: {
  challengeId: string;
  rejecterId: string;
  reason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.challenge.updateMany({
      where: { id: input.challengeId, status: "DRAFT", deletedAt: null },
      data: {
        status: "REJECTED",
        rejectedById: input.rejecterId,
        rejectedAt: new Date(),
        rejectionReason: input.reason ?? null,
      },
    });

    if (result.count !== 1) {
      throw new Error("Challenge is no longer awaiting approval");
    }

    const challenge = await tx.challenge.findUniqueOrThrow({
      where: { id: input.challengeId },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: challenge.guildConfigId,
        actorId: input.rejecterId,
        action: "CHALLENGE_REJECTED",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: { reason: input.reason ?? null },
      },
    });

    return challenge;
  });
}

export async function setChallengePublicMessage(input: {
  challengeId: string;
  publicChannelId: string;
  publicMessageId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.update({
      where: { id: input.challengeId, status: "ACTIVE" },
      data: {
        publicChannelId: input.publicChannelId,
        publicMessageId: input.publicMessageId,
      },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: challenge.guildConfigId,
        actorId: challenge.approvedById,
        action: "CHALLENGE_PUBLISHED",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: {
          publicChannelId: input.publicChannelId,
          publicMessageId: input.publicMessageId,
        },
      },
    });

    return challenge;
  });
}

export async function findChallengeForSubmission(challengeId: string) {
  return prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { guildConfig: true },
  });
}

export async function reserveSubmission(input: { challengeId: string; userId: string }) {
  return prisma.submission.upsert({
    where: { challengeId_userId: input },
    create: { ...input, channelId: null, status: "OPEN" },
    update: {},
  });
}

export async function setSubmissionChannel(input: { submissionId: string; channelId: string }) {
  return prisma.submission.update({
    where: { id: input.submissionId, status: "OPEN" },
    data: { channelId: input.channelId },
  });
}

export async function clearSubmissionChannel(submissionId: string) {
  return prisma.submission.update({
    where: { id: submissionId, status: "OPEN" },
    data: { channelId: null, controlMessageId: null },
  });
}

export async function setSubmissionControlMessage(input: { submissionId: string; controlMessageId: string }) {
  return prisma.submission.update({
    where: { id: input.submissionId, status: "OPEN" },
    data: { controlMessageId: input.controlMessageId },
  });
}
