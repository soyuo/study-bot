import { PermissionFlagsBits, type ChatInputCommandInteraction, type Guild } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { closeChallenge, findChallengeForApproval } from "../repositories/challenge.repository.js";
import { buildChallengePublicComponents, buildChallengePublicEmbed } from "./challenge.service.js";

async function assertAdmin(interaction: ChatInputCommandInteraction, guild: Guild, roleId?: string | null) {
  const member = await guild.members.fetch(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasRole = roleId ? member.roles.cache.has(roleId) : config.ADMIN_ROLE_ID ? member.roles.cache.has(config.ADMIN_ROLE_ID) : false;
  if (!isAdmin && !hasRole) throw new Error("Only administrators can close challenges");
}

export async function closeChallengeFromInteraction(interaction: ChatInputCommandInteraction, challengeId: string) {
  if (!interaction.guild) throw new Error("This command must be used in a guild");
  const challenge = await findChallengeForApproval(challengeId);
  if (!challenge || challenge.guildConfig.guildId !== interaction.guild.id) throw new Error("Challenge not found");
  await assertAdmin(interaction, interaction.guild, challenge.guildConfig.adminRoleId);

  const closed = await closeChallenge({ challengeId, actorId: interaction.user.id });
  let lockedChannels = 0;
  for (const submission of closed.lockedChannels) {
    try {
      const channel = await interaction.guild.channels.fetch(submission.channelId);
      if (!channel?.isTextBased() || !("permissionOverwrites" in channel)) throw new Error("Submission channel is unavailable");
      await channel.permissionOverwrites.edit(submission.userId, {
        ViewChannel: true,
        SendMessages: false,
        AttachFiles: false,
        AddReactions: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      });
      lockedChannels += 1;
    } catch (error) {
      logger.warn({ err: error, challengeId, submissionId: submission.submissionId }, "Manually closed submission channel could not be locked");
    }
  }

  if (challenge.publicChannelId && challenge.publicMessageId) {
    try {
      const channel = await interaction.guild.channels.fetch(challenge.publicChannelId);
      if (channel?.isTextBased() && "messages" in channel) {
        const message = await channel.messages.fetch(challenge.publicMessageId);
        await message.edit({
          embeds: [buildChallengePublicEmbed({
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            difficulty: challenge.difficulty,
            requirements: Array.isArray(challenge.requirements) ? challenge.requirements.filter((item): item is string => typeof item === "string") : [],
            optionalRequirements: Array.isArray(challenge.optionalRequirements) ? challenge.optionalRequirements.filter((item): item is string => typeof item === "string") : [],
            deliverables: Array.isArray(challenge.deliverables) ? challenge.deliverables.filter((item): item is string => typeof item === "string") : [],
            allowedLanguages: Array.isArray(challenge.allowedLanguages) ? challenge.allowedLanguages.filter((item): item is string => typeof item === "string") : [],
            constraints: Array.isArray(challenge.constraints) ? challenge.constraints.filter((item): item is string => typeof item === "string") : [],
            deadline: challenge.deadline,
            maxScore: challenge.maxScore,
            closed: true,
          })],
          components: buildChallengePublicComponents({
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            difficulty: challenge.difficulty,
            requirements: [],
            deliverables: [],
            deadline: challenge.deadline,
            maxScore: challenge.maxScore,
            closed: true,
          }),
        });
      }
    } catch (error) {
      logger.warn({ err: error, challengeId }, "Closed challenge public message could not be updated");
    }
  }
  return { ...closed, lockedChannelCount: lockedChannels };
}
