import { getStore } from "@/lib/db/store";
import { errorJson, json, publicRoute } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Daily ping (Vercel Cron, see vercel.json) so a free Supabase project sees activity and
 * isn't paused after ~7 idle days. Runs one tiny read; returns no trip data.
 * If CRON_SECRET is set in Vercel, only Vercel's cron (which sends it) can call this.
 */
export const GET = publicRoute(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return errorJson("Unauthorized", 401);
  const store = getStore();
  const rows = await store.select<{ id: string }>("trips", {}, "id");
  // Housekeeping: drop login/upload counters older than a day so the table can't grow without limit.
  let cleared = 0;
  try {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    const stale = (await store.select<{ id: string; window_start: string; locked_until: string | null }>("auth_attempts", {}, "id,window_start,locked_until")).filter(
      (r) => Date.parse(r.window_start) < cutoff && (!r.locked_until || Date.parse(r.locked_until) < Date.now()),
    );
    for (let i = 0; i < stale.length; i += 200) await store.remove("auth_attempts", { id: stale.slice(i, i + 200).map((r) => r.id) });
    cleared = stale.length;
  } catch {}
  return json({ ok: true, storage: store.kind, trips: rows.length, cleared, at: new Date().toISOString() });
});
