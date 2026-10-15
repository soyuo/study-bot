import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import {
  approveChallenge,
  findChallengeForApproval,
  rejectChallenge,
  setChallengePublicMessage,
} from "../repositories/challenge.repository.js";
import {
  buildChallengePublicComponents,
  buildChallengePublicEmbed,
  type ChallengeEmbedData,
} from "./challenge.service.js";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function toEmbedData(challenge: NonNullable<Awaited<ReturnType<typeof findChallengeForApproval>>>): ChallengeEmbedData {
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
  };
}

async function assertAdmin(interaction: ButtonInteraction, guildId: string): Promise<Guild> {
  const guild = await interaction.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasConfiguredRole = config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasConfiguredRole) throw new Error("Only administrators can approve challenges");
  return guild;
}

export async function approveChallengeFromInteraction(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge) throw new Error("Challenge not found");

  const guild = await assertAdmin(interaction, challenge.guildConfig.guildId);
  if (!challenge.guildConfig.challengeChannelId) throw new Error("Challenge channel is not configured");

  const channel = await guild.channels.fetch(challenge.guildConfig.challengeChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("Challenge channel is not available");

  const activated = await approveChallenge({
    challengeId,
    approverId: interaction.user.id,
  });
  const embedData = toEmbedData({ ...challenge, ...activated });
  const publicMessage = await channel.send({
    embeds: [buildChallengePublicEmbed(embedData)],
    components: buildChallengePublicComponents(embedData),
  });
  await setChallengePublicMessage({
    challengeId,
    publicChannelId: channel.id,
    publicMessageId: publicMessage.id,
  });

  return publicMessage;
}

export async function rejectChallengeFromInteraction(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge) throw new Error("Challenge not found");
  await assertAdmin(interaction, challenge.guildConfig.guildId);
  return rejectChallenge({ challengeId, rejecterId: interaction.user.id });
}
