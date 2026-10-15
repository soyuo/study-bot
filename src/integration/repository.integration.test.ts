import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test("Prisma repository integration tests require TEST_DATABASE_URL", { skip: "TEST_DATABASE_URL is not configured" }, () => {});
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { prisma, disconnectDatabase } = await import("../db/prisma.js");
  const { findGuildConfigByGuildId, updateGuildConfig } = await import("../repositories/challenge.repository.js");

  const firstGuildId = randomUUID();
  const secondGuildId = randomUUID();
  const guildIds = [firstGuildId, secondGuildId];

  after(async () => {
    await prisma.guildConfig.deleteMany({ where: { guildId: { in: guildIds } } });
    await disconnectDatabase();
  });

  test("repository creates and reads a guild configuration", async () => {
    const stored = await updateGuildConfig({
      guildId: firstGuildId,
      challengeChannelId: "challenge-channel",
      submissionCategoryId: "submission-category",
    });
    const found = await findGuildConfigByGuildId(firstGuildId);

    assert.equal(found?.id, stored.id);
    assert.equal(found?.challengeChannelId, "challenge-channel");
    assert.equal(found?.submissionCategoryId, "submission-category");
    assert.equal(found?.timezone, "Asia/Seoul");
  });

  test("repository keeps guild configurations isolated", async () => {
    await updateGuildConfig({ guildId: secondGuildId, challengeChannelId: "other-channel" });
    const first = await findGuildConfigByGuildId(firstGuildId);
    const second = await findGuildConfigByGuildId(secondGuildId);

    assert.notEqual(first?.guildId, second?.guildId);
    assert.equal(first?.challengeChannelId, "challenge-channel");
    assert.equal(second?.challengeChannelId, "other-channel");
  });
}
