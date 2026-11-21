import { getStore } from "@/lib/db/store";
import { json, publicRoute, readJson, treasurerRoute } from "@/lib/http";
import { createTrip, listTrips } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async () => {
  return json({ trips: await listTrips(), storage: getStore().kind });
});

export const POST = treasurerRoute(async (req: Request) => {
  return json(await createTrip(await readJson(req)), 201);
});
