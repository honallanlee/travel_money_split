import { json, readJson, treasurerRoute } from "@/lib/http";
import { createBudget } from "@/lib/repo";

export const POST = treasurerRoute(async (req: Request) => {
  return json(await createBudget(await readJson(req)), 201);
});
