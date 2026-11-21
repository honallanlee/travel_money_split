import { json, readJson, treasurerRoute } from "@/lib/http";
import { createSplitPayment } from "@/lib/repo";

/** One bill paid partly from the kitty and partly by card (saved as two linked expenses). */
export const POST = treasurerRoute(async (req: Request) => {
  return json(await createSplitPayment(await readJson(req)), 201);
});
