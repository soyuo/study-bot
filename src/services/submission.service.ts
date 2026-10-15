import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import { customIds } from "../commands/ids.js";

export async function createSubmissionChannel(
  interaction: ButtonInteraction,
  challengeId: string,
): Promise<void> {
  const guild: Guild = interaction.guild!;
  if (!config.SUBMISSION_CATEGORY_ID) throw new Error("SUBMISSION_CATEGORY_ID is not configured");

  const channel = await guild.channels.create({
    name: `submit-${challengeId.slice(0, 8)}-${interaction.user.username}`.toLowerCase(),
    type: ChannelType.GuildText,
    parent: config.SUBMISSION_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
      },
      ...(config.ADMIN_ROLE_ID ? [{ id: config.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
    ],
  });

  const completeButton = new ButtonBuilder()
    .setCustomId(customIds.complete(`pending-${challengeId}-${interaction.user.id}`))
    .setLabel("제출 완료")
    .setStyle(ButtonStyle.Success);

  await channel.send({
    content: "이 채널에 결과물을 제출한 뒤 **제출 완료** 버튼을 눌러주세요.",
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(completeButton)],
  });

  await interaction.editReply(`제출 채널이 생성되었습니다: ${channel}`);
}
