import {
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Client,
} from "discord.js";
import { config } from "../config.js";

export async function registerApplicationCommands(client: Client) {
  const command = new SlashCommandBuilder()
    .setName("regrade")
    .setDescription("제출물을 관리자 권한으로 다시 채점합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("submission_id")
        .setDescription("재채점할 Submission ID")
        .setRequired(true),
    );

  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);
  const archiveRetry = new SlashCommandBuilder()
    .setName("archive-retry")
    .setDescription("실패한 제출 채널 Archive를 다시 실행합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  await rest.put(route, { body: [command.toJSON(), archiveRetry.toJSON()] });
  return client.user?.id;
}
