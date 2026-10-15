import "dotenv/config";
import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1),
  DISCORD_CLIENT_ID: z.string().trim().min(1),
  DISCORD_GUILD_ID: optionalId,
  CHALLENGE_CHANNEL_ID: optionalId,
  SUBMISSION_CATEGORY_ID: optionalId,
  ADMIN_ROLE_ID: optionalId,
  ADMIN_LOG_CHANNEL_ID: optionalId,
  GEMINI_API_KEY: optionalId,
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-2.5-flash"),
  ARTIFACT_STORAGE_DIR: z.string().trim().min(1).default("data/artifacts"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;
