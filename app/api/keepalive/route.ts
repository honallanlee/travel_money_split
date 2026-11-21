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
  return json({ ok: true, storage: store.kind, trips: rows.length, at: new Date().toISOString() });
});
