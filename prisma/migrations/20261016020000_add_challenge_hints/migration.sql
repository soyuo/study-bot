CREATE TABLE "ChallengeHint" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeHint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChallengeHintView" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChallengeHintView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChallengeHint_challengeId_key" ON "ChallengeHint"("challengeId");
CREATE UNIQUE INDEX "ChallengeHintView_challengeId_userId_key" ON "ChallengeHintView"("challengeId", "userId");
CREATE INDEX "ChallengeHintView_challengeId_firstViewedAt_idx" ON "ChallengeHintView"("challengeId", "firstViewedAt");
CREATE INDEX "ChallengeHintView_userId_firstViewedAt_idx" ON "ChallengeHintView"("userId", "firstViewedAt");

ALTER TABLE "ChallengeHint" ADD CONSTRAINT "ChallengeHint_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeHintView" ADD CONSTRAINT "ChallengeHintView_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
