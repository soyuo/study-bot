import { connectDatabase, disconnectDatabase } from "../db/prisma.js";

try {
  await connectDatabase();
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
