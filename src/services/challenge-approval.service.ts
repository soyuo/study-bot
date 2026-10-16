import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  approveChallenge,
  findChallengeForApproval,
  findChallengesForPublicArchive,
  findPendingArchiveRecords,
  clearChallengePublicMessage,
  completeArchiveRecord,
  failArchiveRecord,
  rejectChallenge,
  setChallengePublicMessage,
} from "../repositories/challenge.repository.js";
import {
  buildChallengePublicComponents,
  buildChallengePublicEmbed,
  type ChallengeEmbedData,
} from "./challenge.service.js";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function toEmbedData(challenge: NonNullable<Awaited<ReturnType<typeof findChallengeForApproval>>>): ChallengeEmbedData {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    difficulty: challenge.difficulty,
    requirements: stringArray(challenge.requirements),
    optionalRequirements: stringArray(challenge.optionalRequirements),
    deliverables: stringArray(challenge.deliverables),
    allowedLanguages: stringArray(challenge.allowedLanguages),
    constraints: stringArray(challenge.constraints),
    deadline: challenge.deadline,
    maxScore: challenge.maxScore,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

async function archivePreviousPublicMessage(
  guild: Guild,
  challenge: Awaited<ReturnType<typeof findChallengesForPublicArchive>>[number],
  actorId: string,
): Promise<void> {
  const adminLogChannelId = challenge.guildConfig.adminLogChannelId ?? config.ADMIN_LOG_CHANNEL_ID;
  if (!adminLogChannelId || !challenge.publicChannelId || !challenge.publicMessageId) {
    logger.warn({ challengeId: challenge.id }, "Previous challenge public message cannot be archived without an admin log channel");
    return;
  }

  const attachmentInfo = challenge.sourceAttachments ? JSON.stringify(challenge.sourceAttachments) : "없음";
  try {
    const logChannel = await guild.channels.fetch(adminLogChannelId);
    if (!logChannel?.isTextBased() || !logChannel.isSendable()) {
      throw new Error(`Admin log channel is not sendable: ${adminLogChannelId}`);
    }
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Challenge 아카이브 로그")
          .setDescription("다음 과제 공개로 인해 보관된 과제의 원본 내용입니다.")
          .addFields(
            { name: "Challenge ID", value: challenge.id, inline: true },
            { name: "처리자", value: actorId, inline: true },
            { name: "제목", value: truncate(challenge.title, 1_024) },
            { name: "설명", value: truncate(challenge.description, 1_024) },
            { name: "원본 과제 내용", value: truncate(challenge.sourceContent ?? "없음", 1_024) },
            { name: "첨부 파일 정보", value: `\`\`\`json\n${truncate(attachmentInfo, 900)}\n\`\`\`` },
          )
          .setFooter({ text: `Challenge ID: ${challenge.id}` })
          .setTimestamp(),
      ],
    });

    const publicChannel = await guild.channels.fetch(challenge.publicChannelId);
    if (publicChannel?.isTextBased() && "messages" in publicChannel) {
      await publicChannel.messages.delete(challenge.publicMessageId);
    }
    await clearChallengePublicMessage({ challengeId: challenge.id, actorId });
  } catch (error) {
    logger.warn({ err: error, challengeId: challenge.id }, "Previous challenge public message archive failed");
  }
}

async function assertAdmin(
  interaction: ButtonInteraction,
  guildId: string,
  configuredAdminRoleId?: string | null,
): Promise<Guild> {
  const guild = await interaction.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasConfiguredRole = configuredAdminRoleId
    ? member.roles.cache.has(configuredAdminRoleId)
    : config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasConfiguredRole) throw new Error("Only administrators can approve challenges");
  return guild;
}

async function deleteSourceMessageIfPresent(
  guild: Guild,
  channelId: string,
  messageId: string | null | undefined,
  label: string,
): Promise<void> {
  if (!messageId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) {
      throw new Error(`Channel is not message-addressable: ${channelId}`);
    }
    await channel.messages.delete(messageId);
  } catch (error) {
    logger.warn({ err: error, channelId, messageId, label }, "Challenge source message cleanup failed");
  }
}

export async function approveChallengeFromInteraction(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge) throw new Error("Challenge not found");

  const guild = await assertAdmin(interaction, challenge.guildConfig.guildId, challenge.guildConfig.adminRoleId);
  if (!challenge.guildConfig.challengeChannelId) throw new Error("Challenge channel is not configured");

  const channel = await guild.channels.fetch(challenge.guildConfig.challengeChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("Challenge channel is not available");

  const activated = await approveChallenge({
    challengeId,
    approverId: interaction.user.id,
  });

  const previousPublicChallenges = await findChallengesForPublicArchive({
    guildConfigId: challenge.guildConfigId,
    excludeChallengeId: challengeId,
  });
  for (const previousChallenge of previousPublicChallenges) {
    await archivePreviousPublicMessage(guild, previousChallenge, interaction.user.id);
  }

  const pendingArchives = await findPendingArchiveRecords({
    guildConfigId: challenge.guildConfigId,
    excludeChallengeId: challengeId,
  });
  for (const archive of pendingArchives) {
    try {
      if (archive.submission?.channelId) {
        const submissionChannel = await guild.channels.fetch(archive.submission.channelId);
        if (!submissionChannel?.isTextBased() || !("permissionOverwrites" in submissionChannel)) {
          throw new Error("Submission channel is not available for archiving");
        }
        await submissionChannel.permissionOverwrites.edit(archive.submission.userId, {
          ViewChannel: false,
          SendMessages: false,
          AttachFiles: false,
          AddReactions: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        });

        const archiveCategoryId = challenge.guildConfig.archiveCategoryId;
        if (!archiveCategoryId) throw new Error("Archive category is not configured");
        const archiveCategory = await guild.channels.fetch(archiveCategoryId);
        if (!archiveCategory || archiveCategory.type !== ChannelType.GuildCategory) {
          throw new Error("Archive category is not available");
        }
        await submissionChannel.setParent(archiveCategory.id, {
          lockPermissions: true,
          reason: `Challenge ${archive.challengeId} archived`,
        });
      }
      await completeArchiveRecord(archive.id, challenge.guildConfig.archiveCategoryId!);
    } catch (error) {
      await failArchiveRecord(archive.id, error instanceof Error ? error.message : "Archive failed");
    }
  }
  const embedData = toEmbedData({ ...challenge, ...activated });
  const publicMessage = await channel.send({
    embeds: [buildChallengePublicEmbed(embedData)],
    components: buildChallengePublicComponents(embedData),
  });
  await setChallengePublicMessage({
    challengeId,
    publicChannelId: channel.id,
    publicMessageId: publicMessage.id,
  });

  await deleteSourceMessageIfPresent(guild, challenge.sourceChannelId, challenge.sourceMessageId, "source message");
  await deleteSourceMessageIfPresent(
    guild,
    challenge.sourceChannelId,
    challenge.processingStatusMessageId,
    "processing status message",
  );

  return publicMessage;
}

export async function rejectChallengeFromInteraction(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge) throw new Error("Challenge not found");
  await assertAdmin(interaction, challenge.guildConfig.guildId, challenge.guildConfig.adminRoleId);
  return rejectChallenge({ challengeId, rejecterId: interaction.user.id });
}
