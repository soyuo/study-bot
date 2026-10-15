import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export async function persistDiscordAttachment(input: {
  submissionId: string;
  source: string;
  filename?: string;
  maxBytes: number;
}) {
  const response = await fetch(input.source, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Attachment download failed with HTTP ${response.status}`);

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > input.maxBytes) {
    throw new Error(`Attachment exceeds the ${input.maxBytes}-byte limit`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > input.maxBytes) throw new Error(`Attachment exceeds the ${input.maxBytes}-byte limit`);

  const safeName = (input.filename ?? "attachment").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const storageKey = `submissions/${input.submissionId}/${randomUUID()}-${safeName}`;
  const absolutePath = resolve(config.ARTIFACT_STORAGE_DIR, storageKey);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, { flag: "wx" });
  return { storageKey, sizeBytes: bytes.byteLength };
}
