import {
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";
import {
  findGuildConfigByGuildId,
  findSubmissionInspection,
} from "../repositories/challenge.repository.js";

type SubmissionDetails = NonNullable<Awaited<ReturnType<typeof findSubmissionInspection>>>;

function isAdmin(interaction: ChatInputCommandInteraction, adminRoleId?: string | null) {
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = adminRoleId ?? config.ADMIN_ROLE_ID;
  return Boolean(
    roleId &&
      "roles" in member &&
      typeof member.roles !== "string" &&
      "cache" in member.roles &&
      member.roles.cache.has(roleId),
  );
}

function statusLabel(status: string) {
  return status === "GRADED" ? "채점 완료" : status === "GRADING" ? "채점 중" : status === "GRADING_FAILED" ? "채점 실패" : status;
}

export async function getSubmissionQueryEmbed(
  interaction: ChatInputCommandInteraction,
  submissionId: string,
  inspect: boolean,
) {
  if (!interaction.guild) throw new Error("Submission lookup must be requested in a guild");
  const submission = await findSubmissionInspection(submissionId);
  if (!submission || submission.challenge.guildConfig.guildId !== interaction.guild.id) {
    throw new Error("Submission not found");
  }
  const admin = isAdmin(interaction, submission.challenge.guildConfig.adminRoleId);
  if (!admin && submission.userId !== interaction.user.id) {
    throw new Error("You cannot inspect this submission");
  }
  if (inspect && !admin) throw new Error("Only administrators can inspect submission details");

  return inspect ? buildInspectionEmbed(submission) : buildStatusEmbed(submission);
}

function buildStatusEmbed(submission: SubmissionDetails) {
  const grade = submission.grades[0];
  return new EmbedBuilder()
    .setTitle(`제출 상태: ${submission.challenge.title}`)
    .addFields(
      { name: "상태", value: statusLabel(submission.status), inline: true },
      { name: "제출자", value: `<@${submission.userId}>`, inline: true },
      { name: "제출 시각", value: submission.submittedAt ? `<t:${Math.floor(submission.submittedAt.getTime() / 1000)}:F>` : "미제출" },
      { name: "채점 결과", value: grade ? `${grade.totalScore} / ${grade.maxScore}점 (${grade.status})` : "아직 없음" },
    )
    .setColor(0x5865f2)
    .setFooter({ text: `Submission ID: ${submission.id}` });
}

function buildInspectionEmbed(submission: SubmissionDetails) {
  const grade = submission.grades[0];
  const snapshot = submission.snapshots[0];
  const artifactSummary = snapshot?.artifacts.length
    ? snapshot.artifacts.slice(0, 10).map((artifact) => `${artifact.type}: ${artifact.filename ?? artifact.source}`).join("\n")
    : "없음";
  const embed = buildStatusEmbed(submission).setTitle(`제출 상세: ${submission.challenge.title}`).addFields({
    name: "스냅샷 자료",
    value: artifactSummary.slice(0, 1_024),
  });
  if (grade) {
    embed.addFields(
      ...grade.results.slice(0, 20).map((result) => ({
        name: `${result.criterion.name} · ${result.points}/${result.criterion.maxPoints}`,
        value: result.feedback.slice(0, 1_024),
      })),
    );
  }
  return embed;
}
