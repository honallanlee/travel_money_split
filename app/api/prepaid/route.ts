import { json, readJson, treasurerRoute } from "@/lib/http";
import { createPrepaid } from "@/lib/repo";

/** Add a cost settled outside the app (hotel, flight…) or one still to pay. */
export const POST = treasurerRoute(async (req: Request) => {
  return json(await createPrepaid(await readJson(req)), 201);
});
