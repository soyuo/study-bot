import { connectDatabase, disconnectDatabase } from "../db/prisma.js";
import { withRetry } from "../utils/retry.js";

try {
  await withRetry(() => connectDatabase(), {
    maxAttempts: 5,
    delayMs: 1_000,
    onRetry: (error, attempt) => {
      console.warn(`Database is not ready; retry ${attempt}/4`, error);
    },
  });
  console.info("Database connection and query check passed");
} catch (error) {
  console.error("Database check failed", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase().catch((error) => {
    console.error("Database disconnect failed after database check", error);
    process.exitCode = 1;
  });
}
