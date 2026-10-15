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
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SYSTEM_TIME_ZONE,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const dayPeriod = values.dayPeriod === "PM" || values.dayPeriod === "오후" ? "오후" : "오전";

  return `${values.year}. ${values.month}. ${values.day}. ${dayPeriod} ${values.hour}:${values.minute}`;
}
