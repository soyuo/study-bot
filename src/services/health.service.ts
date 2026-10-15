import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from "discord.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

export async function getHealthEmbed(
  interaction: ChatInputCommandInteraction,
  client: Client,
) {
  if (!interaction.guild) throw new Error("Health check must be requested in a guild");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new Error("Only administrators can view health status");
  }

  let database = "정상";
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
  } catch {
    database = "오류";
  }

  const healthy = database === "정상" && client.isReady();
  return new EmbedBuilder()
    .setTitle("Study Bot 운영 상태")
    .setColor(healthy ? 0x57f287 : 0xed4245)
    .addFields(
      { name: "Discord", value: client.isReady() ? "정상" : "연결 안 됨", inline: true },
      { name: "Database", value: database, inline: true },
      { name: "Process uptime", value: formatUptime(process.uptime()), inline: true },
    )
    .setTimestamp();
}
