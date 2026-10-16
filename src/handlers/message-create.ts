import { Events, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { GeminiChallengeParser } from "../services/challenge-parser.service.js";
import {
  buildChallengePreviewComponents,
  buildChallengePreviewEmbed,
  createChallengeDraftFromParser,
} from "../services/challenge.service.js";
import { readMessageTextAttachment } from "../services/challenge-attachment.service.js";
import { findGuildConfigByGuildId, setChallengePreviewMessage } from "../repositories/challenge.repository.js";

function isChallengeAdmin(message: Message, adminRoleId: string | null | undefined): boolean {
  if (!message.member) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return adminRoleId ? message.member.roles.cache.has(adminRoleId) : false;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

export function shouldProcessChallengeMessage(
  message: Message,
  guildConfig: { challengeChannelId: string | null; adminRoleId: string | null },
): boolean {
  if (message.author.bot || !message.guild) return false;
  if (!guildConfig.challengeChannelId || message.channelId !== guildConfig.challengeChannelId) return false;
  if (!message.content.trim() && message.attachments.size === 0) return false;
  return isChallengeAdmin(message, guildConfig.adminRoleId);
}

export function registerMessageHandler(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    let statusMessage: Message | undefined;
    try {
      if (message.author.bot || !message.guild) return;
      const guildConfig = await findGuildConfigByGuildId(message.guild.id);
      if (!guildConfig || !shouldProcessChallengeMessage(message, guildConfig)) return;
      if (!config.GEMINI_API_KEY) {
        logger.error({ guildId: message.guild.id }, "Cannot parse challenge: GEMINI_API_KEY is not configured");
        return;
      }

      try {
        statusMessage = await message.reply("과제 내용을 분석하고 있습니다. 완료되면 개인 DM으로 승인 요청을 보냅니다.");
      } catch (error) {
        logger.warn({ err: error, messageId: message.id }, "Could not post challenge processing status");
      }

      let previewMessage: Message;
      try {
        previewMessage = await message.author.send("과제 내용을 분석하고 있습니다...");
      } catch (error) {
        logger.error({ err: error, messageId: message.id, userId: message.author.id }, "Challenge preview DM failed");
        await statusMessage?.edit("개인 DM을 보낼 수 없습니다. Discord의 서버 멤버 DM 허용 여부를 확인해 주세요.");
        return;
      }
      logger.info({ messageId: message.id, guildId: message.guild.id }, "Challenge parsing started");

      const messageTextAttachment = message.attachments.find(
        (attachment) => attachment.name?.toLowerCase() === "message.txt",
      );
      const attachedChallengeContent = messageTextAttachment
        ? await readMessageTextAttachment(messageTextAttachment)
        : null;
      const sourceContent = [message.content.trim(), attachedChallengeContent?.trim()]
        .filter((content): content is string => Boolean(content))
        .join("\n\n");

      const registration = {
        guildId: message.guild.id,
        authorId: message.author.id,
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        sourceContent,
        sourceAttachments: message.attachments.map((attachment) => ({
          url: attachment.url,
          ...(attachment.name ? { filename: attachment.name } : {}),
          ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
          ...(attachment.size !== undefined ? { sizeBytes: attachment.size } : {}),
        })),
      };

      const parser = new GeminiChallengeParser({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
      });
      const challenge = await createChallengeDraftFromParser({ registration, parser });
      logger.info({ challengeId: challenge.id, messageId: message.id }, "Challenge draft created");
      const rubric = challenge.rubrics[0];

      await previewMessage.edit({
        embeds: [
          buildChallengePreviewEmbed({
            id: challenge.id,
            title: challenge.title,
            description: challenge.description,
            difficulty: challenge.difficulty,
            requirements: toStringArray(challenge.requirements),
            optionalRequirements: toStringArray(challenge.optionalRequirements),
            deliverables: toStringArray(challenge.deliverables),
            allowedLanguages: toStringArray(challenge.allowedLanguages),
            constraints: toStringArray(challenge.constraints),
            deadline: challenge.deadline,
            maxScore: challenge.maxScore,
          }),
        ],
        components: buildChallengePreviewComponents(challenge.id),
      });

      await setChallengePreviewMessage({
        challengeId: challenge.id,
        previewUserId: message.author.id,
        previewMessageId: previewMessage.id,
      });
      await statusMessage?.edit("분석이 완료되었습니다. 개인 DM의 승인/거절 버튼을 확인해 주세요.");

      logger.info(
        { challengeId: challenge.id, messageId: message.id, rubricId: rubric?.id, previewMessageId: previewMessage.id },
        "Challenge draft created and preview sent",
      );
    } catch (error) {
      logger.error({ err: error, messageId: message.id, guildId: message.guild?.id }, "Challenge registration failed");
      await statusMessage?.edit("과제 처리에 실패했습니다. 서버 로그에서 원인을 확인해 주세요.").catch(() => undefined);
    }
  });
}
