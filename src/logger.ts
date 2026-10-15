import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "token",
      "apiKey",
      "password",
      "secret",
      "authorization",
      "DISCORD_TOKEN",
      "GEMINI_API_KEY",
      "DATABASE_URL",
      "*.token",
      "*.apiKey",
      "*.password",
      "*.secret",
      "*.authorization",
    ],
    censor: "[REDACTED]",
  },
});
