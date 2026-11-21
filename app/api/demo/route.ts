import { isTreasurer } from "@/lib/auth";
import { errorJson, json, publicRoute } from "@/lib/http";
import { listTrips, loadDemoTrip } from "@/lib/repo";

/** Seeds a demo trip. Allowed without login only while the database is empty. */
export const POST = publicRoute(async () => {
  const existing = await listTrips();
  if (existing.length > 0 && !(await isTreasurer())) {
    return errorJson("Demo data can only be loaded into an empty database (or in Treasurer Mode)", 403);
  }
  return json(await loadDemoTrip(), 201);
});
