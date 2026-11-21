import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "treasurer_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Session tokens are `<expiryMs>.<hmac>`; the HMAC key is derived from ADMIN_PASSWORD
 * (or SESSION_SECRET if set), so changing the password invalidates every session.
 */
function key(): string | null {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  return s ? `treasurer-session:v1:${s}` : null;
}

function sign(payload: string, k: string) {
  return createHmac("sha256", k).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: unknown): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || typeof input !== "string") return false;
  return safeEqual(input, pw);
}

export function createSessionToken(): string {
  const k = key();
  if (!k) throw new Error("ADMIN_PASSWORD is not configured");
  const exp = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${exp}.${sign(exp, k)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  const k = key();
  if (!k || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp, k));
}

export async function isTreasurer(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  // Secure in production; browsers like Safari drop Secure cookies on http://localhost.
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
