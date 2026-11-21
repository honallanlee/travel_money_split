import { checkPassword, createSessionToken, isTreasurer, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { errorJson, json, publicRoute, readJson } from "@/lib/http";

export const GET = publicRoute(async () => {
  return json({ unlocked: await isTreasurer(), configured: Boolean(process.env.ADMIN_PASSWORD) });
});

export const POST = publicRoute(async (req: Request) => {
  if (!process.env.ADMIN_PASSWORD) return errorJson("ADMIN_PASSWORD is not configured on the server", 500);
  const body = (await readJson(req)) as { password?: unknown };
  if (!checkPassword(body?.password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return errorJson("Incorrect password", 401);
  }
  const res = json({ unlocked: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  return res;
});

export const DELETE = publicRoute(async () => {
  const res = json({ unlocked: false });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
});
