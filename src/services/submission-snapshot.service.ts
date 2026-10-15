import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type Message,
  type TextChannel,
} from "discord.js";
import {
  createSubmissionSnapshot,
  findSubmissionForCompletion,
  lockSubmission,
  queueSubmissionGrading,
} from "../repositories/challenge.repository.js";

const urlPattern = /https?:\/\/[^\s<>]+/g;
const githubPattern = /^https?:\/\/github\.com\//i;

type SnapshotArtifact = {
  type: "TEXT" | "FILE" | "URL" | "GITHUB";
  source: string;
  content?: string;
  sourceMessageId?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
};

function collectMessageArtifacts(message: Message): SnapshotArtifact[] {
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

async function collectChannelArtifacts(channel: TextChannel, controlMessageId: string | null) {
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
    artifacts: messages.flatMap(collectMessageArtifacts),
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

  const submittedAt = new Date();
  await lockSubmission(submissionId, submittedAt);

  const channel = interaction.channel as TextChannel;
  await channel.permissionOverwrites.edit(submission.userId, {
    SendMessages: false,
    AttachFiles: false,
    AddReactions: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  });

  await interaction.message.edit({
    content: "제출이 확정되었습니다. 제출물은 수정할 수 없습니다.",
    components: [],
  });

  const collected = await collectChannelArtifacts(channel, submission.controlMessageId);
  const snapshot = await createSubmissionSnapshot({
    submissionId,
    capturedAt: submittedAt,
    messageCount: collected.messages.length,
    metadata: {
      channelId: channel.id,
      controlMessageId: submission.controlMessageId,
      capturedAt: submittedAt.toISOString(),
    },
    artifacts: collected.artifacts,
  });

  const grading = await queueSubmissionGrading({
    submissionId,
    snapshotId: snapshot.id,
  });

  return { snapshot, grading };
}
