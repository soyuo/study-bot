import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { Challenge } from "../types/challenge.js";
import { customIds } from "../commands/ids.js";
import { createDraftChallenge } from "../repositories/challenge.repository.js";
import {
  challengeRegistrationInputSchema,
  parsedChallengeSchema,
  type ChallengeRegistrationInput,
  type ParsedChallenge,
} from "../validators/challenge.schema.js";
import type { ChallengeParser } from "./challenge-parser.service.js";
import { formatDiscordTimestamp, isDeadlinePassed } from "../utils/deadline.js";

export interface ChallengeEmbedData {
  id: string;
  title: string;
  description: string;
  difficulty: Challenge["difficulty"];
  requirements: string[];
  optionalRequirements?: string[];
  deliverables: string[];
  allowedLanguages?: string[];
  constraints?: string[];
  deadline: Date | null;
  maxScore: number;
}

export async function createChallengeDraft(input: {
  registration: ChallengeRegistrationInput;
  parsed: ParsedChallenge;
}) {
  const registration = challengeRegistrationInputSchema.parse(input.registration);
  const parsed = parsedChallengeSchema.parse(input.parsed);
  return createDraftChallenge({ registration, parsed });
}

export async function createChallengeDraftFromParser(input: {
  registration: ChallengeRegistrationInput;
  parser: ChallengeParser;
}) {
  const registration = challengeRegistrationInputSchema.parse(input.registration);
  const parsed = await input.parser.parse(registration);
  return createDraftChallenge({ registration, parsed });
}

function listField(items: string[] | undefined): string {
  return items && items.length > 0 ? items.map((item) => `• ${item}`).join("\n") : "없음";
}

function buildBaseChallengeEmbed(challenge: ChallengeEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Challenge: ${challenge.title}`)
    .setDescription(challenge.description)
    .addFields(
      { name: "난이도", value: challenge.difficulty, inline: true },
      { name: "최대 점수", value: `${challenge.maxScore}점`, inline: true },
      { name: "요구사항", value: listField(challenge.requirements) },
      { name: "제출물", value: listField(challenge.deliverables) },
      { name: "마감", value: formatDiscordTimestamp(challenge.deadline), inline: true },
    )
    .setColor(0x5865f2);

  if (challenge.optionalRequirements?.length) {
    embed.addFields({ name: "선택 요구사항", value: listField(challenge.optionalRequirements) });
  }
  if (challenge.allowedLanguages?.length) {
    embed.addFields({ name: "사용 가능 언어", value: listField(challenge.allowedLanguages) });
  }
  if (challenge.constraints?.length) {
    embed.addFields({ name: "제약사항", value: listField(challenge.constraints) });
  }
  return embed;
}

export function buildChallengePreviewEmbed(challenge: ChallengeEmbedData): EmbedBuilder {
  return buildBaseChallengeEmbed(challenge)
    .setTitle(`[승인 대기] Challenge: ${challenge.title}`)
    .setFooter({ text: `Challenge ID: ${challenge.id} · Rubric은 승인 후 고정됩니다.` });
}

export function buildChallengePublicEmbed(challenge: ChallengeEmbedData): EmbedBuilder {
  return buildBaseChallengeEmbed(challenge)
    .setTitle(`Challenge: ${challenge.title}`)
    .setFooter({ text: `Challenge ID: ${challenge.id}` });
}

export function buildChallengePreviewComponents(challengeId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customIds.approve(challengeId))
        .setLabel("승인")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customIds.reject(challengeId))
        .setLabel("거절")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function buildChallengePublicComponents(challenge: ChallengeEmbedData, now = new Date()) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customIds.submit(challenge.id))
        .setLabel("과제 제출")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isDeadlinePassed(challenge.deadline, now)),
      new ButtonBuilder()
        .setCustomId(customIds.hint(challenge.id))
        .setLabel("힌트")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildSubmitButton(challengeId: string, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customIds.submit(challengeId))
    .setLabel("과제 제출")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);
}

export function buildChallengeEmbed(challenge: Challenge): EmbedBuilder {
  return buildChallengePublicEmbed(challenge);
}
