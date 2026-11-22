import { describe, expect, it } from "vitest";
import type { GuideWeather } from "@/lib/types";
import { weatherCategory, weatherForDay, weatherLabel, type LiveWeather } from "@/lib/weather";

const est: GuideWeather = {
  title: "Estimate",
  dates: ["2026-12-12", "2026-12-13"],
  places: [{ name: "仙台", lat: 38.26, lon: 140.88, days: [{ hi: 7, lo: -1, text: "Sunny" }, { hi: 6, lo: 0, text: "Snow/ rain" }] }],
};

describe("weather for a day", () => {
  it("uses the planner's estimate when no live data exists", () => {
    expect(weatherForDay(est, null, "2026-12-12", ["仙台"])).toEqual([
      { place: "仙台", kind: "estimate", hi: 7, lo: -1, text: "Sunny", code: null, pop: null },
    ]);
  });

  it("prefers a live forecast for today and later, with rain chance", () => {
    const live: LiveWeather = { today: "2026-12-12", available: true, byPlace: { 仙台: { "2026-12-13": { date: "2026-12-13", hi: 4, lo: -2, code: 73, pop: 80 } } } };
    expect(weatherForDay(est, live, "2026-12-13", ["仙台"])[0]).toMatchObject({ kind: "forecast", hi: 4, lo: -2, text: "Snow", pop: 80 });
  });

  it("labels past days as actual (recorded) weather", () => {
    const live: LiveWeather = { today: "2026-12-14", available: true, byPlace: { 仙台: { "2026-12-12": { date: "2026-12-12", hi: 8, lo: 0, code: 0, pop: 0 } } } };
    expect(weatherForDay(est, live, "2026-12-12", ["仙台"])[0]).toMatchObject({ kind: "actual", hi: 8, text: "Clear", pop: null });
  });

  it("skips places with neither live data nor an estimate", () => {
    expect(weatherForDay(est, null, "2026-12-12", ["東京"])).toEqual([]);
  });

  it("maps codes and estimate text to icon categories", () => {
    expect(weatherLabel(61)).toBe("Rain");
    expect(weatherCategory(2)).toBe("partly");
    expect(weatherCategory(null, "Light snow")).toBe("snow");
    expect(weatherCategory(null, "Sun w/ clouds")).toBe("partly");
  });
});
