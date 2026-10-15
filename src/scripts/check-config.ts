import { config } from "../config.js";

const configured = (value: string | undefined) => Boolean(value);

console.info("Environment configuration is valid");
console.info(JSON.stringify({
  discordTokenConfigured: configured(config.DISCORD_TOKEN),
  discordClientIdConfigured: configured(config.DISCORD_CLIENT_ID),
  guildRegistrationMode: config.DISCORD_GUILD_ID ? "guild" : "global",
  geminiConfigured: configured(config.GEMINI_API_KEY),
  geminiModel: config.GEMINI_MODEL,
  artifactStorageDir: config.ARTIFACT_STORAGE_DIR,
  logLevel: config.LOG_LEVEL,
}, null, 2));
