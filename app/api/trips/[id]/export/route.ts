import { json, publicRoute, type IdCtx } from "@/lib/http";
import { exportTrip } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Full JSON backup of a trip (same data the public read-only view shows). */
export const GET = publicRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  return json(await exportTrip(id));
});
