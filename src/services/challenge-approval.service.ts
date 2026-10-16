import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  approveChallenge,
  findChallengeForApproval,
  findPendingArchiveRecords,
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
