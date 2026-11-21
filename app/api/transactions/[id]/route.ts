import { json, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { updateTransaction, deleteTransaction } from "@/lib/repo";

export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json(await updateTransaction(id, await readJson(req)));
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteTransaction(id);
  return json({ ok: true });
});
