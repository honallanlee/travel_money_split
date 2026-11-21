import { json, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { updateMiniGroup, deleteMiniGroup } from "@/lib/repo";

export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json(await updateMiniGroup(id, await readJson(req)));
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteMiniGroup(id);
  return json({ ok: true });
});
