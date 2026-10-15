import { Events, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { GeminiChallengeParser } from "../services/challenge-parser.service.js";
import {
  buildChallengePreviewComponents,
  buildChallengePreviewEmbed,
  createChallengeDraftFromParser,
} from "../services/challenge.service.js";
import { findGuildConfigByGuildId, setChallengePreviewMessage } from "../repositories/challenge.repository.js";

function isChallengeAdmin(message: Message, adminRoleId: string | null | undefined): boolean {
  if (!message.member) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return adminRoleId ? message.member.roles.cache.has(adminRoleId) : false;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

export function registerMessageHandler(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      const guildConfig = await findGuildConfigByGuildId(message.guild.id);
      if (!guildConfig?.challengeChannelId || message.channelId !== guildConfig.challengeChannelId) return;
      if (!message.content.trim() && message.attachments.size === 0) return;
      if (!isChallengeAdmin(message, guildConfig.adminRoleId)) return;
      if (!config.GEMINI_API_KEY) {
        logger.error({ guildId: message.guild.id }, "Cannot parse challenge: GEMINI_API_KEY is not configured");
        return;
      }

      const registration = {
        guildId: message.guild.id,
        authorId: message.author.id,
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        sourceContent: message.content,
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
      const rubric = challenge.rubrics[0];

      const preview = await message.author.send({
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
        previewMessageId: preview.id,
      });

      logger.info(
        { challengeId: challenge.id, messageId: message.id, rubricId: rubric?.id },
        "Challenge draft created and preview sent",
      );
    } catch (error) {
      logger.error({ err: error, messageId: message.id, guildId: message.guild?.id }, "Challenge registration failed");
    }
  });
}
