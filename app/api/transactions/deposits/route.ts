import { json, readJson, treasurerRoute } from "@/lib/http";
import { createGroupDeposits } from "@/lib/repo";

/** Everyone deposits the same amount into the kitty (one deposit per person). */
export const POST = treasurerRoute(async (req: Request) => {
  return json(await createGroupDeposits(await readJson(req)), 201);
});
