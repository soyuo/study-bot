import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import {
  finalizeSubmissionByGradeId,
  findGradeForResult,
  findGradeResultPublication,
  findGuildConfigByGuildId,
} from "../repositories/challenge.repository.js";
import { publishGradingResult } from "./grading-result.service.js";
import { updateSubmissionControlStatus } from "./challenge-hint.service.js";

export async function finalizeGradeFromInteraction(
  interaction: ChatInputCommandInteraction,
  gradeId: string,
) {
  if (!interaction.guild) throw new Error("Grade finalization must be requested in a guild");
  const grade = await findGradeForResult(gradeId);
  if (!grade || grade.submission.challenge.guildConfig.guildId !== interaction.guild.id) {
    throw new Error("Grade not found");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  const roleId = guildConfig?.adminRoleId ?? config.ADMIN_ROLE_ID;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = Boolean(roleId && member.roles.cache.has(roleId));
  if (!isAdmin && !hasRole) throw new Error("Only administrators can finalize grades");

  const finalized = await finalizeSubmissionByGradeId(gradeId);
  if (!await findGradeResultPublication(gradeId)) {
    await publishGradingResult(interaction.client, gradeId);
  }

  const submission = finalized.grade.submission;
  await updateSubmissionControlStatus({
    client: interaction.client,
    submissionId: submission.id,
    challengeId: submission.challengeId,
    userId: submission.userId,
    channelId: submission.channelId,
    controlMessageId: submission.controlMessageId,
    status: "GRADED",
  });

  if (submission.channelId) {
    const channel = await interaction.guild.channels.fetch(submission.channelId);
    if (channel?.isTextBased() && "permissionOverwrites" in channel) {
      await channel.permissionOverwrites.edit(submission.userId, {
        SendMessages: false,
        AttachFiles: false,
        AddReactions: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      });
    }
  }

  return {
    gradeId,
    submissionId: submission.id,
    totalScore: finalized.grade.totalScore,
    maxScore: finalized.grade.maxScore,
    discardedJobCount: finalized.discardedJobCount,
  };
}
