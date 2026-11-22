import { isTreasurer } from "@/lib/auth";
import { json, publicRoute, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { deleteTripGuide, getTripGuide, saveTripGuide } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Read-only trip guide. Booking references are included only in Treasurer Mode. */
export const GET = publicRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json({ guide: await getTripGuide(id, await isTreasurer()) });
});

/** Replace the guide (Treasurer only; used by the in-app editor). The previous version is kept. */
export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await saveTripGuide(id, await readJson(req));
  return json({ ok: true });
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteTripGuide(id);
  return json({ ok: true });
});
