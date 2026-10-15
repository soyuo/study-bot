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
    const draft = await tx.challenge.findUnique({
      where: { id: input.challengeId },
      select: { guildConfigId: true },
    });
    if (!draft) throw new Error("Challenge not found");

    const previousChallenges = await tx.challenge.findMany({
      where: {
        guildConfigId: draft.guildConfigId,
        status: "ACTIVE",
        id: { not: input.challengeId },
        deletedAt: null,
      },
      select: { id: true },
    });
    for (const previous of previousChallenges) {
      await tx.challenge.update({
        where: { id: previous.id },
        data: { status: "CLOSED", closedAt: activatedAt },
      });

      const submissions = await tx.submission.findMany({
        where: { challengeId: previous.id, deletedAt: null, channelId: { not: null } },
        select: { id: true, userId: true, channelId: true, status: true },
      });
      for (const submission of submissions) {
        if (submission.status === "OPEN") {
          await tx.submission.update({
            where: { id: submission.id },
            data: { status: "LOCKED", lockedAt: activatedAt },
          });
        }
        await tx.archiveRecord.create({
          data: {
            challengeId: previous.id,
            submissionId: submission.id,
            channelId: submission.channelId!,
            status: "PENDING",
            startedAt: activatedAt,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          guildConfigId: draft.guildConfigId,
          actorId: input.approverId,
          action: "CHALLENGE_CLOSED_FOR_NEW_CHALLENGE",
          entityType: "Challenge",
          entityId: previous.id,
          challengeId: previous.id,
          metadata: { replacementChallengeId: input.challengeId },
        },
      });
    }

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

export async function findPendingArchiveRecords(input: {
  guildConfigId: string;
  excludeChallengeId: string;
}) {
  return prisma.archiveRecord.findMany({
    where: {
      status: "PENDING",
      challenge: { guildConfigId: input.guildConfigId, id: { not: input.excludeChallengeId } },
    },
    include: { submission: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function setGuildArchiveCategory(input: { guildId: string; archiveCategoryId: string }) {
  return prisma.guildConfig.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, archiveCategoryId: input.archiveCategoryId },
    update: { archiveCategoryId: input.archiveCategoryId },
  });
}

export async function findGuildConfigByGuildId(guildId: string) {
  return prisma.guildConfig.findUnique({ where: { guildId } });
}

export async function updateGuildConfig(input: {
  guildId: string;
  challengeChannelId?: string;
  submissionCategoryId?: string;
  archiveCategoryId?: string;
  adminRoleId?: string;
}) {
  return prisma.guildConfig.upsert({
    where: { guildId: input.guildId },
    create: {
      guildId: input.guildId,
      challengeChannelId: input.challengeChannelId,
      submissionCategoryId: input.submissionCategoryId,
      archiveCategoryId: input.archiveCategoryId,
      adminRoleId: input.adminRoleId,
    },
    update: {
      ...(input.challengeChannelId ? { challengeChannelId: input.challengeChannelId } : {}),
      ...(input.submissionCategoryId ? { submissionCategoryId: input.submissionCategoryId } : {}),
      ...(input.archiveCategoryId ? { archiveCategoryId: input.archiveCategoryId } : {}),
      ...(input.adminRoleId ? { adminRoleId: input.adminRoleId } : {}),
    },
  });
}

export async function closeExpiredChallenges(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.challenge.findMany({
      where: { status: "ACTIVE", deadline: { not: null, lte: now }, deletedAt: null },
      include: { submissions: { where: { deletedAt: null, channelId: { not: null } } } },
    });
    const lockedChannels: Array<{ challengeId: string; submissionId: string; userId: string; channelId: string }> = [];

    for (const challenge of expired) {
      await tx.challenge.update({
        where: { id: challenge.id },
        data: { status: "CLOSED", closedAt: now },
      });
      for (const submission of challenge.submissions) {
        if (submission.status === "OPEN") {
          await tx.submission.update({
            where: { id: submission.id },
            data: { status: "LOCKED", lockedAt: now },
          });
        }
        lockedChannels.push({
          challengeId: challenge.id,
          submissionId: submission.id,
          userId: submission.userId,
          channelId: submission.channelId!,
        });
      }
      await tx.auditLog.create({
        data: {
          guildConfigId: challenge.guildConfigId,
          action: "CHALLENGE_CLOSED_DEADLINE",
          entityType: "Challenge",
          entityId: challenge.id,
          challengeId: challenge.id,
          metadata: { deadline: challenge.deadline?.toISOString(), closedAt: now.toISOString() },
        },
      });
    }
    return lockedChannels;
  });
}

