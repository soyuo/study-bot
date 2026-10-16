export const MAX_CHALLENGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface MessageTextAttachment {
  name?: string | null;
  url: string;
  size?: number;
}

export async function readMessageTextAttachment(attachment: MessageTextAttachment): Promise<string | null> {
  if (attachment.name?.toLowerCase() !== "message.txt") return null;
  if (attachment.size !== undefined && attachment.size > MAX_CHALLENGE_ATTACHMENT_BYTES) {
    throw new Error("message.txt exceeds the 10 MiB attachment limit");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`message.txt download failed with HTTP ${response.status}`);

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_CHALLENGE_ATTACHMENT_BYTES) {
      throw new Error("message.txt exceeds the 10 MiB attachment limit");
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_CHALLENGE_ATTACHMENT_BYTES) {
      throw new Error("message.txt exceeds the 10 MiB attachment limit");
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new Error("message.txt is not valid UTF-8", { cause: error });
    if (error instanceof Error && error.name === "AbortError") throw new Error("message.txt download timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
