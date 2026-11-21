import { GoogleGenAI, Type } from "@google/genai";
import { errorJson, json, treasurerRoute } from "@/lib/http";
import { CATEGORIES, type Category, type OcrResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

const schema = {
  type: Type.OBJECT,
  properties: {
    merchant: { type: Type.STRING },
    date: { type: Type.STRING, description: "YYYY-MM-DD" },
    currency: { type: Type.STRING, description: "3-letter ISO 4217 code" },
    total: { type: Type.NUMBER, description: "Grand total actually paid, including tax/tip" },
    category: { type: Type.STRING, enum: [...CATEGORIES] },
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { description: { type: Type.STRING }, amount: { type: Type.NUMBER } },
        required: ["description", "amount"],
      },
    },
  },
  required: ["merchant", "date", "currency", "total", "category", "line_items"],
};

const PROMPT = `You are a receipt parser for a group travel expense app.
Extract the merchant name, purchase date (YYYY-MM-DD), ISO currency code, grand total paid,
best-fit category, and each purchased line item with its line total (quantity × unit price).
Do not include subtotal, tax, tip, service or change rows as line items.
If the currency symbol is ambiguous, infer it from the country/language of the receipt.
If a field is unreadable, use an empty string or 0.`;

async function readImage(req: Request): Promise<{ data: string; mimeType: string }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") ?? form.get("image");
    if (!(file instanceof File)) throw Object.assign(new Error("Attach an image as 'file'"), { status: 400 });
    if (!ALLOWED.includes(file.type)) throw Object.assign(new Error("Use a JPEG, PNG or WebP image"), { status: 415 });
    if (file.size > MAX_BYTES) throw Object.assign(new Error("Image is larger than 8 MB"), { status: 413 });
    return { data: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type };
  }
  const body = (await req.json().catch(() => null)) as { image?: string; mimeType?: string } | null;
  let data = body?.image ?? "";
  let mimeType = body?.mimeType ?? "";
  const m = /^data:([^;]+);base64,(.*)$/.exec(data);
  if (m) [mimeType, data] = [m[1], m[2]];
  if (!data) throw Object.assign(new Error("Provide multipart 'file' or JSON { image: base64 }"), { status: 400 });
  if (!ALLOWED.includes(mimeType)) throw Object.assign(new Error("Use a JPEG, PNG or WebP image"), { status: 415 });
  if (data.length * 0.75 > MAX_BYTES) throw Object.assign(new Error("Image is larger than 8 MB"), { status: 413 });
  return { data, mimeType };
}

function normalise(raw: Record<string, unknown>): OcrResult {
  const num = (x: unknown) => {
    const n = typeof x === "string" ? Number(x.replace(/[^0-9.-]/g, "")) : Number(x);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const cur = String(raw.currency ?? "").toUpperCase().trim();
  const cat = CATEGORIES.includes(raw.category as Category) ? (raw.category as Category) : "Other";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date)) ? String(raw.date) : "";
  const items = Array.isArray(raw.line_items) ? raw.line_items : [];
  return {
    merchant: String(raw.merchant ?? "").trim().slice(0, 120),
    date,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : "",
    total: num(raw.total),
    category: cat,
    line_items: items
      .map((it) => ({ description: String(it?.description ?? "").trim().slice(0, 200), amount: num(it?.amount) }))
      .filter((it) => it.description || it.amount)
      .slice(0, 100),
  };
}

/**
 * Tried in order. Flash-Lite reads receipts accurately in ~1–2 s; the full Flash models were
 * benchmarked at 60 s+ or "high demand" (503), which would exceed Vercel's 60 s limit.
 */
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 50_000;
/** Errors where another model may succeed: not found/retired, overloaded, or timed out. */
const RETRYABLE = new Set([404, 408, 500, 503, 504]);

function geminiStatus(e: unknown): number | undefined {
  if ((e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError") return 408;
  const s = (e as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  const m = /"code"\s*:\s*(\d{3})/.exec(String((e as Error)?.message ?? ""));
  return m ? Number(m[1]) : undefined;
}

/** Turn Gemini SDK errors into short, user-readable messages (never raw JSON). */
function geminiError(e: unknown) {
  const status = geminiStatus(e);
  const msg = String((e as Error)?.message ?? "");
  console.error("[ocr] Gemini error", status, msg.slice(0, 500));
  if (status === 429) return errorJson("Receipt scanning is busy (Gemini rate limit) — wait a minute and try again", 429);
  if (status === 400 && /api key/i.test(msg)) return errorJson("Gemini rejected the API key — check GEMINI_API_KEY", 502);
  if (status === 401 || status === 403) return errorJson("Gemini rejected the API key — check GEMINI_API_KEY", 502);
  if (status === 404) return errorJson("No supported Gemini model is available for this API key — set GEMINI_MODEL", 502);
  if (status === 408 || status === 503 || status === 504)
    return errorJson("Gemini is overloaded or slow right now — try again in a moment, or enter the details by hand", 503);
  return errorJson("Receipt scanning failed — try again or enter the details by hand", 502);
}

export const POST = treasurerRoute(async (req: Request) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) return errorJson("Receipt scanning isn't configured (GEMINI_API_KEY missing)", 501);

  const image = await readImage(req);
  const ai = new GoogleGenAI({ apiKey });

  // Google retires model versions for new keys and some models get overloaded, so try the
  // configured model first, then fallbacks — each with its own timeout, within ~50 s overall.
  const models = [...new Set([process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  const started = Date.now();
  let res: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastErr: unknown = null;
  for (const model of models) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 3000) break;
    try {
      res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: image }, { text: PROMPT }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
          abortSignal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
        },
      });
      break;
    } catch (e) {
      lastErr = e;
      const status = geminiStatus(e);
      if (status !== undefined && !RETRYABLE.has(status)) break; // e.g. bad key or rate limit: another model won't help
      console.warn(`[ocr] ${model} failed (${status ?? "timeout"}), trying next model`);
    }
  }
  if (!res) return geminiError(lastErr);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.text ?? "{}");
  } catch {
    return errorJson("Couldn't read that receipt — try a clearer photo", 422);
  }
  return json(normalise(parsed));
});