export async function deleteChallengeWithSubmissions(input: { challengeId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.deletedAt) throw new Error("Challenge not found");

    const deletedAt = new Date();
    const submissions = await tx.submission.findMany({
      where: { challengeId: challenge.id, deletedAt: null },
      select: { id: true },
    });
    await tx.submission.updateMany({
      where: { challengeId: challenge.id, deletedAt: null },
      data: { status: "DELETED", deletedAt },
    });
    await tx.challenge.update({
      where: { id: challenge.id },
      data: { status: "DELETED", deletedAt },
    });
    await tx.auditLog.create({
      data: {
        guildConfigId: challenge.guildConfigId,
        actorId: input.actorId,
        action: "CHALLENGE_DELETED",
        entityType: "Challenge",
        entityId: challenge.id,
        challengeId: challenge.id,
        metadata: {
          deletedSubmissionCount: submissions.length,
          preservedArtifactsAndGrades: true,
        },
      },
    });
    return { ...challenge, status: "DELETED" as const, deletedAt, deletedSubmissionCount: submissions.length };
  });
}

export async function completeArchiveRecord(recordId: string, categoryId: string) {
  return prisma.archiveRecord.updateMany({
    where: { id: recordId, status: "PENDING" },
    data: { status: "COMPLETED", categoryId, completedAt: new Date() },
  });
}

export async function failArchiveRecord(recordId: string, errorMessage: string) {
  return prisma.archiveRecord.updateMany({
    where: { id: recordId, status: "PENDING" },
    data: { status: "FAILED", errorMessage: errorMessage.slice(0, 2_000) },
  });
}

