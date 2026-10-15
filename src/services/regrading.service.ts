import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { findGuildConfigByGuildId, queueSubmissionRegrading } from "../repositories/challenge.repository.js";

export async function regradeSubmissionFromInteraction(
  interaction: ChatInputCommandInteraction,
  submissionId: string,
) {
  if (!interaction.guild) throw new Error("Regrading must be requested in a guild");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  const configuredRoleId = guildConfig?.adminRoleId ?? config.ADMIN_ROLE_ID;
  const hasConfiguredRole = configuredRoleId ? member.roles.cache.has(configuredRoleId) : false;
  if (!isAdmin && !hasConfiguredRole) throw new Error("Only administrators can regrade submissions");

  return queueSubmissionRegrading({ submissionId, actorId: interaction.user.id });
}
