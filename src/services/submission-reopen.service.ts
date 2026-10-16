import { PermissionFlagsBits, type ChatInputCommandInteraction, type Guild } from "discord.js";
import { config } from "../config.js";
import {
  findSubmissionInspection,
  reopenSubmission,
} from "../repositories/challenge.repository.js";
import { buildSubmissionControlComponents, buildSubmissionControlContent } from "./challenge-hint.service.js";

async function assertAdmin(interaction: ChatInputCommandInteraction, guild: Guild, roleId?: string | null) {
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can reopen submissions");
}

export async function reopenSubmissionFromInteraction(interaction: ChatInputCommandInteraction, submissionId: string) {
  if (!interaction.guild) throw new Error("This command must be used in a guild");
  const submission = await findSubmissionInspection(submissionId);
  if (!submission || submission.challenge.guildConfig.guildId !== interaction.guild.id) throw new Error("Submission not found");
  await assertAdmin(interaction, interaction.guild, submission.challenge.guildConfig.adminRoleId);
  const reopened = await reopenSubmission({ submissionId, actorId: interaction.user.id });
  if (!reopened.channelId) throw new Error("Submission channel is not configured");

  const channel = await interaction.guild.channels.fetch(reopened.channelId);
  if (!channel?.isTextBased() || !("permissionOverwrites" in channel)) throw new Error("Submission channel is not available");
  await channel.permissionOverwrites.edit(reopened.userId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true,
    AddReactions: true,
    SendMessagesInThreads: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
  });

  if (reopened.controlMessageId && "messages" in channel) {
    const controlMessage = await channel.messages.fetch(reopened.controlMessageId).catch(() => null);
    if (controlMessage) {
      await controlMessage.edit({
        content: buildSubmissionControlContent(submission.challenge.title, reopened.id, true),
        components: buildSubmissionControlComponents(reopened.id, reopened.challengeId, true),
      });
    }
  }
  return reopened;
}
