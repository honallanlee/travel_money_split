import { json, readJson, treasurerRoute } from "@/lib/http";
import { importTrip } from "@/lib/repo";

export const maxDuration = 60;

/** Restore a backup file as a new trip (Treasurer only). */
export const POST = treasurerRoute(async (req: Request) => {
  return json(await importTrip(await readJson(req)), 201);
});
