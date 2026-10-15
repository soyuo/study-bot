import assert from "node:assert/strict";
import test from "node:test";
import { customIds, parseCustomId } from "./commands/ids.js";
import { formatDiscordTimestamp, isDeadlinePassed, resolveDeadline } from "./utils/deadline.js";
import { validateGradingResponse } from "./validators/grading.schema.js";

test("relative deadline resolves to exactly 72 hours", () => {
  const base = new Date("2026-01-01T00:00:00.000Z");
  const deadline = resolveDeadline({ type: "RELATIVE", durationHours: 72 }, base);
  assert.equal(deadline?.toISOString(), "2026-01-04T00:00:00.000Z");
});

test("deadline is passed at the exact boundary", () => {
  const deadline = new Date("2026-01-04T00:00:00.000Z");
  assert.equal(isDeadlinePassed(deadline, deadline), true);
  assert.equal(isDeadlinePassed(deadline, new Date("2026-01-03T23:59:59.999Z")), false);
  assert.equal(formatDiscordTimestamp(null), "제한 없음");
});

test("custom IDs round-trip through the parser", () => {
  const id = customIds.complete("submission_123");
  assert.deepEqual(parseCustomId(id), {
    action: "submission:complete",
    resourceId: "submission_123",
  });
  assert.equal(parseCustomId("invalid"), null);
});

test("grading result is validated against the frozen rubric", () => {
  const result = validateGradingResponse(
    {
      criteria: [
        {
          criterionId: "criterion-a",
          score: 8,
          maxScore: 10,
          feedback: "구조가 적절합니다.",
          evidence: ["src/index.ts"],
        },
        {
          criterionId: "criterion-b",
          score: 5,
          maxScore: 5,
          feedback: "문서가 있습니다.",
          evidence: ["README.md"],
        },
      ],
      summary: "전반적으로 양호합니다.",
      improvements: ["예외 처리를 보강하세요."],
    },
    [
      { id: "criterion-a", maxPoints: 10 },
      { id: "criterion-b", maxPoints: 5 },
    ],
  );
  assert.equal(result.totalScore, 13);
  assert.equal(result.maxScore, 15);
});

test("grading result cannot exceed a rubric maximum", () => {
  assert.throws(
    () =>
      validateGradingResponse(
        {
          criteria: [
            {
              criterionId: "criterion-a",
              score: 11,
              maxScore: 10,
              feedback: "잘못된 결과",
              evidence: ["unknown"],
            },
          ],
          summary: "검증 실패",
          improvements: [],
        },
        [{ id: "criterion-a", maxPoints: 10 }],
      ),
    /exceeds the rubric maximum/,
  );
});
