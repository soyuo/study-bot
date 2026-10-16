import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
} from "discord.js";
import {
  findChallengeForSubmission,
  clearSubmissionChannel,
  hasChallengeHintView,
  reserveSubmission,
  setSubmissionChannel,
  setSubmissionControlMessage,
} from "../repositories/challenge.repository.js";
import { isDeadlinePassed } from "../utils/deadline.js";
import { buildSubmissionControlComponents, buildSubmissionControlContent } from "./challenge-hint.service.js";

const creationLocks = new Map<string, Promise<void>>();

async function withCreationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = creationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  creationLocks.set(key, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (creationLocks.get(key) === current) creationLocks.delete(key);
  }
}

export async function createSubmissionChannel(
  interaction: ButtonInteraction,
  challengeId: string,
): Promise<void> {
  if (!interaction.guild) throw new Error("Submission must be created inside a guild");
  const challenge = await findChallengeForSubmission(challengeId);
  if (!challenge || challenge.status !== "ACTIVE" || challenge.deletedAt) {
    throw new Error("Challenge is not active");
  }
  if (isDeadlinePassed(challenge.deadline)) throw new Error("Challenge deadline has passed");
  if (!challenge.guildConfig.submissionCategoryId) throw new Error("Submission category is not configured");

  const lockKey = `${challengeId}:${interaction.user.id}`;
  await withCreationLock(lockKey, async () => {
    const submission = await reserveSubmission({
      challengeId,
      userId: interaction.user.id,
    });

    if (submission.channelId) {
      await interaction.editReply(`이미 제출 채널이 존재합니다: <#${submission.channelId}>`);
      return;
    }

    const guild = interaction.guild!;
    const channel = await guild.channels.create({
      name: `submit-${challengeId.slice(0, 8)}-${interaction.user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: challenge.guildConfig.submissionCategoryId,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...(challenge.guildConfig.adminRoleId
          ? [{
              id: challenge.guildConfig.adminRoleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            }]
          : []),
      ],
    });

    try {
      await setSubmissionChannel({ submissionId: submission.id, channelId: channel.id });
      const hintViewed = await hasChallengeHintView({
        challengeId,
        userId: interaction.user.id,
      });
      const controlMessage = await channel.send({
        content: buildSubmissionControlContent(challenge.title, submission.id, hintViewed),
        components: buildSubmissionControlComponents(submission.id, challengeId, true),
      });
      await setSubmissionControlMessage({
        submissionId: submission.id,
        controlMessageId: controlMessage.id,
      });
    } catch (error) {
      await channel.delete("Submission setup failed").catch(() => undefined);
      await clearSubmissionChannel(submission.id).catch(() => undefined);
      throw error;
    }

    await interaction.editReply(`제출 채널이 생성되었습니다: ${channel}`);
  });
}
