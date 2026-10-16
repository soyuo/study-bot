import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction, type Guild } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  completeArchiveRecord,
  failArchiveRecord,
  findArchiveRecordsForChallenge,
  findChallengeForApproval,
} from "../repositories/challenge.repository.js";
import { archivePreviousPublicMessage } from "./challenge-approval.service.js";

async function assertAdmin(interaction: ChatInputCommandInteraction, guild: Guild, roleId?: string | null) {
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can archive challenges");
}

export async function archiveChallengeFromInteraction(interaction: ChatInputCommandInteraction, challengeId: string) {
  if (!interaction.guild) throw new Error("This command must be used in a guild");
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge || challenge.guildConfig.guildId !== interaction.guild.id) throw new Error("Challenge not found");
  await assertAdmin(interaction, interaction.guild, challenge.guildConfig.adminRoleId);
  if (challenge.status !== "CLOSED") throw new Error("Only a closed Challenge can be archived");

  const categoryId = challenge.guildConfig.archiveCategoryId;
  if (!categoryId) throw new Error("Archive category is not configured");
  const category = await interaction.guild.channels.fetch(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Archive category is not available");

  const records = await findArchiveRecordsForChallenge(challenge.id);
  let completed = 0;
  let failed = 0;
  for (const record of records) {
    try {
      const channelId = record.submission?.channelId ?? record.channelId;
      const channel = await interaction.guild.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Submission channel is not available");
      if (record.submission?.userId) {
        await channel.permissionOverwrites.edit(record.submission.userId, {
          ViewChannel: false,
          SendMessages: false,
          AttachFiles: false,
          AddReactions: false,
        });
      }
      await channel.setParent(category.id, { lockPermissions: true, reason: `Challenge ${challenge.id} manually archived` });
      await completeArchiveRecord(record.id, category.id);
      completed += 1;
    } catch (error) {
      failed += 1;
      await failArchiveRecord(record.id, error instanceof Error ? error.message : "Manual archive failed");
      logger.warn({ err: error, challengeId: challenge.id, archiveRecordId: record.id }, "Manual challenge archive failed");
    }
  }

  if (challenge.publicChannelId && challenge.publicMessageId && failed === 0) {
    await archivePreviousPublicMessage(interaction.guild, challenge, interaction.user.id);
  }
  return { completed, failed, total: records.length };
}
