import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";
import { updateGuildConfig } from "../repositories/challenge.repository.js";

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
