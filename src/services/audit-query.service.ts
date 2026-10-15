import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { findAuditLogs, findGuildConfigByGuildId } from "../repositories/challenge.repository.js";

function isAdmin(interaction: ChatInputCommandInteraction, roleId?: string | null) {
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const configuredRole = roleId ?? config.ADMIN_ROLE_ID;
  return Boolean(
    configuredRole &&
      "roles" in member &&
      typeof member.roles !== "string" &&
      "cache" in member.roles &&
      member.roles.cache.has(configuredRole),
  );
}

export async function getAuditLogEmbed(
  interaction: ChatInputCommandInteraction,
  entityId: string,
) {
  if (!interaction.guild) throw new Error("Audit lookup must be requested in a guild");
  const guildConfig = await findGuildConfigByGuildId(interaction.guild.id);
  if (!guildConfig) throw new Error("Guild configuration is not initialized");
  if (!isAdmin(interaction, guildConfig.adminRoleId)) throw new Error("Only administrators can view audit logs");

  const logs = await findAuditLogs({ guildConfigId: guildConfig.id, entityId });
  const embed = new EmbedBuilder()
    .setTitle(`감사 로그: ${entityId}`)
    .setColor(0x5865f2)
    .setFooter({ text: `${logs.length}개 로그 표시` });

  if (logs.length === 0) {
    embed.setDescription("조회된 감사 로그가 없습니다.");
    return embed;
  }
  embed.setDescription(
    logs
      .map((log) => {
        const timestamp = `<t:${Math.floor(log.createdAt.getTime() / 1_000)}:f>`;
        const metadata = log.metadata ? `\n\`${JSON.stringify(log.metadata).slice(0, 600)}\`` : "";
        return `${timestamp} **${log.action}** · ${log.entityType}${metadata}`;
      })
      .join("\n\n")
      .slice(0, 4_096),
  );
  return embed;
}
