import "server-only";
import { clientKey } from "./loginGuard";
import { getStore } from "./db/store";

/**
 * Simple fixed-window rate limit kept in the auth_attempts table, so it holds across
 * server instances. Used to stop anyone with a trip link flooding photo uploads.
 * Fails open (allows) if the table is missing, so the app keeps working.
 */
export async function allowRequest(req: Request, bucket: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const store = getStore();
  const keys = [`${bucket}:${clientKey(req)}`];
  try {
    for (const id of keys) {
      const [row] = await store.select<{ id: string; failures: number; window_start: string }>("auth_attempts", { id });
      const fresh = !row || now - Date.parse(row.window_start) > windowMs;
      const count = fresh ? 1 : row.failures + 1;
      if (!fresh && row.failures >= max) return false;
      const patch = { failures: count, window_start: fresh ? new Date(now).toISOString() : row!.window_start, locked_until: null };
      if (row) await store.update("auth_attempts", id, patch);
      else await store.insert("auth_attempts", [{ id, ...patch }]);
    }
    return true;
  } catch (e) {
    console.warn("[rate-limit] unavailable:", (e as Error).message);
    return true;
  }
}
