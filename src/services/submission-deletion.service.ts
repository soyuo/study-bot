import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import {
  deleteSubmissionPreservingHistory,
  findGuildConfigByGuildId,
  findSubmissionInspection,
} from "../repositories/challenge.repository.js";

export async function deleteSubmissionFromInteraction(
  interaction: ChatInputCommandInteraction,
  submissionId: string,
) {
  if (!interaction.guild) throw new Error("Submission deletion must be requested in a guild");
  const submission = await findSubmissionInspection(submissionId);
  if (!submission || submission.challenge.guildConfig.guildId !== interaction.guild.id) {
    throw new Error("Submission not found");
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  const roleId = guildConfig?.adminRoleId ?? config.ADMIN_ROLE_ID;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can delete submissions");

  const deleted = await deleteSubmissionPreservingHistory({
    submissionId,
    actorId: interaction.user.id,
  });
  if (deleted.channelId) {
    const channel = await interaction.guild.channels.fetch(deleted.channelId);
    if (channel?.isTextBased() && "permissionOverwrites" in channel) {
      await channel.permissionOverwrites.edit(deleted.userId, {
        ViewChannel: false,
        SendMessages: false,
        AttachFiles: false,
        AddReactions: false,
      });
    }
  }
  return deleted;
}
