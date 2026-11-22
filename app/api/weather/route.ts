import { errorJson, json, publicRoute } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Daily weather for one or more places from Open-Meteo (free, no key).
 *   GET /api/weather?lat=38.26,35.69&lon=140.88,139.70&start=2026-12-12&end=2026-12-21&tz=Asia/Tokyo
 * Days before today are recorded weather; today and later are forecasts. Open-Meteo only covers
 * roughly the last 3 months to 15 days ahead, so dates outside that come back empty and the app
 * falls back to the planner's estimate. Only coordinates are sent to Open-Meteo. Cached 1 hour.
 */
type Day = { date: string; hi: number | null; lo: number | null; code: number | null; pop: number | null };
const TTL = 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function todayIn(tz: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const GET = publicRoute(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const lats = (q.get("lat") ?? "").split(",").map(Number);
  const lons = (q.get("lon") ?? "").split(",").map(Number);
  const start = q.get("start");
  const end = q.get("end");
  const tz = q.get("tz") || "Asia/Tokyo";
  if (!lats.length || lats.length !== lons.length || lats.length > 20) return errorJson("lat/lon lists must match (max 20)", 400);
  if (lats.some((v) => !Number.isFinite(v) || Math.abs(v) > 90) || lons.some((v) => !Number.isFinite(v) || Math.abs(v) > 180))
    return errorJson("Invalid coordinates", 400);
  if (!isDate(start) || !isDate(end) || start > end) return errorJson("start/end must be YYYY-MM-DD", 400);
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(tz)) return errorJson("Invalid time zone", 400);

  const today = todayIn(tz);
  const empty = { today, available: false, places: lats.map(() => ({ days: [] as Day[] })) };
  // Open-Meteo's allowed window: about 90 days back to 15 days ahead.
  const from = start > shift(today, -90) ? start : shift(today, -90);
  const to = end < shift(today, 15) ? end : shift(today, 15);
  if (from > to) return json(empty);

  const key = `${lats.join(",")}|${lons.join(",")}|${from}|${to}|${tz}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json(hit.data);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats.map((v) => v.toFixed(4)).join(",")}` +
    `&longitude=${lons.map((v) => v.toFixed(4)).join(",")}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=${encodeURIComponent(tz)}&start_date=${from}&end_date=${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res || !res.ok) {
    if (hit) return json(hit.data); // stale beats nothing
    return json(empty);
  }
  const raw = await res.json();
  const list = (Array.isArray(raw) ? raw : [raw]) as {
    daily?: { time: string[]; weather_code: (number | null)[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_probability_max?: (number | null)[] };
  }[];
  const round = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n) : null);
  const data = {
    today,
    available: true,
    source: "Open-Meteo",
    places: list.map((p) => ({
      days: (p.daily?.time ?? []).map((date, i) => ({
        date,
        hi: round(p.daily!.temperature_2m_max[i]),
        lo: round(p.daily!.temperature_2m_min[i]),
        code: p.daily!.weather_code[i] ?? null,
        pop: p.daily!.precipitation_probability_max?.[i] ?? null,
      })),
    })),
  };
  cache.set(key, { at: Date.now(), data });
  return json(data);
});
