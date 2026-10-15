import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import {
  deleteChallengeWithSubmissions,
  findChallengeForApproval,
  findGuildConfigByGuildId,
} from "../repositories/challenge.repository.js";

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
    const publicChannel = await interaction.guild.channels.fetch(challenge.publicChannelId);
    if (publicChannel?.isTextBased() && publicChannel.isSendable()) {
      const message = await publicChannel.messages.fetch(challenge.publicMessageId).catch(() => null);
      await message?.edit({ content: "이 Challenge는 삭제되었습니다.", components: [] });
    }
  }
  return deleted;
}
