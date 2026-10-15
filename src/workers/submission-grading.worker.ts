import {
  claimNextSubmissionGradingJob,
  completeSubmissionGrading,
  failSubmissionGrading,
  findSubmissionGradingSnapshot,
  recoverStaleSubmissionGradingJobs,
} from "../repositories/challenge.repository.js";
import {
  GeminiChallengeGrader,
  type ChallengeGrader,
} from "../services/grading.service.js";
import { publishGradingResult } from "../services/grading-result.service.js";
import { logger } from "../logger.js";
import type { Client } from "discord.js";
import { validateGradingResponse } from "../validators/grading.schema.js";

type GradingJob = NonNullable<Awaited<ReturnType<typeof claimNextSubmissionGradingJob>>>;

function snapshotIdFromJob(job: GradingJob): string {
  const payload = job.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Grading job payload is invalid");
  }
  const snapshotId = (payload as Record<string, unknown>).snapshotId;
  if (typeof snapshotId !== "string" || !snapshotId) {
    throw new Error("Grading job snapshotId is missing");
  }
  return snapshotId;
}

export async function processNextSubmissionGradingJob(
  grader: ChallengeGrader,
  modelName: string,
  onCompleted?: (gradeId: string) => Promise<void>,
) {
  const job = await claimNextSubmissionGradingJob();
  if (!job) return { processed: false };

  let gradeId: string | undefined;
  try {
    if (!job.submission) throw new Error("Grading job submission is missing");
    const snapshotId = snapshotIdFromJob(job);
    const snapshot = await findSubmissionGradingSnapshot({
      submissionId: job.submission.id,
      snapshotId,
    });
    if (!snapshot) throw new Error("Submission grading snapshot is missing");

    const rubric = job.submission.challenge.rubrics.find((version) => version.isFrozen);
    if (!rubric) throw new Error("Frozen rubric is missing");

    const response = await grader.grade({
      challenge: {
        title: job.submission.challenge.title,
        description: job.submission.challenge.description,
        requirements: job.submission.challenge.requirements,
        deliverables: job.submission.challenge.deliverables,
      },
      rubric: rubric.criteria,
      artifacts: snapshot.artifacts.map((artifact) => ({
        type: artifact.type,
        source: artifact.source,
        content: artifact.content,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
      })),
    });

    const checked = validateGradingResponse(response, rubric.criteria);
    const reviewRequired = rubric.criteria.some(
      (criterion) => criterion.verificationMethod === "MANUAL_REVIEW",
    );
    const status = reviewRequired
      ? "REVIEW_REQUIRED"
      : checked.totalScore === checked.maxScore
        ? "PASSED"
        : "FAILED";

    const grade = await completeSubmissionGrading({
      jobId: job.id,
      submissionId: job.submission.id,
      snapshotId,
      rubricVersionId: rubric.id,
      modelName,
      totalScore: checked.totalScore,
      maxScore: checked.maxScore,
      status,
      reviewRequired,
      feedback: [checked.response.summary, ...checked.response.improvements.map((item) => `개선: ${item}`)].join("\n"),
      results: checked.response.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        points: criterion.score,
        feedback: criterion.feedback,
        evidence: criterion.evidence,
      })),
    });
    gradeId = grade.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown grading error";
    await failSubmissionGrading({
      jobId: job.id,
      submissionId: job.submissionId ?? "",
      errorMessage: message,
      retryDelayMs: Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempt - 1)),
    });
    return { processed: true };
  }
  if (gradeId && onCompleted) {
    try {
      await onCompleted(gradeId);
    } catch (error) {
      logger.error({ err: error, gradeId }, "Grading result publication failed");
    }
  }
  return { processed: true, gradeId };
}

export function createGeminiSubmissionGradingWorker(options: {
  apiKey: string;
  model?: string;
}) {
  const modelName = options.model ?? "gemini-2.5-flash";
  const grader = new GeminiChallengeGrader(options);
  return () => processNextSubmissionGradingJob(grader, modelName);
}

export function startGeminiSubmissionGradingWorker(
  client: Client,
  options: { apiKey: string; model?: string; intervalMs?: number },
) {
  const modelName = options.model ?? "gemini-2.5-flash";
  const grader = new GeminiChallengeGrader(options);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await recoverStaleSubmissionGradingJobs();
      await processNextSubmissionGradingJob(
        grader,
        modelName,
        async (gradeId) => {
          await publishGradingResult(client, gradeId);
        },
      );
    } catch (error) {
      logger.error({ err: error }, "Submission grading worker failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 2_000);
  timer.unref?.();
  return timer;
}
