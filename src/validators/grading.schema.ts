import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const gradingCriterionResultSchema = z.object({
  criterionId: nonEmptyString,
  score: z.number().int().nonnegative(),
  maxScore: z.number().int().positive(),
  feedback: nonEmptyString.max(4_000),
  evidence: z.array(nonEmptyString.max(2_000)).max(20),
});

export const gradingResponseSchema = z.object({
  criteria: z.array(gradingCriterionResultSchema).min(1).max(100),
  summary: nonEmptyString.max(10_000),
  improvements: z.array(nonEmptyString.max(2_000)).max(50),
});

export type GradingResponse = z.infer<typeof gradingResponseSchema>;

export function validateGradingResponse(
  value: unknown,
  rubric: Array<{ id: string; maxPoints: number }>,
) {
  const response = gradingResponseSchema.parse(value);
  const rubricById = new Map(rubric.map((criterion) => [criterion.id, criterion]));

  if (response.criteria.length !== rubric.length) {
    throw new Error("Grading result must contain every rubric criterion exactly once");
  }

  const seen = new Set<string>();
  let totalScore = 0;

  for (const result of response.criteria) {
    const criterion = rubricById.get(result.criterionId);
    if (!criterion || seen.has(result.criterionId)) {
      throw new Error("Grading result contains an unknown or duplicated criterion");
    }
    if (result.maxScore !== criterion.maxPoints) {
      throw new Error("Grading result maxScore does not match the frozen rubric");
    }
    if (result.score > criterion.maxPoints) {
      throw new Error("Grading result score exceeds the rubric maximum");
    }
    seen.add(result.criterionId);
    totalScore += result.score;
  }

  if (seen.size !== rubric.length) {
    throw new Error("Grading result is missing a rubric criterion");
  }

  return { response, totalScore, maxScore: rubric.reduce((sum, item) => sum + item.maxPoints, 0) };
}
