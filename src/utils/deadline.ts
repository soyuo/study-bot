import type { DeadlinePolicy } from "../validators/challenge.schema.js";

export const SYSTEM_TIME_ZONE = "Asia/Seoul";

export function resolveDeadline(policy: DeadlinePolicy, baseTime: Date): Date | null {
  if (policy.type === "NONE") return null;
  if (policy.type === "RELATIVE") {
    return new Date(baseTime.getTime() + policy.durationHours * 60 * 60 * 1_000);
  }
  return new Date(policy.isoDateTime);
}

export function isDeadlinePassed(deadline: Date | null, now = new Date()): boolean {
  return deadline !== null && deadline.getTime() <= now.getTime();
}

export function formatDiscordTimestamp(date: Date | null): string {
  if (!date) return "제한 없음";
  return `<t:${Math.floor(date.getTime() / 1_000)}:F> (${formatSystemDateTime(date)})`;
}

export function formatSystemDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SYSTEM_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
