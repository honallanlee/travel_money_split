import type { GuideWeather } from "./types";

/** One day of live weather for a place, as returned by /api/weather. */
export interface LiveDay {
  date: string;
  hi: number | null;
  lo: number | null;
  code: number | null;
  /** max chance of precipitation, % */
  pop: number | null;
}

export interface LiveWeather {
  today: string;
  available: boolean;
  /** place name → date → day */
  byPlace: Record<string, Record<string, LiveDay>>;
}

export type WeatherKind = "actual" | "forecast" | "estimate";

export interface DayWeather {
  place: string;
  kind: WeatherKind;
  hi: number | null;
  lo: number | null;
  /** English label (translated in the UI) */
  text: string;
  code: number | null;
  pop: number | null;
}

/** WMO weather codes (used by Open-Meteo) → short English labels. */
export function weatherLabel(code: number | null): string {
  if (code === null) return "";
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return code === 66 || code === 67 ? "Freezing rain" : "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 95) return "Thunderstorm";
  return "";
}

/** Rough category for picking an icon. */
export function weatherCategory(code: number | null, text = ""): "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" {
  if (code !== null) {
    if (code <= 1) return "sun";
    if (code === 2) return "partly";
    if (code === 3) return "cloud";
    if (code === 45 || code === 48) return "fog";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "rain";
  }
  const t = text.toLowerCase();
  if (t.includes("snow")) return "snow";
  if (t.includes("rain")) return "rain";
  if (t.includes("sun w/ clouds") || t.includes("sun/ clouds") || t.includes("clouds & sun") || t.includes("clouds w/ sun")) return "partly";
  if (t.includes("sun")) return "sun";
  if (t.includes("cloud")) return "cloud";
  return "partly";
}

/**
 * Weather to show for a day: recorded weather once the day has passed, a live forecast when
 * one exists, otherwise the planner's estimate from the guide.
 */
export function weatherForDay(guideWeather: GuideWeather | undefined, live: LiveWeather | null, date: string, places: string[]): DayWeather[] {
  const col = guideWeather?.dates.indexOf(date) ?? -1;
  const out: DayWeather[] = [];
  for (const place of places) {
    const l = live?.byPlace[place]?.[date];
    if (l && (l.hi !== null || l.lo !== null)) {
      out.push({
        place,
        kind: live && date < live.today ? "actual" : "forecast",
        hi: l.hi,
        lo: l.lo,
        text: weatherLabel(l.code),
        code: l.code,
        pop: live && date < live.today ? null : l.pop,
      });
      continue;
    }
    const est = col >= 0 ? guideWeather?.places.find((p) => p.name === place)?.days[col] : undefined;
    if (est) out.push({ place, kind: "estimate", hi: est.hi, lo: est.lo, text: est.text, code: null, pop: null });
  }
  return out;
}
