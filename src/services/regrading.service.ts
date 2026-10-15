import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { queueSubmissionRegrading } from "../repositories/challenge.repository.js";

export async function regradeSubmissionFromInteraction(
  interaction: ChatInputCommandInteraction,
  submissionId: string,
) {
  if (!interaction.guild) throw new Error("Regrading must be requested in a guild");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasConfiguredRole = config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasConfiguredRole) throw new Error("Only administrators can regrade submissions");

  return queueSubmissionRegrading({ submissionId, actorId: interaction.user.id });
}
