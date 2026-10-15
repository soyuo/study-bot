export type RetryOptions = {
  maxAttempts: number;
  delayMs: number;
  backoffFactor?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
};

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  if (options.delayMs < 0) throw new Error("delayMs must not be negative");

  const backoffFactor = options.backoffFactor ?? 2;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(error, attempt);
      await sleep(options.delayMs * backoffFactor ** (attempt - 1));
    }
  }

  throw lastError;
}
