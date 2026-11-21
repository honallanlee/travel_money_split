import { json, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { updateParticipant, deleteParticipant } from "@/lib/repo";

export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json(await updateParticipant(id, await readJson(req)));
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteParticipant(id);
  return json({ ok: true });
});
