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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", (readyClient) => {
  logger.info({ user: readyClient.user.tag }, "Study bot is ready");
  registerApplicationCommands(readyClient).catch((error) => {
    logger.error({ err: error }, "Application command registration failed");
  });
  startDeadlineSweep(readyClient);
});

client.on("error", (error) => logger.error({ err: error }, "Discord client error"));

registerMessageHandler(client);
registerInteractionHandler(client);

await client.login(config.DISCORD_TOKEN);
