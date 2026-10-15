import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const deadlinePolicySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("NONE"),
  }),
  z.object({
    type: z.literal("RELATIVE"),
    durationHours: z.number().int().positive().max(24 * 365),
  }),
  z.object({
    type: z.literal("ABSOLUTE"),
    isoDateTime: z.string().datetime({ offset: true }),
  }),
]);

export const gradingCriterionSchema = z.object({
  code: nonEmptyString.regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: nonEmptyString.max(100),
  description: nonEmptyString.max(2_000),
  maxPoints: z.number().int().positive(),
  evaluationGuide: nonEmptyString.max(4_000),
  verificationMethod: z.enum([
    "STATIC_ANALYSIS",
    "DOCUMENT_REVIEW",
    "TEST_RESULT",
    "MANUAL_REVIEW",
  ]),
});

export const parsedChallengeSchema = z
  .object({
    title: nonEmptyString.max(200),
    description: nonEmptyString.max(10_000),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    requirements: z.array(nonEmptyString.max(500)).max(100),
    optionalRequirements: z.array(nonEmptyString.max(500)).max(100),
    deliverables: z.array(nonEmptyString.max(500)).max(50),
    allowedLanguages: z.array(nonEmptyString.max(100)).max(50),
    constraints: z.array(nonEmptyString.max(500)).max(100),
    deadlinePolicy: deadlinePolicySchema,
    maxScore: z.number().int().positive().max(10_000),
    rubric: z.array(gradingCriterionSchema).min(1).max(100),
  })
  .superRefine((challenge, context) => {
    const rubricScore = challenge.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
    if (rubricScore !== challenge.maxScore) {
      context.addIssue({
        code: "custom",
        path: ["rubric"],
        message: `Rubric points (${rubricScore}) must equal maxScore (${challenge.maxScore})`,
      });
    }
  });

export const challengeRegistrationInputSchema = z
  .object({
    guildId: nonEmptyString,
    authorId: nonEmptyString,
    sourceChannelId: nonEmptyString,
    sourceMessageId: nonEmptyString,
    sourceContent: z.string().max(50_000),
    sourceAttachments: z
      .array(
        z.object({
          url: z.string().url(),
          filename: nonEmptyString.max(255).optional(),
          contentType: z.string().max(200).optional(),
          sizeBytes: z.number().int().nonnegative().max(10 * 1024 * 1024).optional(),
        }),
      )
      .max(20),
  })
  .superRefine((input, context) => {
    for (const [index, criterion] of input.sourceAttachments.entries()) {
      if (criterion.sizeBytes === undefined) continue;
      if (criterion.sizeBytes > 10 * 1024 * 1024) {
        context.addIssue({
          code: "custom",
          path: ["sourceAttachments", index, "sizeBytes"],
          message: "Attachments must be 10MB or smaller",
        });
      }
    }
  });

export type DeadlinePolicy = z.infer<typeof deadlinePolicySchema>;
export type GradingCriterionInput = z.infer<typeof gradingCriterionSchema>;
export type ParsedChallenge = z.infer<typeof parsedChallengeSchema>;
export type ChallengeRegistrationInput = z.infer<typeof challengeRegistrationInputSchema>;
