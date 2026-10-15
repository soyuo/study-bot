import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerInteractionHandler } from "./handlers/interaction-create.js";
import { registerMessageHandler } from "./handlers/message-create.js";
import { registerApplicationCommands } from "./commands/register.js";
import { startDeadlineSweep } from "./services/deadline.service.js";
import { startGeminiSubmissionGradingWorker } from "./workers/submission-grading.worker.js";
import { disconnectDatabase } from "./db/prisma.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

let stopDeadlineSweep: (() => Promise<void>) | undefined;
let stopGradingWorker: (() => Promise<void>) | undefined;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Study bot shutdown started");
  try {
    await stopGradingWorker?.();
    await stopDeadlineSweep?.();
    client.destroy();
    await disconnectDatabase();
    logger.info("Study bot shutdown completed");
  } catch (error) {
    logger.error({ err: error }, "Study bot shutdown failed");
    process.exitCode = 1;
  }
}

client.once("ready", (readyClient) => {
  logger.info({ user: readyClient.user.tag }, "Study bot is ready");
  registerApplicationCommands(readyClient).catch((error) => {
    logger.error({ err: error }, "Application command registration failed");
  });
  stopDeadlineSweep = startDeadlineSweep(readyClient);
  if (config.GEMINI_API_KEY) {
    stopGradingWorker = startGeminiSubmissionGradingWorker(readyClient, {
      apiKey: config.GEMINI_API_KEY,
      model: config.GEMINI_MODEL,
    });
  } else {
    logger.warn("Submission grading worker is disabled: GEMINI_API_KEY is not configured");
  }
});

client.on("error", (error) => logger.error({ err: error }, "Discord client error"));

registerMessageHandler(client);
registerInteractionHandler(client);

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.DISCORD_TOKEN);
