import assert from "node:assert/strict";
import test from "node:test";
import { validateParsedChallenge } from "./challenge-parser.service.js";

test("normalizes rubric codes returned by the model", () => {
  const parsed = validateParsedChallenge({
    title: "Challenge",
    description: "A challenge description",
    difficulty: "MEDIUM",
    requirements: ["Requirement"],
    optionalRequirements: [],
    deliverables: ["Deliverable"],
    allowedLanguages: ["TypeScript"],
    constraints: [],
    deadlinePolicy: { type: "NONE" },
    maxScore: 10,
    rubric: [
      {
        code: "기능 구현",
        name: "Functionality",
        description: "Description",
        maxPoints: 5,
        evaluationGuide: "Guide",
        verificationMethod: "STATIC_ANALYSIS",
      },
      {
        code: "기능 구현",
        name: "Documentation",
        description: "Description",
        maxPoints: 5,
        evaluationGuide: "Guide",
        verificationMethod: "DOCUMENT_REVIEW",
      },
    ],
  });

  assert.deepEqual(parsed.rubric.map((criterion) => criterion.code), ["criterion_1", "criterion_2"]);
});

test("normalizes NORMAL difficulty to the compatible MEDIUM storage value", () => {
  const parsed = validateParsedChallenge({
    title: "Fundamentals",
    description: "A fundamentals challenge description",
    difficulty: "NORMAL",
    requirements: ["Implement the feature"],
    optionalRequirements: [],
    deliverables: ["Source code"],
    allowedLanguages: ["TypeScript"],
    constraints: [],
    deadlinePolicy: { type: "NONE" },
    maxScore: 10,
    rubric: [{
      code: "implementation",
      name: "Implementation",
      description: "The feature works",
      maxPoints: 10,
      evaluationGuide: "Review the implementation",
      verificationMethod: "STATIC_ANALYSIS",
    }],
  });

  assert.equal(parsed.difficulty, "MEDIUM");
});
