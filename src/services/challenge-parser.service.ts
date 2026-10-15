import {
  parsedChallengeSchema,
  type ChallengeRegistrationInput,
  type ParsedChallenge,
} from "../validators/challenge.schema.js";

export interface ChallengeParser {
  parse(input: ChallengeRegistrationInput): Promise<ParsedChallenge>;
}

export type MockChallengeParserResult =
  | ParsedChallenge
  | ((input: ChallengeRegistrationInput) => ParsedChallenge | Promise<ParsedChallenge>);

/**
 * Deterministic parser for local development and tests.
 * The result still passes through the same Zod validation used by a real AI parser.
 */
export class MockChallengeParser implements ChallengeParser {
  public constructor(private readonly result: MockChallengeParserResult) {}

  async parse(input: ChallengeRegistrationInput): Promise<ParsedChallenge> {
    const result = typeof this.result === "function" ? await this.result(input) : this.result;
    return parsedChallengeSchema.parse(result);
  }
}

export function validateParsedChallenge(value: unknown): ParsedChallenge {
  return parsedChallengeSchema.parse(value);
}
