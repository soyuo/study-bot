import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";
import { findGuildConfigByGuildId, updateGuildConfig } from "../repositories/challenge.repository.js";

export async function seedGuildConfigurationFromEnvironment() {
  if (!config.DISCORD_GUILD_ID) return null;

  const hasEnvironmentConfiguration = Boolean(
    config.CHALLENGE_CHANNEL_ID ||
      config.SUBMISSION_CATEGORY_ID ||
      config.ARCHIVE_CATEGORY_ID ||
      config.ADMIN_ROLE_ID ||
      config.ADMIN_LOG_CHANNEL_ID,
  );
  if (!hasEnvironmentConfiguration) return null;

  const existing = await findGuildConfigByGuildId(config.DISCORD_GUILD_ID);
  if (existing) return existing;

  return updateGuildConfig({
    guildId: config.DISCORD_GUILD_ID,
    ...(config.CHALLENGE_CHANNEL_ID ? { challengeChannelId: config.CHALLENGE_CHANNEL_ID } : {}),
    ...(config.SUBMISSION_CATEGORY_ID ? { submissionCategoryId: config.SUBMISSION_CATEGORY_ID } : {}),
    ...(config.ARCHIVE_CATEGORY_ID ? { archiveCategoryId: config.ARCHIVE_CATEGORY_ID } : {}),
    ...(config.ADMIN_ROLE_ID ? { adminRoleId: config.ADMIN_ROLE_ID } : {}),
    ...(config.ADMIN_LOG_CHANNEL_ID ? { adminLogChannelId: config.ADMIN_LOG_CHANNEL_ID } : {}),
  });
}

export async function updateGuildConfiguration(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) throw new Error("Configuration must be changed in a guild");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new Error("Only administrators can change guild configuration");
  }

  const challengeChannel = interaction.options.getChannel("challenge_channel");
  const submissionCategory = interaction.options.getChannel("submission_category");
  const archiveCategory = interaction.options.getChannel("archive_category");
  const adminRole = interaction.options.getRole("admin_role");

  if (!challengeChannel && !submissionCategory && !archiveCategory && !adminRole) {
    throw new Error("At least one configuration value is required");
  }
  if (challengeChannel && challengeChannel.type !== ChannelType.GuildText) {
    throw new Error("Challenge channel must be a text channel");
  }
  if (submissionCategory && submissionCategory.type !== ChannelType.GuildCategory) {
    throw new Error("Submission category must be a category");
  }
  if (archiveCategory && archiveCategory.type !== ChannelType.GuildCategory) {
    throw new Error("Archive category must be a category");
  }

  const stored = await updateGuildConfig({
    guildId: interaction.guild.id,
    ...(challengeChannel ? { challengeChannelId: challengeChannel.id } : {}),
    ...(submissionCategory ? { submissionCategoryId: submissionCategory.id } : {}),
    ...(archiveCategory ? { archiveCategoryId: archiveCategory.id } : {}),
    ...(adminRole ? { adminRoleId: adminRole.id } : {}),
  });
  return {
    challengeChannelId: stored.challengeChannelId ?? "미설정",
    submissionCategoryId: stored.submissionCategoryId ?? "미설정",
    archiveCategoryId: stored.archiveCategoryId ?? "미설정",
    adminRoleId: stored.adminRoleId ?? config.ADMIN_ROLE_ID ?? "미설정",
  };
}