export async function retryFailedArchiveRecords(input: { guildConfigId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const failed = await tx.archiveRecord.findMany({
      where: { status: "FAILED", challenge: { guildConfigId: input.guildConfigId } },
      select: { id: true, challengeId: true, submissionId: true },
    });
    if (failed.length === 0) return { count: 0, recordIds: [] as string[] };

    await tx.archiveRecord.updateMany({
      where: { id: { in: failed.map((record) => record.id) }, status: "FAILED" },
      data: { status: "PENDING", errorMessage: null, startedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        guildConfigId: input.guildConfigId,
        actorId: input.actorId,
        action: "ARCHIVE_RETRY_QUEUED",
        entityType: "ArchiveRecord",
        metadata: { count: failed.length, recordIds: failed.map((record) => record.id) },
      },
    });
    return { count: failed.length, recordIds: failed.map((record) => record.id) };
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

export async function findSubmissionForCompletion(submissionId: string) {
  return prisma.submission.findUnique({
    where: { id: submissionId },
    include: { challenge: true },
  });
}

export async function lockSubmission(submissionId: string, submittedAt = new Date()) {
  const result = await prisma.submission.updateMany({
    where: { id: submissionId, status: "OPEN", deletedAt: null },
    data: { status: "SUBMITTED", submittedAt, lockedAt: submittedAt },
  });

  if (result.count !== 1) throw new Error("Submission is already completed or unavailable");
  return prisma.submission.findUniqueOrThrow({ where: { id: submissionId } });
}

export async function createSubmissionSnapshot(input: {
  submissionId: string;
  capturedAt: Date;
  messageCount: number;
  metadata?: Prisma.InputJsonValue;
  artifacts: Array<{
    type: "TEXT" | "FILE" | "URL" | "GITHUB";
    source: string;
    content?: string;
    sourceMessageId?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
}) {
  return prisma.submissionSnapshot.create({
    data: {
      submissionId: input.submissionId,
      capturedAt: input.capturedAt,
      messageCount: input.messageCount,
      metadata: input.metadata,
      artifacts: {
        create: input.artifacts.map((artifact) => ({
          submissionId: input.submissionId,
          type: artifact.type,
          source: artifact.source,
          content: artifact.content,
          sourceMessageId: artifact.sourceMessageId,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        })),
      },
    },
    include: { artifacts: true },
  });
}

export async function queueSubmissionGrading(input: {
  submissionId: string;
  snapshotId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({
      where: { id: input.submissionId },
      include: { challenge: true },
    });
    if (!submission) throw new Error("Submission not found");

    const transitioned = await tx.submission.updateMany({
      where: { id: input.submissionId, status: "SUBMITTED", deletedAt: null },
      data: { status: "GRADING" },
    });
    if (transitioned.count !== 1) throw new Error("Submission is not ready for grading");

    const dedupeKey = `SUBMISSION_GRADING:${input.submissionId}:${input.snapshotId}`;
    const job = await tx.job.upsert({
      where: { dedupeKey },
      create: {
        guildConfigId: submission.challenge.guildConfigId,
        challengeId: submission.challengeId,
        submissionId: submission.id,
        type: "SUBMISSION_GRADING",
        status: "PENDING",
        dedupeKey,
        payload: { snapshotId: input.snapshotId },
      },
      update: {},
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: submission.challenge.guildConfigId,
        actorId: submission.userId,
        action: "SUBMISSION_GRADING_QUEUED",
        entityType: "Submission",
        entityId: submission.id,
        challengeId: submission.challengeId,
        submissionId: submission.id,
        metadata: { snapshotId: input.snapshotId, jobId: job.id, dedupeKey },
      },
    });

    return { submissionId: submission.id, jobId: job.id, snapshotId: input.snapshotId };
  });
}

export async function queueSubmissionRegrading(input: {
  submissionId: string;
  actorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({
      where: { id: input.submissionId },
      include: {
        challenge: true,
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
    });
    if (!submission || submission.deletedAt) throw new Error("Submission not found");
    if (!["GRADED", "GRADING_FAILED"].includes(submission.status)) {
      throw new Error("Only graded or failed submissions can be regraded");
    }
    const snapshot = submission.snapshots[0];
    if (!snapshot) throw new Error("Submission snapshot not found");

    const transitioned = await tx.submission.updateMany({
      where: {
        id: input.submissionId,
        status: { in: ["GRADED", "GRADING_FAILED"] },
        deletedAt: null,
      },
      data: { status: "GRADING" },
    });
    if (transitioned.count !== 1) throw new Error("Submission is already being regraded");

    const dedupeKey = `SUBMISSION_REGRADING:${submission.id}:${snapshot.id}:${Date.now()}`;
    const job = await tx.job.create({
      data: {
        guildConfigId: submission.challenge.guildConfigId,
        challengeId: submission.challengeId,
        submissionId: submission.id,
        type: "SUBMISSION_REGRADING",
        status: "PENDING",
        dedupeKey,
        payload: { snapshotId: snapshot.id, actorId: input.actorId },
      },
    });

    await tx.auditLog.create({
      data: {
        guildConfigId: submission.challenge.guildConfigId,
        actorId: input.actorId,
        action: "SUBMISSION_REGRADING_QUEUED",
        entityType: "Submission",
        entityId: submission.id,
        challengeId: submission.challengeId,
        submissionId: submission.id,
        metadata: { jobId: job.id, snapshotId: snapshot.id, dedupeKey },
      },
    });

    return { jobId: job.id, submissionId: submission.id, snapshotId: snapshot.id };
  });
}

export async function claimNextSubmissionGradingJob(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: {
        type: { in: ["SUBMISSION_GRADING", "SUBMISSION_REGRADING"] },
        status: "PENDING",
        availableAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;

    const claimed = await tx.job.updateMany({
      where: { id: candidate.id, status: "PENDING", availableAt: { lte: now } },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        startedAt: now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return null;

    return tx.job.findUnique({
      where: { id: candidate.id },
      include: {
        submission: {
          include: {
            challenge: { include: { rubrics: { include: { criteria: true } } } },
            grades: { orderBy: { attempt: "desc" }, take: 1 },
          },
        },
      },
    });
  });
}

export async function findSubmissionGradingSnapshot(input: {
  submissionId: string;
  snapshotId: string;
}) {
  return prisma.submissionSnapshot.findFirst({
    where: { id: input.snapshotId, submissionId: input.submissionId },
    include: { artifacts: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
  });
}

export async function completeSubmissionGrading(input: {
  jobId: string;
  submissionId: string;
  snapshotId: string;
  rubricVersionId: string;
  modelName: string;
  totalScore: number;
  maxScore: number;
  status: "PASSED" | "FAILED" | "REVIEW_REQUIRED";
  reviewRequired: boolean;
  feedback: string;
  results: Array<{ criterionId: string; points: number; feedback: string; evidence: string[] }>;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: input.jobId } });
    if (job.status !== "RUNNING") throw new Error("Grading job is not running");
    const submission = await tx.submission.findUniqueOrThrow({
      where: { id: input.submissionId },
      include: { grades: { orderBy: { attempt: "desc" }, take: 1 } },
    });

    const grade = await tx.grade.create({
      data: {
        submissionId: input.submissionId,
        rubricVersionId: input.rubricVersionId,
        snapshotId: input.snapshotId,
        attempt: (submission.grades[0]?.attempt ?? 0) + 1,
        totalScore: input.totalScore,
        maxScore: input.maxScore,
        status: input.status,
        feedback: input.feedback,
        reviewRequired: input.reviewRequired,
        modelName: input.modelName,
        results: {
          create: input.results.map((result) => ({
            criterionId: result.criterionId,
            points: result.points,
            feedback: result.feedback,
            evidence: result.evidence.join("\n"),
          })),
        },
      },
    });

    await tx.submission.updateMany({
      where: { id: input.submissionId, status: "GRADING", deletedAt: null },
      data: { status: "GRADED" },
    });
    await tx.job.update({
      where: { id: input.jobId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null },
    });
    await tx.auditLog.create({
      data: {
        guildConfigId: job.guildConfigId,
        action: "SUBMISSION_GRADED",
        entityType: "Grade",
        entityId: grade.id,
        challengeId: job.challengeId,
        submissionId: input.submissionId,
        metadata: { jobId: input.jobId, totalScore: input.totalScore, maxScore: input.maxScore },
      },
    });

    return grade;
  });
}

