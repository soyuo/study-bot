export type ChallengeDifficulty = "EASY" | "MEDIUM" | "HARD";

export type ChallengeStatus = "DRAFT" | "ACTIVE" | "CLOSED";

export interface Challenge {
  id: string;
  guildId: string;
  authorId: string;
  sourceChannelId: string;
  sourceMessageId: string;
  publicMessageId: string | null;
  title: string;
  description: string;
  difficulty: ChallengeDifficulty;
  requirements: string[];
  optionalRequirements: string[];
  deliverables: string[];
  allowedLanguages: string[];
  constraints: string[];
  deadline: Date | null;
  maxScore: number;
  status: ChallengeStatus;
  createdAt: Date;
  activatedAt: Date | null;
  closedAt: Date | null;
}

export type SubmissionStatus =
  | "OPEN"
  | "SUBMITTED"
  | "GRADING"
  | "GRADED"
  | "GRADING_FAILED";

export interface Submission {
  id: string;
  challengeId: string;
  userId: string;
  channelId: string | null;
  controlMessageId: string | null;
  status: SubmissionStatus;
}
