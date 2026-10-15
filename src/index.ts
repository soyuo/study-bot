import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerInteractionHandler } from "./handlers/interaction-create.js";
import { registerMessageHandler } from "./handlers/message-create.js";

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
});

client.on("error", (error) => logger.error({ err: error }, "Discord client error"));

registerMessageHandler(client);
registerInteractionHandler(client);

await client.login(config.DISCORD_TOKEN);