export async function failSubmissionGrading(input: {
  jobId: string;
  submissionId: string;
  errorMessage: string;
  retryDelayMs: number;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: input.jobId } });
    if (job.status !== "RUNNING") throw new Error("Grading job is not running");

    const exhausted = job.attempt >= job.maxAttempts;
    const status = exhausted ? "FAILED" : "PENDING";
    await tx.job.update({
      where: { id: input.jobId },
      data: {
        status,
        lastError: input.errorMessage.slice(0, 2_000),
        availableAt: exhausted ? job.availableAt : new Date(Date.now() + input.retryDelayMs),
        finishedAt: exhausted ? new Date() : null,
      },
    });

    if (exhausted) {
      await tx.submission.updateMany({
        where: { id: input.submissionId, status: "GRADING" },
        data: { status: "GRADING_FAILED" },
      });
    }

    await tx.auditLog.create({
      data: {
        guildConfigId: job.guildConfigId,
        action: exhausted ? "SUBMISSION_GRADING_FAILED" : "SUBMISSION_GRADING_RETRY_SCHEDULED",
        entityType: "Submission",
        entityId: input.submissionId,
        challengeId: job.challengeId,
        submissionId: input.submissionId,
        metadata: { jobId: input.jobId, attempt: job.attempt, error: input.errorMessage.slice(0, 2_000) },
      },
    });

    return { exhausted, attempt: job.attempt };
  });
}

export async function findGradeForResult(gradeId: string) {
  return prisma.grade.findUnique({
    where: { id: gradeId },
    include: {
      submission: { include: { challenge: true } },
      results: { include: { criterion: true }, orderBy: { criterion: { code: "asc" } } },
    },
  });
}

export async function recordGradeResultPublished(input: {
  gradeId: string;
  messageId: string;
  channelId: string;
}) {
  const grade = await prisma.grade.findUniqueOrThrow({
    where: { id: input.gradeId },
    include: { submission: { include: { challenge: true } } },
  });

  return prisma.auditLog.create({
    data: {
      guildConfigId: grade.submission.challenge.guildConfigId,
      action: "GRADE_RESULT_PUBLISHED",
      entityType: "Grade",
      entityId: grade.id,
      submissionId: grade.submissionId,
      metadata: { messageId: input.messageId, channelId: input.channelId },
    },
  });
}

export async function findSubmissionInspection(submissionId: string) {
  return prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      challenge: { include: { guildConfig: true } },
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        include: { artifacts: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      },
      grades: {
        where: { deletedAt: null },
        orderBy: { attempt: "desc" },
        take: 1,
        include: { results: { include: { criterion: true }, orderBy: { criterion: { code: "asc" } } } },
      },
    },
  });
}

export async function findAuditLogs(input: { guildConfigId: string; entityId: string; limit?: number }) {
  return prisma.auditLog.findMany({
    where: {
      guildConfigId: input.guildConfigId,
      OR: [
        { entityId: input.entityId },
        { challengeId: input.entityId },
        { submissionId: input.entityId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 20,
  });
}

export async function setSubmissionControlMessage(input: { submissionId: string; controlMessageId: string }) {
  return prisma.submission.update({
    where: { id: input.submissionId, status: "OPEN" },
    data: { controlMessageId: input.controlMessageId },
  });
}
