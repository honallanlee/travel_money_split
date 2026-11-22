import { checkPassword, createSessionToken, isTreasurer, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { errorJson, json, publicRoute, readJson } from "@/lib/http";
import { lockedFor, recordFailure, recordSuccess } from "@/lib/loginGuard";

export const GET = publicRoute(async () => {
  return json({ unlocked: await isTreasurer(), configured: Boolean(process.env.ADMIN_PASSWORD) });
});

const lockedResponse = (seconds: number) => {
  const res = errorJson("Too many wrong passwords — try again in 15 minutes", 429);
  res.headers.set("Retry-After", String(seconds));
  return res;
};

export const POST = publicRoute(async (req: Request) => {
  if (!process.env.ADMIN_PASSWORD) return errorJson("ADMIN_PASSWORD is not configured on the server", 500);
  const wait = await lockedFor(req);
  if (wait > 0) return lockedResponse(wait);
  const body = (await readJson(req)) as { password?: unknown };
  if (!checkPassword(body?.password)) {
    await recordFailure(req);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    const nowLocked = await lockedFor(req);
    return nowLocked > 0 ? lockedResponse(nowLocked) : errorJson("Incorrect password", 401);
  }
  await recordSuccess(req);
  const res = json({ unlocked: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  return res;
});

export const DELETE = publicRoute(async () => {
  const res = json({ unlocked: false });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
});
