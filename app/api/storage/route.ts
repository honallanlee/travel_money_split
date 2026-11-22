import { json, publicRoute } from "@/lib/http";
import { storageUsage } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** How much of the 1 GB photo storage and the 500 MB database is used (shared by all trips). */
export const GET = publicRoute(async () => json(await storageUsage()));
