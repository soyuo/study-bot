import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { findGradesForGuildUser, findGuildConfigByGuildId } from "../repositories/challenge.repository.js";

export async function getTotalScoreEmbed(
  interaction: ChatInputCommandInteraction,
  userId: string,
) {
  if (!interaction.guild) throw new Error("Score lookup must be requested in a guild");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  const roleId = guildConfig?.adminRoleId ?? config.ADMIN_ROLE_ID;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = Boolean(roleId && member.roles.cache.has(roleId));
  if (!isAdmin && !hasRole) throw new Error("Only administrators can inspect total scores");

  const grades = await findGradesForGuildUser({
    guildConfigId: guildConfig?.id ?? "",
    userId,
  });
  const latestBySubmission = new Map<string, (typeof grades)[number]>();
  for (const grade of grades) {
    if (!latestBySubmission.has(grade.submissionId)) latestBySubmission.set(grade.submissionId, grade);
  }
  const latestGrades = [...latestBySubmission.values()];
  const totalScore = latestGrades.reduce((sum, grade) => sum + grade.totalScore, 0);
  const maxScore = latestGrades.reduce((sum, grade) => sum + grade.maxScore, 0);
  const details = latestGrades.slice(0, 20).map((grade) =>
    `• ${grade.submission.challenge.title}: ${grade.totalScore}/${grade.maxScore}점`,
  );

  return new EmbedBuilder()
    .setTitle(`총점: ${interaction.guild.members.cache.get(userId)?.displayName ?? userId}`)
    .setDescription(`<@${userId}>님의 확정 채점 결과입니다.`)
    .addFields(
      { name: "총점", value: `**${totalScore} / ${maxScore}점**`, inline: true },
      { name: "채점 과제 수", value: `${latestGrades.length}개`, inline: true },
      { name: "과제별 점수", value: details.join("\n").slice(0, 1_024) || "확정된 점수가 없습니다." },
    )
    .setColor(0x5865f2);
}
