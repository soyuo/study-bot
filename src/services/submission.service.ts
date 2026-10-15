import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
} from "discord.js";
import { config } from "../config.js";
import {
  findChallengeForSubmission,
  clearSubmissionChannel,
  reserveSubmission,
  setSubmissionChannel,
  setSubmissionControlMessage,
} from "../repositories/challenge.repository.js";
import { customIds } from "../commands/ids.js";
import { isDeadlinePassed } from "../utils/deadline.js";

const creationLocks = new Map<string, Promise<void>>();

async function withCreationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = creationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  creationLocks.set(key, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (creationLocks.get(key) === current) creationLocks.delete(key);
  }
}

export async function createSubmissionChannel(
  interaction: ButtonInteraction,
  challengeId: string,
): Promise<void> {
  if (!interaction.guild) throw new Error("Submission must be created inside a guild");
  if (!config.SUBMISSION_CATEGORY_ID) throw new Error("SUBMISSION_CATEGORY_ID is not configured");

  const challenge = await findChallengeForSubmission(challengeId);
  if (!challenge || challenge.status !== "ACTIVE" || challenge.deletedAt) {
    throw new Error("Challenge is not active");
  }
  if (isDeadlinePassed(challenge.deadline)) throw new Error("Challenge deadline has passed");

  const lockKey = `${challengeId}:${interaction.user.id}`;
  await withCreationLock(lockKey, async () => {
    const submission = await reserveSubmission({
      challengeId,
      userId: interaction.user.id,
    });

    if (submission.channelId) {
      await interaction.editReply(`이미 제출 채널이 존재합니다: <#${submission.channelId}>`);
      return;
    }

    const guild = interaction.guild!;
    const channel = await guild.channels.create({
      name: `submit-${challengeId.slice(0, 8)}-${interaction.user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: config.SUBMISSION_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...(config.ADMIN_ROLE_ID
          ? [{
              id: config.ADMIN_ROLE_ID,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            }]
          : []),
      ],
    });

    try {
      await setSubmissionChannel({ submissionId: submission.id, channelId: channel.id });
      const controlMessage = await channel.send({
        content: [
          `**${challenge.title}** 제출 공간입니다.`,
          "결과물, 설명, README, GitHub 링크 또는 파일을 이 채널에 제출해주세요.",
          "제출이 끝나면 아래 버튼을 눌러주세요. 제출 후에는 수정할 수 없습니다.",
        ].join("\n"),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(customIds.complete(submission.id))
              .setLabel("제출 완료")
              .setStyle(ButtonStyle.Success),
          ),
        ],
      });
      await setSubmissionControlMessage({
        submissionId: submission.id,
        controlMessageId: controlMessage.id,
      });
    } catch (error) {
      await channel.delete("Submission setup failed").catch(() => undefined);
      await clearSubmissionChannel(submission.id).catch(() => undefined);
      throw error;
    }

    await interaction.editReply(`제출 채널이 생성되었습니다: ${channel}`);
  });
}
