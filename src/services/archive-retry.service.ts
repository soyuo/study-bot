import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import {
  completeArchiveRecord,
  failArchiveRecord,
  findChallengeForApproval,
  findGuildConfigByGuildId,
  findPendingArchiveRecords,
  retryFailedArchiveRecords,
} from "../repositories/challenge.repository.js";

async function assertArchiveAdmin(interaction: ChatInputCommandInteraction, guild: Guild) {
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasConfiguredRole = config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasConfiguredRole) throw new Error("Only administrators can retry archives");
}

export async function retryArchivesFromInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) throw new Error("Archive retry must be requested in a guild");
  await assertArchiveAdmin(interaction, interaction.guild);
  const storedGuildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  if (!storedGuildConfig) throw new Error("Guild configuration is not initialized");
  const guildConfig = await retryFailedArchiveRecords({
    guildConfigId: storedGuildConfig.id,
    actorId: interaction.user.id,
  });

  const pending = await findPendingArchiveRecords({
    guildConfigId: storedGuildConfig.id,
    excludeChallengeId: "",
  });
  let completed = 0;
  for (const archive of pending) {
    if (!guildConfig.recordIds.includes(archive.id)) continue;
    try {
      const channel = archive.submission?.channelId
        ? await interaction.guild.channels.fetch(archive.submission.channelId)
        : null;
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("Submission channel is not available for archiving");
      }
      await channel.permissionOverwrites.edit(archive.submission!.userId, {
        ViewChannel: false,
        SendMessages: false,
        AttachFiles: false,
        AddReactions: false,
      });
      const categoryId = await resolveArchiveCategoryId(interaction.guild, archive.challengeId);
      await channel.setParent(categoryId, { lockPermissions: true, reason: "Retry archived submission" });
      await completeArchiveRecord(archive.id, categoryId);
      completed += 1;
    } catch (error) {
      await failArchiveRecord(archive.id, error instanceof Error ? error.message : "Archive retry failed");
    }
  }
  return { queued: guildConfig.count, completed };
}

async function resolveArchiveCategoryId(guild: Guild, challengeId: string) {
  const challenge = await findChallengeForApproval(challengeId);
  const categoryId = challenge?.guildConfig.archiveCategoryId;
  if (!categoryId) throw new Error("Archive category is not configured");
  const category = await guild.channels.fetch(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Archive category is not available");
  return category.id;
}
