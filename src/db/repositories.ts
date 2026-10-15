import { Prisma, type ChallengeStatus, type JobType, type SubmissionStatus } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";

export async function getOrCreateGuildConfig(guildId: string) {
  return prisma.guildConfig.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}

export async function createSubmissionIfAbsent(input: {
  challengeId: string;
  userId: string;
  channelId: string;
}) {
  return prisma.submission.upsert({
    where: { challengeId_userId: { challengeId: input.challengeId, userId: input.userId } },
    create: input,
    update: {},
  });
}

export async function createJob(input: {
  guildConfigId: string;
  type: JobType;
  dedupeKey: string;
  challengeId?: string;
  submissionId?: string;
  payload?: Prisma.InputJsonValue;
}) {
  return prisma.job.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: input,
    update: {},
  });
}

export async function softDeleteChallenge(challengeId: string) {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.update({
      where: { id: challengeId },
      data: { status: "DELETED", deletedAt: new Date() },
    });

    await tx.submission.updateMany({
      where: { challengeId, deletedAt: null },
      data: { status: "DELETED", deletedAt: new Date() },
    });

    return challenge;
  });
}

export async function updateSubmissionStatus(
  submissionId: string,
  from: SubmissionStatus,
  to: SubmissionStatus,
) {
  const result = await prisma.submission.updateMany({
    where: { id: submissionId, status: from, deletedAt: null },
    data: { status: to },
  });

  if (result.count !== 1) throw new Error(`Invalid submission transition: ${from} -> ${to}`);
  return prisma.submission.findUniqueOrThrow({ where: { id: submissionId } });
}

export async function updateChallengeStatus(
  challengeId: string,
  from: ChallengeStatus,
  to: ChallengeStatus,
) {
  const result = await prisma.challenge.updateMany({
    where: { id: challengeId, status: from, deletedAt: null },
    data: { status: to },
  });

  if (result.count !== 1) throw new Error(`Invalid challenge transition: ${from} -> ${to}`);
  return prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
}
