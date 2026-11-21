import { errorJson, json, publicRoute } from "@/lib/http";

/**
 * Live reference exchange rates for converting the trip's base currency into a viewer's
 * preferred display currency. Primary source: ECB rates via frankfurter.dev (no key);
 * fallback: open.er-api.com (wider currency coverage). Cached in memory for 6 hours.
 */
type Rates = { base: string; date: string; source: string; rates: Record<string, number> };
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: Rates }>();

async function fromFrankfurter(base: string): Promise<Rates> {
  const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`frankfurter ${r.status}`);
  const d = (await r.json()) as { date: string; rates: Record<string, number> };
  return { base, date: d.date, source: "European Central Bank (frankfurter.dev)", rates: { ...d.rates, [base]: 1 } };
}

async function fromErApi(base: string): Promise<Rates> {
  const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(6000) });
  const d = (await r.json()) as { result: string; time_last_update_utc: string; rates: Record<string, number> };
  if (!r.ok || d.result !== "success") throw new Error("open.er-api failed");
  return { base, date: new Date(d.time_last_update_utc).toISOString().slice(0, 10), source: "ExchangeRate-API (open.er-api.com)", rates: d.rates };
}

export const GET = publicRoute(async (req: Request) => {
  const base = (new URL(req.url).searchParams.get("base") ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) return errorJson("base must be a 3-letter currency code", 400);

  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL) return json(hit.data);

  let data: Rates | null = null;
  const fra = await fromFrankfurter(base).catch(() => null);
  const era = await fromErApi(base).catch(() => null);
  if (fra || era) {
    // Prefer ECB rates; fill currencies the ECB doesn't publish (e.g. TWD) from the fallback.
    data = fra ? { ...fra, rates: { ...(era?.rates ?? {}), ...fra.rates } } : era;
  }
  if (!data) {
    if (hit) return json(hit.data); // stale is better than nothing
    return errorJson("Exchange rates are unavailable right now — enter a rate manually", 502);
  }
  cache.set(base, { at: Date.now(), data });
  return json(data);
});
