import { errorJson, json, publicRoute, readJson, treasurerRoute, type IdCtx } from "@/lib/http";
import { deleteMedia, getMedia, updateMedia } from "@/lib/repo";

export const runtime = "nodejs";

export const GET = publicRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson("Not found", 404);
  const m = await getMedia(id);
  if (!m) return errorJson("Not found", 404);
  return new Response(new Uint8Array(m.data), {
    headers: {
      "Content-Type": m.mime,
      // ids are never reused, so the bytes behind a URL never change
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});

export const PUT = treasurerRoute(async (req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await updateMedia(id, await readJson(req));
  return json({ ok: true });
});

export const DELETE = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  await deleteMedia(id);
  return json({ ok: true });
});
