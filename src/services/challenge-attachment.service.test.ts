import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHALLENGE_ATTACHMENT_BYTES, readMessageTextAttachment } from "./challenge-attachment.service.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("reads message.txt as UTF-8 challenge content", async () => {
  globalThis.fetch = async () =>
    new Response(new TextEncoder().encode("과제 내용"), {
      status: 200,
      headers: { "content-length": "13" },
    });

  assert.equal(
    await readMessageTextAttachment({ name: "message.txt", url: "https://cdn.discordapp.com/message.txt" }),
    "과제 내용",
  );
});

test("ignores attachments other than message.txt", async () => {
  assert.equal(await readMessageTextAttachment({ name: "assignment.pdf", url: "https://example.com/file" }), null);
});

test("rejects message.txt larger than the attachment limit", async () => {
  await assert.rejects(
    () =>
      readMessageTextAttachment({
        name: "message.txt",
        url: "https://cdn.discordapp.com/message.txt",
        size: MAX_CHALLENGE_ATTACHMENT_BYTES + 1,
      }),
    /10 MiB/,
  );
});
