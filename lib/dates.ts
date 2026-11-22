/**
 * Today's date (YYYY-MM-DD) in a given IANA time zone, e.g. "Asia/Tokyo".
 * Without a zone, the device's own local date is used, never the UTC date:
 * before 9am in Japan the UTC date is still yesterday.
 */
export function todayIn(tz?: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }
}
