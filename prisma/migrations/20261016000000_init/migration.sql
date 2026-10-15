-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED', 'DELETED');
CREATE TYPE "ChallengeDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');
CREATE TYPE "SubmissionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'GRADING', 'GRADED', 'GRADING_FAILED', 'LOCKED', 'DELETED');
CREATE TYPE "ArtifactType" AS ENUM ('TEXT', 'FILE', 'URL', 'GITHUB');
CREATE TYPE "VerificationMethod" AS ENUM ('STATIC_ANALYSIS', 'DOCUMENT_REVIEW', 'TEST_RESULT', 'MANUAL_REVIEW');
CREATE TYPE "GradeStatus" AS ENUM ('PASSED', 'FAILED', 'REVIEW_REQUIRED');
CREATE TYPE "JobType" AS ENUM ('CHALLENGE_PARSE', 'CHALLENGE_ACTIVATE', 'SUBMISSION_SNAPSHOT', 'SUBMISSION_GRADING', 'SUBMISSION_REGRADING', 'ARCHIVE');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ArchiveStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "challengeChannelId" TEXT,
    "submissionCategoryId" TEXT,
    "archiveCategoryId" TEXT,
    "adminRoleId" TEXT,
    "adminLogChannelId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "maxAttachmentBytes" INTEGER NOT NULL DEFAULT 10485760,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "guildConfigId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourceContent" TEXT,
    "sourceAttachments" JSONB,
    "previewMessageId" TEXT,
    "previewUserId" TEXT,
    "publicChannelId" TEXT,
    "publicMessageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "difficulty" "ChallengeDifficulty" NOT NULL,
    "requirements" JSONB NOT NULL,
    "optionalRequirements" JSONB NOT NULL,
    "deliverables" JSONB NOT NULL,
    "allowedLanguages" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "deadline" TIMESTAMP(3),
    "maxScore" INTEGER NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricVersion" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RubricVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradingCriterion" (
    "id" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "evaluationGuide" TEXT NOT NULL,
    "verificationMethod" "VerificationMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GradingCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "controlMessageId" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionSnapshot" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL,
    "metadata" JSONB,
    CONSTRAINT "SubmissionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionArtifact" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "type" "ArtifactType" NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT,
    "storageKey" TEXT,
    "sourceMessageId" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "commitSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "SubmissionArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "totalScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "status" "GradeStatus" NOT NULL,
    "feedback" TEXT NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "modelName" TEXT,
    "modelResponseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradeCriterionResult" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "evidence" TEXT,
    CONSTRAINT "GradeCriterionResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArchiveRecord" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "submissionId" TEXT,
    "channelId" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchiveRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "guildConfigId" TEXT NOT NULL,
    "challengeId" TEXT,
    "submissionId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildConfigId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "challengeId" TEXT,
    "submissionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
CREATE INDEX "GuildConfig_guildId_idx" ON "GuildConfig"("guildId");
CREATE INDEX "Challenge_guildConfigId_status_idx" ON "Challenge"("guildConfigId", "status");
CREATE INDEX "Challenge_sourceChannelId_sourceMessageId_idx" ON "Challenge"("sourceChannelId", "sourceMessageId");
CREATE INDEX "RubricVersion_challengeId_isFrozen_idx" ON "RubricVersion"("challengeId", "isFrozen");
CREATE UNIQUE INDEX "RubricVersion_challengeId_version_key" ON "RubricVersion"("challengeId", "version");
CREATE UNIQUE INDEX "GradingCriterion_rubricVersionId_code_key" ON "GradingCriterion"("rubricVersionId", "code");
CREATE INDEX "Submission_challengeId_status_idx" ON "Submission"("challengeId", "status");
CREATE INDEX "Submission_userId_status_idx" ON "Submission"("userId", "status");
CREATE UNIQUE INDEX "Submission_challengeId_userId_key" ON "Submission"("challengeId", "userId");
CREATE INDEX "SubmissionSnapshot_submissionId_capturedAt_idx" ON "SubmissionSnapshot"("submissionId", "capturedAt");
CREATE INDEX "SubmissionArtifact_submissionId_type_idx" ON "SubmissionArtifact"("submissionId", "type");
CREATE INDEX "SubmissionArtifact_snapshotId_idx" ON "SubmissionArtifact"("snapshotId");
CREATE INDEX "Grade_submissionId_createdAt_idx" ON "Grade"("submissionId", "createdAt");
CREATE UNIQUE INDEX "Grade_submissionId_attempt_key" ON "Grade"("submissionId", "attempt");
CREATE UNIQUE INDEX "GradeCriterionResult_gradeId_criterionId_key" ON "GradeCriterionResult"("gradeId", "criterionId");
CREATE INDEX "ArchiveRecord_challengeId_status_idx" ON "ArchiveRecord"("challengeId", "status");
CREATE INDEX "ArchiveRecord_channelId_idx" ON "ArchiveRecord"("channelId");
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");
CREATE INDEX "Job_status_availableAt_idx" ON "Job"("status", "availableAt");
CREATE INDEX "Job_challengeId_type_idx" ON "Job"("challengeId", "type");
CREATE INDEX "Job_submissionId_type_idx" ON "Job"("submissionId", "type");
CREATE INDEX "AuditLog_guildConfigId_createdAt_idx" ON "AuditLog"("guildConfigId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradingCriterion" ADD CONSTRAINT "GradingCriterion_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionSnapshot" ADD CONSTRAINT "SubmissionSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionArtifact" ADD CONSTRAINT "SubmissionArtifact_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionArtifact" ADD CONSTRAINT "SubmissionArtifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SubmissionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradeCriterionResult" ADD CONSTRAINT "GradeCriterionResult_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradeCriterionResult" ADD CONSTRAINT "GradeCriterionResult_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "GradingCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
