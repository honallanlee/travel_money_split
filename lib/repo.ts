import "server-only";
import { bundleToBackup } from "./backup";
import { getStore } from "./db/store";
import { allocateCents, currencyDecimals, fromCents, round2, roundTo, splitByLineItems, splitEqually, toCents } from "./settlement";
import type { BudgetItem, MediaItem, MiniGroup, Participant, Split, Transaction, Trip, TripBackup, TripBundle } from "./types";
import * as v from "./validation";
import { ValidationError } from "./validation";

export class NotFoundError extends Error {
  status = 404;
}

const db = () => getStore();
const n = (x: unknown) => Number(x ?? 0);

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export async function listTrips(): Promise<Trip[]> {
  const trips = await db().select<Trip>("trips");
  return trips.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function getTrip(id: string): Promise<Trip> {
  const [trip] = await db().select<Trip>("trips", { id });
  if (!trip) throw new NotFoundError("Trip not found");
  return trip;
}

export async function getTripBundle(id: string): Promise<TripBundle> {
  const trip = await getTrip(id);
  const [mini_groups, participants, txRows, budgets, photos] = await Promise.all([
    db().select<MiniGroup>("mini_groups", { trip_id: id }),
    db().select<Participant>("participants", { trip_id: id }),
    db().select<Transaction>("transactions", { trip_id: id }),
    db().select<BudgetItem>("budget_items", { trip_id: id }),
    db().select<MediaItem>("media", { trip_id: id, kind: "photo" }, MEDIA_META),
  ]);
  const splits = await db().select<Split & { transaction_id: string }>("transaction_splits", {
    transaction_id: txRows.map((t) => t.id),
  });
  const byTx = new Map<string, Split[]>();
  for (const s of splits) {
    const list = byTx.get(s.transaction_id) ?? [];
    list.push({ id: s.id, participant_id: s.participant_id, share_amount_base: n(s.share_amount_base) });
    byTx.set(s.transaction_id, list);
  }
  const transactions = txRows
    .map((t) => ({
      ...t,
      amount_local: n(t.amount_local),
      exchange_rate_to_base: n(t.exchange_rate_to_base),
      amount_base: n(t.amount_base),
      splits: byTx.get(t.id) ?? [],
    }))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return {
    trip,
    mini_groups: mini_groups.sort((a, b) => a.name.localeCompare(b.name)),
    participants: participants.sort((a, b) => a.name.localeCompare(b.name)),
    transactions,
    budget_items: budgets.map((b) => ({ ...b, planned_amount_base: n(b.planned_amount_base) })),
    photos: photos.sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

export async function createTrip(body: unknown): Promise<Trip> {
  const o = v.obj(body);
  const [trip] = await db().insert<Trip>("trips", [
    { name: v.str(o.name, "name", { max: 120 }), base_currency: v.currency(o.base_currency ?? "JPY", "base_currency") },
  ]);
  return trip;
}

export async function updateTrip(id: string, body: unknown): Promise<Trip> {
  const o = v.obj(body);
  const patch: Record<string, unknown> = {};
  if (o.name !== undefined) patch.name = v.str(o.name, "name", { max: 120 });
  if (o.base_currency !== undefined) patch.base_currency = v.currency(o.base_currency, "base_currency");
  const t = await db().update<Trip>("trips", id, patch);
  if (!t) throw new NotFoundError("Trip not found");
  return t;
}

export async function deleteTrip(id: string) {
  await db().remove("trips", { id });
}

// ---------------------------------------------------------------------------
// Mini-groups & participants
// ---------------------------------------------------------------------------

async function assertGroupInTrip(groupId: string | null, tripId: string) {
  if (!groupId) return;
  const [g] = await db().select<MiniGroup>("mini_groups", { id: groupId, trip_id: tripId });
  if (!g) throw new ValidationError("mini_group_id does not belong to this trip");
}

export async function createMiniGroup(body: unknown): Promise<MiniGroup> {
  const o = v.obj(body);
  const trip_id = v.uuid(o.trip_id, "trip_id");
  await getTrip(trip_id);
  const [g] = await db().insert<MiniGroup>("mini_groups", [{ trip_id, name: v.str(o.name, "name", { max: 80 }) }]);
  return g;
}

export async function updateMiniGroup(id: string, body: unknown): Promise<MiniGroup> {
  const o = v.obj(body);
  const g = await db().update<MiniGroup>("mini_groups", id, { name: v.str(o.name, "name", { max: 80 }) });
  if (!g) throw new NotFoundError("Group not found");
  return g;
}

export async function deleteMiniGroup(id: string) {
  await db().remove("mini_groups", { id });
}

export async function createParticipant(body: unknown): Promise<Participant> {
  const o = v.obj(body);
  const trip_id = v.uuid(o.trip_id, "trip_id");
  await getTrip(trip_id);
  const mini_group_id = v.uuidOrNull(o.mini_group_id, "mini_group_id");
  await assertGroupInTrip(mini_group_id, trip_id);
  const is_treasurer = o.is_treasurer === true;
  if (is_treasurer) await clearTreasurer(trip_id);
  const [p] = await db().insert<Participant>("participants", [
    { trip_id, mini_group_id, name: v.str(o.name, "name", { max: 80 }), is_treasurer },
  ]);
  return p;
}

async function clearTreasurer(tripId: string, exceptId?: string) {
  const current = await db().select<Participant>("participants", { trip_id: tripId });
  for (const p of current) if (p.is_treasurer && p.id !== exceptId) await db().update("participants", p.id, { is_treasurer: false });
}

export async function updateParticipant(id: string, body: unknown): Promise<Participant> {
  const o = v.obj(body);
  const [existing] = await db().select<Participant>("participants", { id });
  if (!existing) throw new NotFoundError("Participant not found");
  const patch: Record<string, unknown> = {};
  if (o.name !== undefined) patch.name = v.str(o.name, "name", { max: 80 });
  if (o.mini_group_id !== undefined) {
    patch.mini_group_id = v.uuidOrNull(o.mini_group_id, "mini_group_id");
    await assertGroupInTrip(patch.mini_group_id as string | null, existing.trip_id);
  }
  if (o.is_treasurer !== undefined) {
    patch.is_treasurer = o.is_treasurer === true;
    if (patch.is_treasurer) await clearTreasurer(existing.trip_id, id);
  }
  return (await db().update<Participant>("participants", id, patch))!;
}

export async function deleteParticipant(id: string) {
  // avatar media rows cascade via participant_id
  await db().remove("participants", { id });
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

async function parseTransaction(body: unknown, tripIdOverride?: string) {
  const o = v.obj(body);
  const trip_id = tripIdOverride ?? v.uuid(o.trip_id, "trip_id");
  const trip = await getTrip(trip_id);
  const participants = await db().select<Participant>("participants", { trip_id });
  const ids = new Set(participants.map((p) => p.id));

  const type = v.txType(o.type);
  const currency = v.currency(o.currency ?? trip.base_currency);
  const amount_local = roundTo(v.num(o.amount_local, "amount_local", { positive: true, max: 1e9 }), currencyDecimals(currency));
  const exchange_rate_to_base =
    currency === trip.base_currency && o.exchange_rate_to_base === undefined
      ? 1
      : v.num(o.exchange_rate_to_base ?? 1, "exchange_rate_to_base", { positive: true, max: 1e6 });
  const baseDecimals = currencyDecimals(trip.base_currency);
  const amount_base = roundTo(amount_local * exchange_rate_to_base, baseDecimals);

  let paid_by = v.uuidOrNull(o.paid_by_participant_id, "paid_by_participant_id");
  if (paid_by && !ids.has(paid_by)) throw new ValidationError("Payer is not on this trip");
  if ((type === "CASH_DEPOSIT" || type === "CARD_EXPENSE") && !paid_by)
    throw new ValidationError(type === "CASH_DEPOSIT" ? "Choose who deposited the cash" : "Choose who paid by card");
  if (type === "CASH_EXPENSE" && !paid_by) paid_by = participants.find((p) => p.is_treasurer)?.id ?? null;

  let splits: Split[] = [];
  if (type !== "CASH_DEPOSIT") {
    if (!Array.isArray(o.splits) || o.splits.length === 0) throw new ValidationError("Choose at least one person to split with");
    const raw = (o.splits as unknown[]).map((s, i) => {
      const so = v.obj(s);
      const participant_id = v.uuid(so.participant_id, `splits[${i}].participant_id`);
      if (!ids.has(participant_id)) throw new ValidationError("Split participant is not on this trip");
      return { participant_id, share_amount_base: v.num(so.share_amount_base, `splits[${i}].share`, { min: 0, max: 1e9 }) };
    });
    if (new Set(raw.map((s) => s.participant_id)).size !== raw.length) throw new ValidationError("Duplicate participant in splits");
    const sumCents = raw.reduce((a, s) => a + toCents(s.share_amount_base), 0);
    const totalCents = toCents(amount_base);
    // Allow tiny rounding drift (1p per person) and re-normalise so shares sum exactly to amount_base.
    if (Math.abs(sumCents - totalCents) > raw.length * 10 ** (2 - baseDecimals)) {
      throw new ValidationError(
        `Splits add up to ${fromCents(sumCents).toFixed(2)} but the total is ${amount_base.toFixed(2)}`,
      );
    }
    const cents = allocateCents(totalCents, raw.map((s) => toCents(s.share_amount_base)), 10 ** (2 - baseDecimals));
    splits = raw.map((s, i) => ({ ...s, share_amount_base: fromCents(cents[i]) })).filter((s) => s.share_amount_base > 0);
  }

  const items = v.lineItems(o.line_items);
  if (items) for (const it of items) it.assignees = (it.assignees ?? []).filter((a) => ids.has(a));

  return {
    row: {
      trip_id,
      type,
      title: v.str(o.title ?? (type === "CASH_DEPOSIT" ? "Cash deposit" : ""), "title", { max: 120 }),
      category: type === "CASH_DEPOSIT" ? "Other" : v.category(o.category),
      amount_local,
      currency,
      exchange_rate_to_base,
      amount_base,
      paid_by_participant_id: paid_by,
      receipt_url: v.str(o.receipt_url, "receipt_url", { optional: true, max: 2000 }) || null,
      line_items: items,
      occurred_at: v.isoDate(o.occurred_at, "occurred_at"),
    },
    splits,
  };
}

export async function createTransaction(body: unknown): Promise<Transaction> {
  const { row, splits } = await parseTransaction(body);
  const [tx] = await db().insert<Transaction>("transactions", [row]);
  try {
    await db().insert("transaction_splits", splits.map((s) => ({ ...s, transaction_id: tx.id })));
  } catch (e) {
    await db().remove("transactions", { id: tx.id });
    throw e;
  }
  return { ...tx, splits };
}

/**
 * "Everyone pays the same into the kitty": one CASH_DEPOSIT per selected person, all for
 * the same amount, written in a single insert so either all are saved or none are.
 */
export async function createGroupDeposits(body: unknown): Promise<Transaction[]> {
  const o = v.obj(body);
  if (!Array.isArray(o.participant_ids) || o.participant_ids.length === 0)
    throw new ValidationError("Pick at least one person");
  const ids = (o.participant_ids as unknown[]).map((x, i) => v.uuid(x, `participant_ids[${i}]`));
  if (new Set(ids).size !== ids.length) throw new ValidationError("Duplicate participant in deposit");
  if (ids.length > 200) throw new ValidationError("Too many people");
  const rows = [];
  for (const id of ids) {
    const { row } = await parseTransaction({ ...o, type: "CASH_DEPOSIT", paid_by_participant_id: id, splits: [] });
    rows.push(row);
  }
  const created = await db().insert<Transaction>("transactions", rows);
  return created.map((t) => ({ ...t, splits: [] }));
}

export async function updateTransaction(id: string, body: unknown): Promise<Transaction> {
  const [existing] = await db().select<Transaction>("transactions", { id });
  if (!existing) throw new NotFoundError("Transaction not found");
  const { row, splits } = await parseTransaction(body, existing.trip_id);
  const tx = await db().update<Transaction>("transactions", id, row);
  await db().remove("transaction_splits", { transaction_id: id });
  await db().insert("transaction_splits", splits.map((s) => ({ ...s, transaction_id: id })));
  return { ...tx!, splits };
}

export async function deleteTransaction(id: string) {
  await db().remove("transactions", { id });
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export async function createBudget(body: unknown): Promise<BudgetItem> {
  const o = v.obj(body);
  const trip_id = v.uuid(o.trip_id, "trip_id");
  await getTrip(trip_id);
  const [b] = await db().insert<BudgetItem>("budget_items", [
    {
      trip_id,
      category: v.category(o.category),
      planned_amount_base: round2(v.num(o.planned_amount_base, "planned_amount_base", { min: 0, max: 1e9 })),
      notes: v.str(o.notes, "notes", { optional: true, max: 500 }) || null,
    },
  ]);
  return b;
}

export async function updateBudget(id: string, body: unknown): Promise<BudgetItem> {
  const o = v.obj(body);
  const patch: Record<string, unknown> = {};
  if (o.category !== undefined) patch.category = v.category(o.category);
  if (o.planned_amount_base !== undefined)
    patch.planned_amount_base = round2(v.num(o.planned_amount_base, "planned_amount_base", { min: 0, max: 1e9 }));
  if (o.notes !== undefined) patch.notes = v.str(o.notes, "notes", { optional: true, max: 500 }) || null;
  const b = await db().update<BudgetItem>("budget_items", id, patch);
  if (!b) throw new NotFoundError("Budget item not found");
  return b;
}

export async function deleteBudget(id: string) {
  await db().remove("budget_items", { id });
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

export async function loadDemoTrip(): Promise<Trip> {
  const [trip] = await db().insert<Trip>("trips", [{ name: "Japan Spring Trip 2026", base_currency: "JPY" }]);
  const [smith, jones] = await db().insert<MiniGroup>("mini_groups", [
    { trip_id: trip.id, name: "Smith Family" },
    { trip_id: trip.id, name: "Jones Family" },
  ]);
  const ps = await db().insert<Participant>("participants", [
    { trip_id: trip.id, name: "Alice", mini_group_id: smith.id, is_treasurer: true },
    { trip_id: trip.id, name: "Bob", mini_group_id: smith.id, is_treasurer: false },
    { trip_id: trip.id, name: "Charlie", mini_group_id: jones.id, is_treasurer: false },
    { trip_id: trip.id, name: "Dana", mini_group_id: jones.id, is_treasurer: false },
    { trip_id: trip.id, name: "Frank", mini_group_id: null, is_treasurer: false },
  ]);
  const [alice, bob, charlie, dana, frank] = ps;
  const all = ps.map((p) => p.id);
  const GBP = 208.2; // 1 GBP = ¥208.2

  const make = (tx: Record<string, unknown>) => createTransaction({ trip_id: trip.id, currency: "JPY", ...tx });
  const equal = (total: number, who: string[] = all) => splitEqually(total, who, 0);
  const kitty = (title: string, category: string, amount: number, date: string, who: string[] = all) =>
    make({ type: "CASH_EXPENSE", title, category, amount_local: amount, occurred_at: date, splits: equal(amount, who) });
  const itemised = (items: { description: string; amount: number; assignees: string[] }[], total: number) =>
    splitByLineItems(total, items, 0).splits;

  // Before / at the start of the trip
  const flights = Math.round(1850 * GBP);
  await make({ type: "CARD_EXPENSE", title: "Return flights LHR–HND", category: "Flights", amount_local: 1850, currency: "GBP", exchange_rate_to_base: GBP, paid_by_participant_id: charlie.id, occurred_at: "2026-04-03", splits: equal(flights) });
  await make({ type: "CARD_EXPENSE", title: "Shinjuku apartment (6 nights)", category: "Accommodation", amount_local: 186000, paid_by_participant_id: bob.id, occurred_at: "2026-04-03", splits: equal(186000) });

  // Everyone hands yen to Alice for the kitty
  await make({ type: "CASH_DEPOSIT", title: "Kitty — yen from airport ATM", amount_local: 60000, paid_by_participant_id: alice.id, occurred_at: "2026-04-03" });
  await make({ type: "CASH_DEPOSIT", title: "Kitty top-up", amount_local: 60000, paid_by_participant_id: charlie.id, occurred_at: "2026-04-03" });
  await make({ type: "CASH_DEPOSIT", title: "Kitty top-up", amount_local: 30000, paid_by_participant_id: frank.id, occurred_at: "2026-04-03" });
  await make({ type: "CASH_DEPOSIT", title: "Kitty top-up", amount_local: 20000, paid_by_participant_id: dana.id, occurred_at: "2026-04-06" });

  // Mostly paid from the kitty in cash
  await kitty("Suica top-ups", "Transport", 15000, "2026-04-03");
  await kitty("Ichiran ramen", "Food & Drink", 6900, "2026-04-03");
  await kitty("Senso-ji & Skytree tickets", "Activities", 12400, "2026-04-04");
  await kitty("Konbini breakfast", "Food & Drink", 3260, "2026-04-04");

  const sushiItems = [
    { description: "Omakase set", amount: 5500, assignees: [alice.id, bob.id] },
    { description: "Salmon nigiri set", amount: 2800, assignees: [charlie.id] },
    { description: "Chirashi bowl", amount: 2400, assignees: [dana.id] },
    { description: "Kids' tamago set", amount: 1200, assignees: [frank.id] },
    { description: "Sake flight", amount: 3600, assignees: [alice.id, bob.id, charlie.id, dana.id] },
  ];
  await make({ type: "CASH_EXPENSE", title: "Sushi at Tsukiji", category: "Food & Drink", amount_local: 17050, occurred_at: "2026-04-04", line_items: sushiItems, splits: itemised(sushiItems, 17050) });

  await make({ type: "CARD_EXPENSE", title: "Shinkansen to Kyoto (reserved)", category: "Transport", amount_local: 70100, paid_by_participant_id: alice.id, occurred_at: "2026-04-05", splits: equal(70100) });
  await kitty("Fushimi Inari snacks", "Food & Drink", 4200, "2026-04-05");
  await kitty("Kinkaku-ji entry", "Activities", 2500, "2026-04-06");
  await kitty("Kyoto city buses", "Transport", 3500, "2026-04-06");

  const izakayaItems = [
    { description: "Yakitori platter", amount: 4800, assignees: all },
    { description: "Karaage", amount: 1600, assignees: [bob.id, frank.id] },
    { description: "Edamame & pickles", amount: 1200, assignees: all },
    { description: "Highballs", amount: 4400, assignees: [alice.id, bob.id, charlie.id, dana.id] },
    { description: "Melon soda", amount: 500, assignees: [frank.id] },
  ];
  await make({ type: "CASH_EXPENSE", title: "Izakaya in Pontocho", category: "Food & Drink", amount_local: 13750, occurred_at: "2026-04-06", line_items: izakayaItems, splits: itemised(izakayaItems, 13750) });

  await make({ type: "CARD_EXPENSE", title: "Tea ceremony experience", category: "Activities", amount_local: 22000, paid_by_participant_id: frank.id, occurred_at: "2026-04-07", splits: equal(22000, [alice.id, charlie.id, dana.id, frank.id]) });
  await kitty("Nara deer crackers & lunch", "Food & Drink", 7800, "2026-04-07");
  await kitty("Don Quijote souvenirs", "Shopping", 9600, "2026-04-08", [dana.id, frank.id]);
  await kitty("Narita Express tickets", "Transport", 16350, "2026-04-09");

  await db().insert("budget_items", [
    { trip_id: trip.id, category: "Flights", planned_amount_base: 400000, notes: "Booked in January" },
    { trip_id: trip.id, category: "Accommodation", planned_amount_base: 180000, notes: "6 nights" },
    { trip_id: trip.id, category: "Food & Drink", planned_amount_base: 70000, notes: null },
    { trip_id: trip.id, category: "Transport", planned_amount_base: 100000, notes: "Suica, Shinkansen, NEX" },
    { trip_id: trip.id, category: "Activities", planned_amount_base: 40000, notes: "Temples + tea ceremony" },
  ]);
  return trip;
}

// ---------------------------------------------------------------------------
// Photos & avatars
// ---------------------------------------------------------------------------

const MEDIA_META = "id,trip_id,kind,participant_id,width,height,caption,uploaded_by,created_at";
export const MAX_MEDIA_BYTES = 1_500_000; // after client-side compression
const MAX_PHOTOS_PER_TRIP = 500;

export async function uploadMedia(input: {
  trip_id: string;
  kind: "avatar" | "photo";
  participant_id: string | null;
  mime: string;
  data: Buffer;
  width: number | null;
  height: number | null;
  caption: string;
  uploaded_by: string;
}): Promise<MediaItem> {
  await getTrip(input.trip_id);
  if (input.data.length > MAX_MEDIA_BYTES) throw new ValidationError("Image is too large");
  if (input.kind === "avatar") {
    if (!input.participant_id) throw new ValidationError("Choose whose avatar this is");
    const [p] = await db().select<Participant>("participants", { id: input.participant_id, trip_id: input.trip_id });
    if (!p) throw new ValidationError("Traveller is not on this trip");
  } else {
    const existing = await db().select<{ id: string }>("media", { trip_id: input.trip_id, kind: "photo" }, "id");
    if (existing.length >= MAX_PHOTOS_PER_TRIP) throw new ValidationError("This trip has reached its photo limit");
  }
  const [row] = await db().insert<{ id: string }>("media", [
    {
      trip_id: input.trip_id,
      kind: input.kind,
      participant_id: input.kind === "avatar" ? input.participant_id : null,
      mime: input.mime,
      data: input.data.toString("base64"),
      byte_size: input.data.length,
      width: input.width,
      height: input.height,
      caption: input.caption || null,
      uploaded_by: input.uploaded_by || null,
    },
  ]);
  if (input.kind === "avatar") {
    const [p] = await db().select<Participant>("participants", { id: input.participant_id! });
    await db().update("participants", p.id, { avatar_media_id: row.id });
    if (p.avatar_media_id && p.avatar_media_id !== row.id) await db().remove("media", { id: p.avatar_media_id });
  }
  const [meta] = await db().select<MediaItem>("media", { id: row.id }, MEDIA_META);
  return meta;
}

export async function getMedia(id: string): Promise<{ mime: string; data: Buffer } | null> {
  const [m] = await db().select<{ mime: string; data: string }>("media", { id }, "mime,data");
  return m ? { mime: m.mime, data: Buffer.from(m.data, "base64") } : null;
}

export async function updateMedia(id: string, body: unknown): Promise<void> {
  const o = v.obj(body);
  const ok = await db().update("media", id, { caption: v.str(o.caption, "caption", { optional: true, max: 200 }) || null });
  if (!ok) throw new NotFoundError("Photo not found");
}

export async function deleteMedia(id: string) {
  await db().remove("media", { id });
}

// ---------------------------------------------------------------------------
// Backup export / import
// ---------------------------------------------------------------------------

export async function exportTrip(id: string): Promise<TripBackup> {
  return bundleToBackup(await getTripBundle(id));
}

/**
 * Restore a backup as a NEW trip (never overwrites). Every row goes through the same
 * validation as normal API writes; if anything fails the half-built trip is removed.
 */
export async function importTrip(body: unknown): Promise<Trip> {
  const o = v.obj(body);
  if (o.format !== "trip-kitty-backup" || o.version !== 1) throw new ValidationError("This isn't a Trip Kitty backup file");
  const src = o as unknown as TripBackup;
  for (const k of ["mini_groups", "participants", "transactions", "budget_items"] as const)
    if (!Array.isArray(src[k])) throw new ValidationError(`Backup is missing ${k}`);
  if (src.transactions.length > 5000 || src.participants.length > 200) throw new ValidationError("Backup is too large");

  const tripIn = v.obj(src.trip);
  const trip = await createTrip({ name: `${v.str(tripIn.name, "trip.name", { max: 100 })} (restored)`, base_currency: tripIn.base_currency });
  try {
    const groupMap = new Map<string, string>();
    for (const g of src.mini_groups) groupMap.set(String(g.id), (await createMiniGroup({ trip_id: trip.id, name: g.name })).id);
    const personMap = new Map<string, string>();
    for (const p of src.participants) {
      const created = await createParticipant({
        trip_id: trip.id,
        name: p.name,
        mini_group_id: p.mini_group_id ? groupMap.get(String(p.mini_group_id)) ?? null : null,
        is_treasurer: p.is_treasurer === true,
      });
      personMap.set(String(p.id), created.id);
    }
    const map = (id: unknown) => (id ? personMap.get(String(id)) ?? null : null);
    for (const [i, t] of src.transactions.entries()) {
      try {
        await createTransaction({
          ...t,
          id: undefined,
          trip_id: trip.id,
          paid_by_participant_id: map(t.paid_by_participant_id),
          splits: (t.splits ?? []).map((s) => ({ participant_id: map(s.participant_id), share_amount_base: s.share_amount_base })),
          line_items: t.line_items?.map((li) => ({ ...li, assignees: (li.assignees ?? []).map(map).filter(Boolean) })) ?? null,
        });
      } catch (e) {
        throw new ValidationError(`Transaction ${i + 1} ("${String(t.title ?? "")}"): ${(e as Error).message}`);
      }
    }
    for (const b of src.budget_items) await createBudget({ trip_id: trip.id, ...b });
    return trip;
  } catch (e) {
    await deleteTrip(trip.id);
    throw e;
  }
}
