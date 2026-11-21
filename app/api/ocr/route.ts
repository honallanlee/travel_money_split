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

export const POST = treasurerRoute(async (req: Request) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) return errorJson("Receipt scanning isn't configured (GEMINI_API_KEY missing)", 501);

  const image = await readImage(req);
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: image }, { text: PROMPT }] }],
    config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.text ?? "{}");
  } catch {
    return errorJson("Couldn't read that receipt — try a clearer photo", 422);
  }
  return json(normalise(parsed));
});
