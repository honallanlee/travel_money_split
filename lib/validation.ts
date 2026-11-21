import { CATEGORIES, TX_TYPES, type LineItem, type TxType } from "./types";

export class ValidationError extends Error {
  status = 400;
}

const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

export function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Expected a JSON object");
  return v as Record<string, unknown>;
}

export function str(v: unknown, field: string, opts: { max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    fail(`${field} is required`);
  }
  if (typeof v !== "string") fail(`${field} must be a string`);
  const s = (v as string).trim();
  if (!s && !opts.optional) fail(`${field} is required`);
  if (s.length > (opts.max ?? 200)) fail(`${field} is too long`);
  return s;
}

export function num(v: unknown, field: string, opts: { min?: number; max?: number; positive?: boolean } = {}): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) fail(`${field} must be a number`);
  const x = n as number;
  if (opts.positive && x <= 0) fail(`${field} must be greater than 0`);
  if (opts.min !== undefined && x < opts.min) fail(`${field} must be ≥ ${opts.min}`);
  if (opts.max !== undefined && x > opts.max) fail(`${field} is too large`);
  return x;
}

export function uuidOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) fail(`${field} must be an id`);
  return v as string;
}

export function uuid(v: unknown, field: string): string {
  const id = uuidOrNull(v, field);
  if (!id) fail(`${field} is required`);
  return id as string;
}

export function currency(v: unknown, field = "currency"): string {
  const c = str(v, field, { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) fail(`${field} must be a 3-letter ISO code`);
  return c;
}

export function txType(v: unknown): TxType {
  if (!TX_TYPES.includes(v as TxType)) fail("type must be CASH_DEPOSIT, CASH_EXPENSE or CARD_EXPENSE");
  return v as TxType;
}

export function category(v: unknown): string {
  const c = str(v ?? "Other", "category", { max: 60 });
  return c;
}

export function isoDate(v: unknown, field: string): string {
  if (v === undefined || v === null || v === "") return new Date().toISOString();
  if (typeof v !== "string") fail(`${field} must be a date`);
  const s = v as string;
  // Accept plain YYYY-MM-DD (stored at midday UTC so it doesn't shift days across timezones)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) fail(`${field} is not a valid date`);
  return d.toISOString();
}

export function lineItems(v: unknown): LineItem[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) fail("line_items must be an array");
  const arr = v as unknown[];
  if (arr.length > 200) fail("Too many line items");
  return arr.map((raw, i) => {
    const o = obj(raw);
    const assignees = Array.isArray(o.assignees) ? o.assignees.map((a) => uuid(a, `line_items[${i}].assignees`)) : [];
    return {
      description: str(o.description, `line_items[${i}].description`, { max: 200, optional: true }) || `Item ${i + 1}`,
      amount: num(o.amount, `line_items[${i}].amount`, { min: -1e7, max: 1e7 }),
      assignees,
    };
  });
}

export { CATEGORIES };
