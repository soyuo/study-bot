import type { Client } from "discord.js";
import { logger } from "../logger.js";
import {
  closeExpiredChallenges,
} from "../repositories/challenge.repository.js";

export async function runDeadlineSweep(client: Client, now = new Date()) {
  const lockedChannels = await closeExpiredChallenges(now);
  let locked = 0;
  for (const submission of lockedChannels) {
    try {
      const channel = await client.channels.fetch(submission.channelId);
      if (!channel?.isTextBased() || !("permissionOverwrites" in channel)) {
        throw new Error("Submission channel is not available");
      }
      await channel.permissionOverwrites.edit(submission.userId, {
        ViewChannel: true,
        SendMessages: false,
        AttachFiles: false,
        AddReactions: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      });
      locked += 1;
    } catch (error) {
      logger.warn(
        { err: error, challengeId: submission.challengeId, submissionId: submission.submissionId },
        "Expired submission channel could not be locked",
      );
    }
  }
  return { expiredSubmissions: lockedChannels.length, lockedChannels: locked };
}

export function startDeadlineSweep(client: Client, intervalMs = 60_000) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDeadlineSweep(client).catch((error) => {
      logger.error({ err: error }, "Deadline sweep failed");
    }).finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
}
