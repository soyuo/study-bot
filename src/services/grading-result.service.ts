import { EmbedBuilder, type Client } from "discord.js";
import {
  findGradeForResult,
  recordGradeResultPublished,
} from "../repositories/challenge.repository.js";

const MAX_FIELD_VALUE = 1_024;

function truncate(value: string, max = MAX_FIELD_VALUE): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function statusLabel(status: string): string {
  if (status === "PASSED") return "통과";
  if (status === "FAILED") return "낙제";
  return "관리자 검토 필요";
}

type GradeForResult = NonNullable<Awaited<ReturnType<typeof findGradeForResult>>>;

export function buildGradingResultEmbed(grade: GradeForResult): EmbedBuilder {
  const color = grade.status === "PASSED" ? 0x57f287 : grade.status === "FAILED" ? 0xed4245 : 0xfee75c;
  const embed = new EmbedBuilder()
    .setTitle(`채점 결과: ${grade.submission.challenge.title}`)
    .setDescription(`제출자: <@${grade.submission.userId}>\n상태: **${statusLabel(grade.status)}**`)
    .addFields(
      {
        name: "총점",
        value: `**${grade.totalScore} / ${grade.maxScore}점**`,
        inline: true,
      },
      { name: "채점 시도", value: `${grade.attempt}회`, inline: true },
      ...grade.results.slice(0, 20).map((result) => ({
        name: `${result.criterion.name} · ${result.points}/${result.criterion.maxPoints}`,
        value: truncate(
          `${result.feedback}\n${result.evidence ? `근거: ${result.evidence}` : "근거 없음"}`,
        ),
      })),
      { name: "종합 평가", value: truncate(grade.feedback) },
    )
    .setColor(color)
    .setTimestamp(grade.createdAt)
    .setFooter({ text: `Grade ID: ${grade.id} · Submission ID: ${grade.submissionId}` });

  if (grade.reviewRequired) {
    embed.addFields({ name: "안내", value: "일부 항목은 관리자 확인이 필요합니다." });
  }
  return embed;
}

export async function publishGradingResult(client: Client, gradeId: string) {
  const grade = await findGradeForResult(gradeId);
  if (!grade) throw new Error("Grade not found");
  const channelId = grade.submission.channelId;
  if (!channelId) throw new Error("Submission channel is missing");

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("Submission channel is not available for result publishing");
  }

  const message = await channel.send({
    content: `<@${grade.submission.userId}> 채점이 완료되었습니다.`,
    embeds: [buildGradingResultEmbed(grade)],
    allowedMentions: { users: [grade.submission.userId] },
  });
  await recordGradeResultPublished({
    gradeId,
    messageId: message.id,
    channelId: channel.id,
  });
  return message;
}
