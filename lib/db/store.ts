import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export type Table =
  | "trips"
  | "mini_groups"
  | "participants"
  | "transactions"
  | "transaction_splits"
  | "budget_items"
  | "media"
  | "trip_guides"
  | "trip_guide_versions"
  | "prepaid_items"
  | "auth_attempts";
type Row = Record<string, unknown> & { id: string };
/** Equality filter; an array value means `IN (...)`. */
export type Where = Record<string, string | string[]>;

/** Private bucket for trip photos (Supabase Storage); avatars stay in the database. */
export const PHOTO_BUCKET = "trip-photos";

export interface Store {
  readonly kind: "supabase" | "memory";
  /** File storage (trip photos). Paths look like "<tripId>/<mediaId>.jpg". */
  putObject(path: string, data: Buffer, contentType: string): Promise<void>;
  getObject(path: string): Promise<Buffer | null>;
  removeObjects(paths: string[]): Promise<void>;
  /** Database size in bytes, or null if unknown (needs the db_size_bytes() function from schema.sql). */
  databaseSize(): Promise<number | null>;
  /** `columns` is a comma-separated list (default all) — used to skip heavy image data. */
  select<T>(table: Table, where?: Where, columns?: string): Promise<T[]>;
  insert<T>(table: Table, rows: Record<string, unknown>[]): Promise<T[]>;
  update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T | null>;
  remove(table: Table, where: Where): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supabase (service role, server-side only — bypasses RLS)
// ---------------------------------------------------------------------------

class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private client: SupabaseClient<any, any, any>) {}

  // Untyped on purpose: supabase-js's generic filter builders blow up TS inference here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private apply(q: any, where: Where): any {
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
    return q;
  }

  async select<T>(table: Table, where: Where = {}, columns = "*"): Promise<T[]> {
    if (Object.values(where).some((v) => Array.isArray(v) && v.length === 0)) return [];
    const { data, error } = await this.apply(this.client.from(table).select(columns), where);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async insert<T>(table: Table, rows: Record<string, unknown>[]): Promise<T[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.client.from(table).insert(rows).select(table === "media" ? "id" : "*");
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T | null> {
    const { data, error } = await this.client.from(table).update(patch).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T) ?? null;
  }

  async remove(table: Table, where: Where): Promise<void> {
    if (Object.keys(where).length === 0) throw new Error("Refusing unfiltered delete");
    if (Object.values(where).some((v) => Array.isArray(v) && v.length === 0)) return;
    const { error } = await this.apply(this.client.from(table).delete(), where);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  private bucketReady = false;
  /** Creates the private photo bucket on first use if schema.sql hasn't been re-run. */
  private async ensureBucket() {
    if (this.bucketReady) return;
    const { data } = await this.client.storage.getBucket(PHOTO_BUCKET);
    if (!data) {
      const { error } = await this.client.storage.createBucket(PHOTO_BUCKET, {
        public: false,
        fileSizeLimit: 1_500_000,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      });
      if (error && !/already exists/i.test(error.message)) throw new Error(`storage: ${error.message}`);
    }
    this.bucketReady = true;
  }

  async putObject(path: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    const { error } = await this.client.storage.from(PHOTO_BUCKET).upload(path, data, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error(`storage: ${error.message}`);
  }

  async getObject(path: string): Promise<Buffer | null> {
    const { data, error } = await this.client.storage.from(PHOTO_BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async removeObjects(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.client.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`storage: ${error.message}`);
    }
  }

  async databaseSize(): Promise<number | null> {
    const { data, error } = await this.client.rpc("db_size_bytes");
    return error || data == null ? null : Number(data);
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (local dev without Supabase). Mirrors the FK behaviour of schema.sql.
// ---------------------------------------------------------------------------

type FkRule = { table: Table; column: string; onDelete: "cascade" | "set null" };
const FKS: Record<Table, FkRule[]> = {
  trips: [
    { table: "mini_groups", column: "trip_id", onDelete: "cascade" },
    { table: "participants", column: "trip_id", onDelete: "cascade" },
    { table: "transactions", column: "trip_id", onDelete: "cascade" },
    { table: "budget_items", column: "trip_id", onDelete: "cascade" },
    { table: "media", column: "trip_id", onDelete: "cascade" },
    { table: "trip_guides", column: "trip_id", onDelete: "cascade" },
    { table: "trip_guide_versions", column: "trip_id", onDelete: "cascade" },
    { table: "prepaid_items", column: "trip_id", onDelete: "cascade" },
  ],
  mini_groups: [{ table: "participants", column: "mini_group_id", onDelete: "set null" }],
  participants: [
    { table: "transactions", column: "paid_by_participant_id", onDelete: "set null" },
    { table: "transaction_splits", column: "participant_id", onDelete: "cascade" },
    { table: "media", column: "participant_id", onDelete: "cascade" },
  ],
  transactions: [
    { table: "transaction_splits", column: "transaction_id", onDelete: "cascade" },
    { table: "prepaid_items", column: "transaction_id", onDelete: "set null" },
  ],
  transaction_splits: [],
  budget_items: [],
  media: [{ table: "participants", column: "avatar_media_id", onDelete: "set null" }],
  trip_guides: [],
  trip_guide_versions: [],
  prepaid_items: [],
  auth_attempts: [],
};

const DEFAULTS: Partial<Record<Table, () => Record<string, unknown>>> = {
  trips: () => ({ base_currency: "JPY", created_at: new Date().toISOString() }),
  participants: () => ({ mini_group_id: null, is_treasurer: false, avatar_media_id: null }),
  media: () => ({ participant_id: null, caption: null, uploaded_by: null, created_at: new Date().toISOString() }),
  transactions: () => ({
    category: "Food & Drink",
    exchange_rate_to_base: 1,
    paid_by_participant_id: null,
    receipt_url: null,
    line_items: null,
    occurred_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }),
  budget_items: () => ({ notes: null }),
  prepaid_items: () => ({ note: null, date: null, transaction_id: null, sort: 0, created_at: new Date().toISOString() }),
  trip_guide_versions: () => ({ saved_at: new Date().toISOString() }),
};

type Tables = Record<Table, Row[]>;
const g = globalThis as unknown as { __tms_memory?: Tables };

const objects = ((globalThis as unknown as { __tms_objects?: Map<string, Buffer> }).__tms_objects ??= new Map());

class MemoryStore implements Store {
  readonly kind = "memory" as const;

  async putObject(path: string, data: Buffer): Promise<void> {
    if (objects.has(path)) throw new Error("storage: The resource already exists");
    objects.set(path, Buffer.from(data));
  }
  async getObject(path: string): Promise<Buffer | null> {
    return objects.get(path) ?? null;
  }
  async removeObjects(paths: string[]): Promise<void> {
    for (const p of paths) objects.delete(p);
  }
  async databaseSize(): Promise<number | null> {
    return null;
  }
  private get db(): Tables {
    g.__tms_memory ??= {
      trips: [],
      mini_groups: [],
      participants: [],
      transactions: [],
      transaction_splits: [],
      budget_items: [],
      media: [],
      trip_guides: [],
      trip_guide_versions: [],
      prepaid_items: [],
      auth_attempts: [],
    };
    // Tables added after the store was created (e.g. during hot reload) start empty.
    for (const t of Object.keys(FKS) as Table[]) g.__tms_memory[t] ??= [];
    return g.__tms_memory;
  }

  private matches(row: Row, where: Where) {
    return Object.entries(where).every(([k, v]) =>
      Array.isArray(v) ? v.includes(row[k] as string) : row[k] === v,
    );
  }

  async select<T>(table: Table, where: Where = {}, columns = "*"): Promise<T[]> {
    const rows = this.db[table].filter((r) => this.matches(r, where));
    if (columns === "*") return structuredClone(rows) as T[];
    const cols = columns.split(",").map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))) as T[];
  }

  async insert<T>(table: Table, rows: Record<string, unknown>[]): Promise<T[]> {
    const created = rows.map((r) => ({ ...(DEFAULTS[table]?.() ?? {}), ...r, id: (r.id as string) ?? randomUUID() }) as Row);
    this.db[table].push(...created);
    return structuredClone(created) as T[];
  }

  async update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T | null> {
    const row = this.db[table].find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { id });
    return structuredClone(row) as T;
  }

  async remove(table: Table, where: Where): Promise<void> {
    const doomed = this.db[table].filter((r) => this.matches(r, where));
    if (doomed.length === 0) return;
    const ids = doomed.map((r) => r.id);
    this.db[table] = this.db[table].filter((r) => !ids.includes(r.id));
    for (const fk of FKS[table]) {
      if (fk.onDelete === "cascade") await this.remove(fk.table, { [fk.column]: ids });
      else for (const r of this.db[fk.table]) if (ids.includes(r[fk.column] as string)) r[fk.column] = null;
    }
  }
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && !url.startsWith("your_")) {
    cached = new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  } else {
    console.warn("[travel-money-split] Supabase env vars missing — using in-memory store (data resets on restart).");
    cached = new MemoryStore();
  }
  return cached;
}
