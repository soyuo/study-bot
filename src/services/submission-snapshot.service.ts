import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type Message,
  type TextChannel,
} from "discord.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  createSubmissionSnapshot,
  findSubmissionForCompletion,
  lockSubmission,
  queueSubmissionGrading,
} from "../repositories/challenge.repository.js";
import { resolveGitHubSnapshot } from "./github.service.js";
import { persistDiscordAttachment } from "./artifact-storage.service.js";
import { config } from "../config.js";
import { buildSubmissionControlContent } from "./challenge-hint.service.js";

const urlPattern = /https?:\/\/[^\s<>]+/g;
const githubPattern = /^https?:\/\/github\.com\//i;
const execFileAsync = promisify(execFile);
const MAX_ZIP_ENTRIES = 200;
const MAX_EXTRACTED_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const textFilePattern = /\.(c|cc|cpp|css|csv|go|h|hpp|html?|java|js|json|jsx|md|mjs|py|rs|sh|sql|ts|tsx|txt|vue|xml|yml|yaml)$/i;

type SnapshotArtifact = {
  type: "TEXT" | "FILE" | "URL" | "GITHUB";
  source: string;
  content?: string;
  sourceMessageId?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  commitSha?: string;
  storageKey?: string;
};

function collectMessageArtifacts(message: Message, maxAttachmentBytes: number): SnapshotArtifact[] {
  const artifacts: SnapshotArtifact[] = [];

  if (message.content.trim()) {
    artifacts.push({
      type: "TEXT",
      source: `discord-message:${message.id}`,
      content: message.content,
      sourceMessageId: message.id,
    });
  }

  for (const attachment of message.attachments.values()) {
    if (attachment.size > maxAttachmentBytes) {
      throw new Error(
        `Attachment ${attachment.name ?? attachment.id} exceeds the ${maxAttachmentBytes}-byte limit`,
      );
    }
    artifacts.push({
      type: "FILE",
      source: attachment.url,
      sourceMessageId: message.id,
      filename: attachment.name ?? undefined,
      mimeType: attachment.contentType ?? undefined,
      sizeBytes: attachment.size,
    });
  }

  for (const rawUrl of message.content.match(urlPattern) ?? []) {
    const url = rawUrl.replace(/[),.!?]+$/, "");
    artifacts.push({
      type: githubPattern.test(url) ? "GITHUB" : "URL",
      source: url,
      sourceMessageId: message.id,
    });
  }

  return artifacts;
}

function isSafeZipEntry(entry: string): boolean {
  const normalized = entry.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !normalized.split("/").includes("..") && !normalized.endsWith("/");
}

export async function expandZipArtifact(artifact: SnapshotArtifact): Promise<SnapshotArtifact[]> {
  if (artifact.type !== "FILE" || !artifact.storageKey || !artifact.filename?.toLowerCase().endsWith(".zip")) return [];

  const archivePath = resolve(config.ARTIFACT_STORAGE_DIR, artifact.storageKey);
  try {
    const listed = await execFileAsync("unzip", ["-Z1", archivePath], { maxBuffer: 1_000_000 });
    const entries = String(listed.stdout)
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => isSafeZipEntry(entry) && textFilePattern.test(entry))
      .slice(0, MAX_ZIP_ENTRIES);
    const expanded: SnapshotArtifact[] = [];
    let extractedBytes = 0;

    for (const entry of entries) {
      const result = await execFileAsync("unzip", ["-p", archivePath, entry], {
        maxBuffer: MAX_TEXT_FILE_BYTES,
        encoding: "buffer",
      }) as unknown as { stdout: Buffer };
      const bytes = result.stdout;
      extractedBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_TEXT_FILE_BYTES || extractedBytes > MAX_EXTRACTED_BYTES) break;
      expanded.push({
        type: "TEXT",
        source: `zip:${artifact.storageKey}#${entry}`,
        content: bytes.toString("utf8"),
        filename: entry,
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
      });
    }
    return expanded;
  } catch (error) {
    throw new Error(`ZIP extraction failed for ${artifact.filename}`, { cause: error });
  }
}

async function collectChannelArtifacts(
  channel: TextChannel,
  controlMessageId: string | null,
  maxAttachmentBytes: number,
) {
  const messages: Message[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const userMessages = [...batch.values()].filter(
      (message) => !message.author.bot && message.id !== controlMessageId,
    );
    messages.push(...userMessages);

    if (batch.size < 100) break;
    const oldest = batch.last();
    if (!oldest) break;
    before = oldest.id;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return {
    messages,
    artifacts: messages.flatMap((message) => collectMessageArtifacts(message, maxAttachmentBytes)),
  };
}

export async function completeSubmission(interaction: ButtonInteraction, submissionId: string) {
  if (!interaction.guild || !interaction.channel?.isTextBased() || interaction.channel.type !== 0) {
    throw new Error("Submission completion must happen in a guild text channel");
  }

  const submission = await findSubmissionForCompletion(submissionId);
  if (!submission || submission.userId !== interaction.user.id) {
    throw new Error("Only the submission owner can complete this submission");
  }
  if (submission.channelId !== interaction.channelId) {
    throw new Error("Submission channel does not match");
  }

  const channel = interaction.channel as TextChannel;
  const submittedAt = new Date();
  const collected = await collectChannelArtifacts(
    channel,
    submission.controlMessageId,
    submission.challenge.guildConfig.maxAttachmentBytes,
  );

  const enrichedArtifacts = await Promise.all(
    collected.artifacts.map(async (artifact) => {
      if (artifact.type === "FILE") {
        const stored = await persistDiscordAttachment({
          submissionId,
          source: artifact.source,
          filename: artifact.filename,
          maxBytes: submission.challenge.guildConfig.maxAttachmentBytes,
        });
        const storedArtifact = { ...artifact, storageKey: stored.storageKey, sizeBytes: stored.sizeBytes };
        const expanded = await expandZipArtifact(storedArtifact);
        return [storedArtifact, ...expanded];
      }
      if (artifact.type !== "GITHUB") return [artifact];
      const resolved = await resolveGitHubSnapshot(artifact.source);
      return [{ ...artifact, content: resolved.content, commitSha: resolved.commitSha }];
    }),
  );

  await lockSubmission(submissionId, submittedAt);
  await channel.permissionOverwrites.edit(submission.userId, {
    SendMessages: false,
    AttachFiles: false,
    AddReactions: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  });

  await interaction.message.edit({
    content: buildSubmissionControlContent(submission.challenge.title, submission.id, true, "SUBMITTED"),
    components: [],
  });

  const snapshot = await createSubmissionSnapshot({
    submissionId,
    capturedAt: submittedAt,
    messageCount: collected.messages.length,
    metadata: {
      channelId: channel.id,
      controlMessageId: submission.controlMessageId,
      capturedAt: submittedAt.toISOString(),
    },
    artifacts: enrichedArtifacts.flat(),
  });

  const grading = await queueSubmissionGrading({
    submissionId,
    snapshotId: snapshot.id,
  });

  return { snapshot, grading };
}
