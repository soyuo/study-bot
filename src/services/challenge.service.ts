import { EmbedBuilder } from "discord.js";
import type { Challenge } from "../types/challenge.js";
import { customIds } from "../commands/ids.js";
import { createDraftChallenge } from "../repositories/challenge.repository.js";
import {
  challengeRegistrationInputSchema,
  parsedChallengeSchema,
  type ChallengeRegistrationInput,
  type ParsedChallenge,
} from "../validators/challenge.schema.js";

export async function createChallengeDraft(input: {
  registration: ChallengeRegistrationInput;
  parsed: ParsedChallenge;
}) {
  const registration = challengeRegistrationInputSchema.parse(input.registration);
  const parsed = parsedChallengeSchema.parse(input.parsed);
  return createDraftChallenge({ registration, parsed });
}

export function buildChallengeEmbed(challenge: Challenge): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Challenge: ${challenge.title}`)
    .setDescription(challenge.description)
    .addFields(
      { name: "난이도", value: challenge.difficulty, inline: true },
      { name: "최대 점수", value: `${challenge.maxScore}점`, inline: true },
      {
        name: "요구사항",
        value: challenge.requirements.length > 0 ? challenge.requirements.map((item) => `• ${item}`).join("\n") : "없음",
      },
      {
        name: "제출물",
        value: challenge.deliverables.length > 0 ? challenge.deliverables.map((item) => `• ${item}`).join("\n") : "없음",
      },
    )
    .setColor(0x5865f2);

  if (challenge.deadline) embed.addFields({ name: "마감", value: `<t:${Math.floor(challenge.deadline.getTime() / 1000)}:F>` });
  return embed;
}

export function buildSubmitButton(challengeId: string) {
  return {
    type: 2,
    style: 1,
    label: "과제 제출",
    custom_id: customIds.submit(challengeId),
  } as const;
}
