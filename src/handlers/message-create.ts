import { Events, type Client, type Message } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export function registerMessageHandler(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;
    if (config.CHALLENGE_CHANNEL_ID && message.channelId !== config.CHALLENGE_CHANNEL_ID) return;
    if (!message.content.trim() && message.attachments.size === 0) return;

    // TODO: 관리자/지정 역할 검증 → 원문 백업 → Gemini Parser → Zod 검증 → DB 저장.
    logger.info({ messageId: message.id, guildId: message.guild.id }, "Challenge registration received");
  });
}
