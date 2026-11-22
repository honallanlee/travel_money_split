import "server-only";
import { createHash } from "node:crypto";
import { getStore } from "./db/store";

/**
 * Treasurer login lockout, kept in the database so it holds across Vercel instances
 * (in-memory counters reset on every cold start and differ per instance).
 *
 *  - per device (hashed IP): 5 wrong passwords within 15 min → locked for 15 min
 *  - whole site:            50 wrong passwords within 1 hour → locked for 10 min
 *
 * Raw IP addresses are never stored, only a salted hash. If the table is missing
 * (schema not re-run yet), login still works and a warning is logged.
 */
export const PER_IP = { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
export const GLOBAL = { max: 50, windowMs: 60 * 60_000, lockMs: 10 * 60_000 };

interface AttemptRow {
  id: string;
  failures: number;
  window_start: string;
  locked_until: string | null;
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "unknown";
  const salt = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
  return "ip:" + createHash("sha256").update(`login-guard:${salt}:${ip}`).digest("hex").slice(0, 32);
}

const GLOBAL_KEY = "global";

async function read(id: string): Promise<AttemptRow | null> {
  const [row] = await getStore().select<AttemptRow>("auth_attempts", { id });
  return row ?? null;
}

/** Seconds until login is allowed again for this request, or 0 if not locked. */
export async function lockedFor(req: Request, now = Date.now()): Promise<number> {
  try {
    const rows = await Promise.all([read(clientKey(req)), read(GLOBAL_KEY)]);
    const until = Math.max(0, ...rows.map((r) => (r?.locked_until ? Date.parse(r.locked_until) : 0)));
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  } catch (e) {
    console.warn("[login-guard] lockout unavailable (run supabase/schema.sql):", (e as Error).message);
    return 0;
  }
}

/** Pure counter step, exported for tests. */
export function nextState(
  row: Pick<AttemptRow, "failures" | "window_start" | "locked_until"> | null,
  rule: { max: number; windowMs: number; lockMs: number },
  now: number,
): Pick<AttemptRow, "failures" | "window_start" | "locked_until"> {
  const fresh = !row || now - Date.parse(row.window_start) > rule.windowMs;
  const failures = fresh ? 1 : row!.failures + 1;
  const window_start = fresh ? new Date(now).toISOString() : row!.window_start;
  const locked_until = failures >= rule.max ? new Date(now + rule.lockMs).toISOString() : fresh ? null : row!.locked_until;
  // After a lock is applied the window restarts, so the next lock needs another full set of failures.
  return failures >= rule.max ? { failures: 0, window_start: new Date(now).toISOString(), locked_until } : { failures, window_start, locked_until };
}

async function bump(id: string, rule: typeof PER_IP, now: number) {
  const store = getStore();
  const row = await read(id);
  const next = nextState(row, rule, now);
  if (row) await store.update("auth_attempts", id, next);
  else await store.insert("auth_attempts", [{ id, ...next }]);
}

export async function recordFailure(req: Request, now = Date.now()): Promise<void> {
  try {
    await Promise.all([bump(clientKey(req), PER_IP, now), bump(GLOBAL_KEY, GLOBAL, now)]);
  } catch (e) {
    console.warn("[login-guard] could not record a failed login:", (e as Error).message);
  }
}

export async function recordSuccess(req: Request): Promise<void> {
  try {
    await getStore().remove("auth_attempts", { id: clientKey(req) });
  } catch {}
}
