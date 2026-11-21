import { json, readJson, treasurerRoute } from "@/lib/http";
import { createTransaction } from "@/lib/repo";

export const POST = treasurerRoute(async (req: Request) => {
  return json(await createTransaction(await readJson(req)), 201);
});
