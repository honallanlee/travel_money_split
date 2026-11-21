import { json, readJson, treasurerRoute } from "@/lib/http";
import { createParticipant } from "@/lib/repo";

export const POST = treasurerRoute(async (req: Request) => {
  return json(await createParticipant(await readJson(req)), 201);
});
