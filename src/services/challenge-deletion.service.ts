import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  deleteChallengeWithSubmissions,
  findChallengeForApproval,
  findGuildConfigByGuildId,
} from "../repositories/challenge.repository.js";

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function buildDeletedChallengeEmbed(challenge: NonNullable<Awaited<ReturnType<typeof findChallengeForApproval>>>, actorId: string) {
  const sourceAttachments = challenge.sourceAttachments ? JSON.stringify(challenge.sourceAttachments) : "없음";
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Challenge 삭제 로그")
    .setDescription("삭제된 과제의 원본 내용입니다.")
    .addFields(
      { name: "Challenge ID", value: challenge.id, inline: true },
      { name: "삭제자", value: actorId, inline: true },
      { name: "제목", value: truncate(challenge.title, 1_024) },
      { name: "설명", value: truncate(challenge.description, 1_024) },
      { name: "원본 과제 내용", value: truncate(challenge.sourceContent ?? "없음", 1_024) },
      { name: "첨부 파일 정보", value: `\`\`\`json\n${truncate(sourceAttachments, 900)}\n\`\`\`` },
    )
    .setFooter({ text: `Challenge ID: ${challenge.id}` })
    .setTimestamp(new Date());
}

async function writeChallengeDeletionLog(
  interaction: ChatInputCommandInteraction,
  challenge: NonNullable<Awaited<ReturnType<typeof findChallengeForApproval>>>,
): Promise<void> {
  const channelId = challenge.guildConfig.adminLogChannelId ?? config.ADMIN_LOG_CHANNEL_ID;
  if (!channelId) {
    logger.warn({ challengeId: challenge.id }, "Challenge deletion log channel is not configured");
    return;
  }

  try {
    const channel = await interaction.guild!.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(`Admin log channel is not sendable: ${channelId}`);
    }
    await channel.send({ embeds: [buildDeletedChallengeEmbed(challenge, interaction.user.id)] });
  } catch (error) {
    logger.warn({ err: error, challengeId: challenge.id, channelId }, "Challenge deletion log could not be written");
  }
}

export async function deleteChallengeFromInteraction(
  interaction: ChatInputCommandInteraction,
  challengeId: string,
) {
  if (!interaction.guild) throw new Error("Challenge deletion must be requested in a guild");
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge || challenge.guildConfig.guildId !== interaction.guild.id) throw new Error("Challenge not found");

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  const roleId = guildConfig?.adminRoleId ?? config.ADMIN_ROLE_ID;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can delete challenges");

  const deleted = await deleteChallengeWithSubmissions({ challengeId, actorId: interaction.user.id });
  if (challenge.publicChannelId && challenge.publicMessageId) {
    try {
      const publicChannel = await interaction.guild.channels.fetch(challenge.publicChannelId);
      if (publicChannel?.isTextBased() && publicChannel.isSendable()) {
        const message = await publicChannel.messages.fetch(challenge.publicMessageId).catch(() => null);
        await message?.edit({
          content: null,
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setDescription("해당 과제는 제거되었습니다.")
              .setFooter({ text: `Challenge ID: ${challenge.id}` }),
          ],
          components: [],
        });
      }
    } catch (error) {
      logger.warn({ err: error, challengeId: challenge.id }, "Deleted challenge public message could not be updated");
    }
  }
  await writeChallengeDeletionLog(interaction, challenge);
  return deleted;
}
