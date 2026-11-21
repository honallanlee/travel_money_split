import { json, readJson, treasurerRoute } from "@/lib/http";
import { createMiniGroup } from "@/lib/repo";

export const POST = treasurerRoute(async (req: Request) => {
  return json(await createMiniGroup(await readJson(req)), 201);
});
