import { getStore } from "@/lib/db/store";
import { json, publicRoute, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { deleteTrip, getTripBundle, updateTrip } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json({ ...(await getTripBundle(id)), storage: getStore().kind });
});

export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json(await updateTrip(id, await readJson(req)));
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteTrip(id);
  return json({ ok: true });
});
