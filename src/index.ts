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
import { connectDatabase, disconnectDatabase } from "./db/prisma.js";
import { withRetry } from "./utils/retry.js";
import { seedGuildConfigurationFromEnvironment } from "./services/configuration.service.js";

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

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Study bot shutdown started");
  try {
    await stopGradingWorker?.();
    await stopDeadlineSweep?.();
    client.destroy();
    await disconnectDatabase();
    logger.info("Study bot shutdown completed");
    process.exitCode = exitCode;
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
client.on("warn", (message) => logger.warn({ message }, "Discord client warning"));
client.on("debug", (message) => logger.debug({ message }, "Discord client debug"));
client.on("shardError", (error, shardId) => {
  logger.error({ err: error, shardId }, "Discord shard error");
});
client.on("rateLimit", (info) => {
  logger.warn(
    {
      route: info.route,
      method: info.method,
      timeoutMs: info.timeout,
      limit: info.limit,
      global: info.global,
    },
    "Discord API rate limit reached",
  );
});
client.on("invalidated", () => {
  logger.fatal("Discord session was invalidated");
  void shutdown("discordInvalidated", 1);
});

registerMessageHandler(client);
registerInteractionHandler(client);

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});
process.once("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

try {
  await withRetry(() => connectDatabase(), {
    maxAttempts: 3,
    delayMs: 1_000,
    onRetry: (error, attempt) => {
      logger.warn({ err: error, attempt, maxAttempts: 3 }, "Database connection will be retried");
    },
  });
  logger.info("Database connection verified");
  const seededGuildConfig = await seedGuildConfigurationFromEnvironment();
  if (seededGuildConfig) {
    logger.info({ guildId: seededGuildConfig.guildId }, "Guild configuration seeded from environment");
  }
  await client.login(config.DISCORD_TOKEN);
} catch (error) {
  logger.fatal({ err: error }, "Study bot startup failed");
  await disconnectDatabase().catch((disconnectError) => {
    logger.error({ err: disconnectError }, "Database disconnect after startup failure failed");
  });
  process.exitCode = 1;
}
