import type { DeadlinePolicy } from "../validators/challenge.schema.js";

export const SYSTEM_TIME_ZONE = "Asia/Seoul";

export function parseDeadlineDateInput(input: string): Date {
  const value = input.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:00+09:00`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}:00+09:00`
      : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("마감일 형식이 올바르지 않습니다. YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 형식을 사용하세요.");
  }
  return parsed;
}

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
