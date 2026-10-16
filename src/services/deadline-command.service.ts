import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type MessageEditOptions,
} from "discord.js";
import { config } from "../config.js";
import {
  findChallengeForApproval,
  updateChallengeDeadline,
} from "../repositories/challenge.repository.js";
import { buildChallengePreviewEmbed, buildChallengePublicComponents, buildChallengePublicEmbed } from "./challenge.service.js";
import { parseDeadlineDateInput } from "../utils/deadline.js";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

async function assertAdmin(interaction: ChatInputCommandInteraction, guild: Guild, roleId?: string | null) {
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can change challenge deadlines");
}

function embedData(challenge: NonNullable<Awaited<ReturnType<typeof findChallengeForApproval>>>) {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    difficulty: challenge.difficulty,
    requirements: stringArray(challenge.requirements),
    optionalRequirements: stringArray(challenge.optionalRequirements),
    deliverables: stringArray(challenge.deliverables),
    allowedLanguages: stringArray(challenge.allowedLanguages),
    constraints: stringArray(challenge.constraints),
    deadline: challenge.deadline,
    maxScore: challenge.maxScore,
  } as const;
}

async function editStoredMessage(
  client: Client,
  guildId: string,
  channelId: string,
  messageId: string,
  payload: MessageEditOptions,
) {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(messageId);
  await message.edit(payload);
}

export async function updateChallengeDeadlineFromInteraction(
  interaction: ChatInputCommandInteraction,
  challengeId: string,
) {
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge) throw new Error("Challenge not found");
  if (!interaction.guild) throw new Error("This command must be used in a guild");
  if (challenge.guildConfig.guildId !== interaction.guild.id) {
    throw new Error("이 서버에 속한 Challenge만 변경할 수 있습니다");
  }
  await assertAdmin(interaction, interaction.guild, challenge.guildConfig.adminRoleId);

  const hours = interaction.options.getInteger("hours");
  const dateInput = interaction.options.getString("date");
  if ((hours === null) === (dateInput === null)) {
    throw new Error("hours 또는 date 중 하나만 입력해야 합니다");
  }

  const deadline = hours !== null
    ? new Date(Date.now() + hours * 60 * 60 * 1_000)
    : parseDeadlineDateInput(dateInput!);
  if (deadline.getTime() <= Date.now()) throw new Error("마감일은 현재 시각보다 미래여야 합니다");

  await updateChallengeDeadline({ challengeId, actorId: interaction.user.id, deadline });
  const updated = await findChallengeForApproval(challengeId);
  if (!updated) throw new Error("Updated Challenge not found");
  const data = embedData(updated);

  if (updated.status === "DRAFT" && updated.previewUserId && updated.previewMessageId) {
    const user = await interaction.client.users.fetch(updated.previewUserId);
    const dm = await user.createDM();
    const previewMessage = await dm.messages.fetch(updated.previewMessageId);
    await previewMessage.edit({
      embeds: [buildChallengePreviewEmbed(data)],
    });
  }
  if (updated.status === "ACTIVE" && updated.publicChannelId && updated.publicMessageId) {
    await editStoredMessage(interaction.client, updated.guildConfig.guildId, updated.publicChannelId, updated.publicMessageId, {
      embeds: [buildChallengePublicEmbed(data)],
      components: buildChallengePublicComponents(data),
    });
  }

  return deadline;
}
