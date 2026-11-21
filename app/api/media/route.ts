import { errorJson, json, publicRoute } from "@/lib/http";
import { MAX_MEDIA_BYTES, uploadMedia } from "@/lib/repo";
import { uuid, uuidOrNull } from "@/lib/validation";

export const runtime = "nodejs";

/** Detect the real image type from magic bytes rather than trusting the browser. */
function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Upload a trip photo or a traveller avatar. Open to anyone with the trip link (like the
 * read-only view), but limited to real JPEG/PNG/WebP images under 1.5 MB. Only the
 * Treasurer can delete.
 */
export const POST = publicRoute(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return errorJson("Attach an image as 'file'", 400);
  if (file.size > MAX_MEDIA_BYTES) return errorJson("Image is too large (max 1.5 MB after compression)", 413);
  const data = Buffer.from(await file.arrayBuffer());
  const mime = sniff(data);
  if (!mime) return errorJson("Only JPEG, PNG or WebP images are allowed", 415);

  const kind = form.get("kind") === "avatar" ? "avatar" : "photo";
  const int = (k: string) => {
    const x = Number(form.get(k));
    return Number.isFinite(x) && x > 0 && x < 20000 ? Math.round(x) : null;
  };
  const text = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);

  const item = await uploadMedia({
    trip_id: uuid(form.get("trip_id"), "trip_id"),
    kind,
    participant_id: uuidOrNull(form.get("participant_id"), "participant_id"),
    mime,
    data,
    width: int("width"),
    height: int("height"),
    caption: text("caption", 200),
    uploaded_by: text("uploaded_by", 80),
  });
  return json(item, 201);
});
