import "server-only";
import { NextResponse } from "next/server";
import { isTreasurer } from "./auth";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const errorJson = (message: string, status: number) => json({ error: message }, status);

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

function toResponse(e: unknown) {
  const status = (e as { status?: number })?.status;
  if (status && status >= 400 && status < 500) return errorJson((e as Error).message, status);
  const msg = (e as Error)?.message ?? "";
  if (/schema cache|PGRST205|relation .* does not exist/i.test(msg)) {
    return errorJson("Database tables not found — run supabase/schema.sql in the Supabase SQL Editor", 503);
  }
  console.error(e);
  return errorJson("Something went wrong", 500);
}

/** Wrap a public (read-only) handler with error handling. */
export function publicRoute<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Wrap a mutating handler: rejects unless a valid Treasurer session cookie is present. */
export function treasurerRoute<C>(fn: Handler<C>): Handler<C> {
  return publicRoute(async (req, ctx) => {
    if (!(await isTreasurer())) return errorJson("Treasurer Mode required", 401);
    return fn(req, ctx);
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    const e = new Error("Invalid JSON body") as Error & { status: number };
    e.status = 400;
    throw e;
  }
}

export type IdCtx = { params: Promise<{ id: string }> };
