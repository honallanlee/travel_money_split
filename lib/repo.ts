import "server-only";
import { randomUUID } from "node:crypto";
import { bundleToBackup } from "./backup";
import { getStore } from "./db/store";
import { allocateCents, currencyDecimals, fromCents, round2, roundTo, splitByLineItems, splitEqually, splitSharesBetweenParts, toCents } from "./settlement";
import { PREPAID_STATUSES, type BudgetItem, type GuideItem, type GuideStay, type MediaItem, type MiniGroup, type Participant, type PrepaidItem, type PrepaidStatus, type Split, type StorageUsage, type Transaction, type Trip, type TripBackup, type TripBundle, type TripGuide } from "./types";
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
  const [mini_groups, participants, txRows, budgets, photos, prepaid] = await Promise.all([
    db().select<MiniGroup>("mini_groups", { trip_id: id }),
    db().select<Participant>("participants", { trip_id: id }),
    db().select<Transaction>("transactions", { trip_id: id }),
    db().select<BudgetItem>("budget_items", { trip_id: id }),
    db().select<MediaItem>("media", { trip_id: id, kind: "photo" }, MEDIA_META),
    listPrepaid(id),
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
    prepaid_items: prepaid,
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
  const photos = await db().select<MediaRow>("media", { trip_id: id, kind: "photo" }, "id,storage_path,thumb_path");
  await db().remove("trips", { id });
  await removeObjectsQuietly(objectPaths(photos));
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

const DEFAULT_TITLES: Partial<Record<string, string>> = {
  CASH_DEPOSIT: "Cash deposit",
  CASH_PAYOUT: "Paid from kitty",
  TRANSFER: "Settle-up payment",
  REFUND: "Refund",
};

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
  const needsPerson: Partial<Record<typeof type, string>> = {
    CASH_DEPOSIT: "Choose who deposited the cash",
    CARD_EXPENSE: "Choose who paid by card",
    CASH_PAYOUT: "Choose who received the cash",
    TRANSFER: "Choose who paid",
  };
  if (needsPerson[type] && !paid_by) throw new ValidationError(needsPerson[type]!);
  // REFUND: paid_by = who got the money back (card refund); empty = cash back into the kitty.
  if (type === "CASH_EXPENSE" && !paid_by) paid_by = participants.find((p) => p.is_treasurer)?.id ?? null;

  let splits: Split[] = [];
  const isTransfer = type === "CASH_DEPOSIT" || type === "CASH_PAYOUT"; // moves cash, no splits
  if (type === "TRANSFER") {
    // Direct payment: exactly one receiver, who gets the full amount.
    const first = Array.isArray(o.splits) ? (o.splits as unknown[])[0] : undefined;
    const receiver = first ? v.uuidOrNull(v.obj(first).participant_id, "receiver") : null;
    if (!receiver || !ids.has(receiver)) throw new ValidationError("Choose who received the payment");
    if (receiver === paid_by) throw new ValidationError("Payer and receiver must be different people");
    if (Array.isArray(o.splits) && o.splits.length > 1) throw new ValidationError("A settle-up payment has one receiver");
    splits = [{ participant_id: receiver, share_amount_base: amount_base }];
  } else if (!isTransfer) {
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
      title: v.str(o.title ?? DEFAULT_TITLES[type] ?? "", "title", { max: 120 }),
      category: isTransfer || type === "TRANSFER" ? "Other" : v.category(o.category),
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

/**
 * One bill paid partly from the kitty and partly by someone's card. Saved as two expenses
 * (a CASH_EXPENSE and a CARD_EXPENSE) with every person's share divided between them in
 * proportion, so each person still pays their full share of the bill.
 */
export async function createSplitPayment(body: unknown): Promise<Transaction[]> {
  const o = v.obj(body);
  // Validate the whole bill (amount, currency, splits) as if it were one kitty expense.
  const { row: whole, splits } = await parseTransaction({ ...o, type: "CASH_EXPENSE" });
  const trip = await getTrip(whole.trip_id);
  const cardLocal = roundTo(v.num(o.card_amount_local, "card_amount_local", { positive: true, max: 1e9 }), currencyDecimals(whole.currency));
  if (cardLocal >= whole.amount_local) throw new ValidationError("The card part must be less than the total");
  const cardPayer = v.uuid(o.card_paid_by_participant_id, "card_paid_by_participant_id");
  const people = await db().select<Participant>("participants", { trip_id: whole.trip_id });
  if (!people.some((p) => p.id === cardPayer)) throw new ValidationError("Payer is not on this trip");

  const baseDec = currencyDecimals(trip.base_currency);
  const cardBase = roundTo(cardLocal * whole.exchange_rate_to_base, baseDec);
  const kittyBase = round2(whole.amount_base - cardBase);
  const { part: cardSplits, rest: kittySplits } = splitSharesBetweenParts(splits, cardBase, baseDec);
  const titleKitty = v.str(o.title_kitty ?? `${whole.title} (kitty part)`, "title_kitty", { max: 120 });
  const titleCard = v.str(o.title_card ?? `${whole.title} (card part)`, "title_card", { max: 120 });

  const rows = await db().insert<Transaction>("transactions", [
    { ...whole, title: titleKitty, amount_local: round2(whole.amount_local - cardLocal), amount_base: kittyBase },
    { ...whole, type: "CARD_EXPENSE", title: titleCard, amount_local: cardLocal, amount_base: cardBase, paid_by_participant_id: cardPayer, line_items: null },
  ]);
  const kittyTx = rows.find((r) => r.type === "CASH_EXPENSE")!;
  const cardTx = rows.find((r) => r.type === "CARD_EXPENSE")!;
  try {
    await db().insert("transaction_splits", [
      ...kittySplits.map((x) => ({ ...x, transaction_id: kittyTx.id })),
      ...cardSplits.map((x) => ({ ...x, transaction_id: cardTx.id })),
    ]);
  } catch (e) {
    await db().remove("transactions", { id: rows.map((r) => r.id) });
    throw e;
  }
  return [
    { ...kittyTx, splits: kittySplits },
    { ...cardTx, splits: cardSplits },
  ];
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
  const [trip] = await db().insert<Trip>("trips", [{ name: "Japan Spring Trip 2026 (example)", base_currency: "JPY" }]);
  try {
    await seedDemoTrip(trip);
  } catch (e) {
    await deleteTrip(trip.id); // never leave a half-built example behind
    throw e;
  }
  return trip;
}

async function seedDemoTrip(trip: Trip): Promise<void> {
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

  // Everyone puts the same into the kitty (one deposit each), plus one individual top-up
  await createGroupDeposits({ trip_id: trip.id, title: "Kitty — everyone's share", amount_local: 30000, currency: "JPY", occurred_at: "2026-04-03", participant_ids: all });
  await make({ type: "CASH_DEPOSIT", title: "Kitty top-up", amount_local: 10000, paid_by_participant_id: frank.id, occurred_at: "2026-04-06" });

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

  // Split payment: one dinner, part kitty cash (¥18,000), part Charlie's card (¥30,000)
  await createSplitPayment({
    trip_id: trip.id, title: "Kaiseki dinner in Gion", category: "Food & Drink", amount_local: 48000, currency: "JPY", occurred_at: "2026-04-06",
    splits: equal(48000), card_amount_local: 30000, card_paid_by_participant_id: charlie.id,
  });
  // Refunds: cash back into the kitty, and a refund onto Alice's card
  await make({ type: "REFUND", title: "Refund — returned souvenir", category: "Shopping", amount_local: 2400, occurred_at: "2026-04-08", paid_by_participant_id: null, splits: equal(2400, [dana.id, frank.id]) });
  await make({ type: "REFUND", title: "Refund — Shinkansen seat change", category: "Transport", amount_local: 5000, occurred_at: "2026-04-05", paid_by_participant_id: alice.id, splits: equal(5000) });
  // The kitty pays Bob back part of the apartment he put on his card
  await make({ type: "CASH_PAYOUT", title: "Apartment payback (part)", amount_local: 25000, occurred_at: "2026-04-09", paid_by_participant_id: bob.id });
  // Frank settles part of what he owes Charlie directly (PayPay)
  await make({ type: "TRANSFER", title: "PayPay to Charlie", amount_local: 10000, occurred_at: "2026-04-09", paid_by_participant_id: frank.id, splits: [{ participant_id: charlie.id, share_amount_base: 10000 }] });

  await db().insert("budget_items", [
    { trip_id: trip.id, category: "Flights", planned_amount_base: 400000, notes: "Booked in January" },
    { trip_id: trip.id, category: "Accommodation", planned_amount_base: 180000, notes: "6 nights" },
    { trip_id: trip.id, category: "Food & Drink", planned_amount_base: 70000, notes: null },
    { trip_id: trip.id, category: "Transport", planned_amount_base: 100000, notes: "Suica, Shinkansen, NEX" },
    { trip_id: trip.id, category: "Activities", planned_amount_base: 40000, notes: "Temples + tea ceremony" },
  ]);
}

// ---------------------------------------------------------------------------
// Photos & avatars
// ---------------------------------------------------------------------------

const MEDIA_META = "id,trip_id,kind,participant_id,width,height,caption,uploaded_by,created_at";
export const MAX_MEDIA_BYTES = 1_500_000; // after client-side compression
const MAX_PHOTOS_PER_TRIP = 500;
/** Supabase Free includes 1 GB of file storage for the whole project. */
export const PHOTO_STORAGE_LIMIT = 1_000_000_000;
/** Uploads stop a little before the limit so the project never goes over. */
const PHOTO_STORAGE_STOP = 0.95 * PHOTO_STORAGE_LIMIT;
/** Supabase Free includes a 500 MB database per project. */
export const DATABASE_LIMIT = 500_000_000;
/** Avatars (still in the database) stop well before the limit, so expenses can always be saved. */
const DATABASE_STOP = 0.8 * DATABASE_LIMIT;

const extFor = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

type MediaRow = { id: string; trip_id: string; kind: string; byte_size: number | null; storage_path: string | null; thumb_path: string | null };

/** Bytes used by trip photos in Supabase Storage (all trips: the 1 GB is shared by the project). */
async function photoBytes(): Promise<{ used: number; count: number }> {
  const rows = await db().select<MediaRow>("media", { kind: "photo" }, "id,byte_size,storage_path");
  const inStorage = rows.filter((r) => r.storage_path);
  return { used: inStorage.reduce((a, r) => a + n(r.byte_size), 0), count: inStorage.length };
}

export async function storageUsage(): Promise<StorageUsage> {
  const [p, dbSize] = await Promise.all([photoBytes(), db().databaseSize().catch(() => null)]);
  return { photos: { used: p.used, limit: PHOTO_STORAGE_LIMIT, count: p.count }, database: { used: dbSize, limit: DATABASE_LIMIT } };
}

export async function uploadMedia(input: {
  trip_id: string;
  kind: "avatar" | "photo";
  participant_id: string | null;
  mime: string;
  data: Buffer;
  /** small preview for the photo grid (photos only) */
  thumb?: Buffer | null;
  width: number | null;
  height: number | null;
  caption: string;
  uploaded_by: string;
}): Promise<MediaItem> {
  await getTrip(input.trip_id);
  if (input.data.length > MAX_MEDIA_BYTES) throw new ValidationError("Image is too large");
  const meta = {
    trip_id: input.trip_id,
    kind: input.kind,
    mime: input.mime,
    width: input.width,
    height: input.height,
    caption: input.caption || null,
    uploaded_by: input.uploaded_by || null,
  };

  if (input.kind === "avatar") {
    if (!input.participant_id) throw new ValidationError("Choose whose avatar this is");
    const [p] = await db().select<Participant>("participants", { id: input.participant_id, trip_id: input.trip_id });
    if (!p) throw new ValidationError("Traveller is not on this trip");
    if (input.data.length > 400_000) throw new ValidationError("Image is too large");
    const size = await db().databaseSize().catch(() => null);
    if (size !== null && size > DATABASE_STOP) throw new ValidationError("The database is nearly full — avatars are paused");
    const [row] = await db().insert<{ id: string }>("media", [
      { ...meta, participant_id: p.id, data: input.data.toString("base64"), byte_size: input.data.length },
    ]);
    await db().update("participants", p.id, { avatar_media_id: row.id });
    if (p.avatar_media_id && p.avatar_media_id !== row.id) await db().remove("media", { id: p.avatar_media_id });
    const [item] = await db().select<MediaItem>("media", { id: row.id }, MEDIA_META);
    return item;
  }

  // Trip photo → Supabase Storage (private bucket); only a small row goes in the database.
  const existing = await db().select<{ id: string }>("media", { trip_id: input.trip_id, kind: "photo" }, "id");
  if (existing.length >= MAX_PHOTOS_PER_TRIP) throw new ValidationError("This trip has reached its photo limit");
  const thumb = input.thumb && input.thumb.length <= 300_000 ? input.thumb : null;
  const bytes = input.data.length + (thumb?.length ?? 0);
  const { used } = await photoBytes();
  if (used + bytes > PHOTO_STORAGE_STOP) throw new ValidationError("Photo storage is full");

  const id = randomUUID();
  const storage_path = `${input.trip_id}/${id}.${extFor(input.mime)}`;
  const thumb_path = thumb ? `${input.trip_id}/${id}_thumb.jpg` : null;
  await db().putObject(storage_path, input.data, input.mime);
  try {
    if (thumb && thumb_path) await db().putObject(thumb_path, thumb, "image/jpeg");
    await db().insert("media", [{ ...meta, id, participant_id: null, data: null, storage_path, thumb_path, byte_size: bytes }]);
  } catch (e) {
    await db().removeObjects([storage_path, ...(thumb_path ? [thumb_path] : [])]).catch(() => {});
    throw e;
  }
  const [item] = await db().select<MediaItem>("media", { id }, MEDIA_META);
  return item;
}

export async function getMedia(id: string, size: "full" | "thumb" = "full"): Promise<{ mime: string; data: Buffer } | null> {
  const [m] = await db().select<{ mime: string; data: string | null; storage_path: string | null; thumb_path: string | null }>(
    "media",
    { id },
    "mime,data,storage_path,thumb_path",
  );
  if (!m) return null;
  if (m.storage_path) {
    const useThumb = size === "thumb" && m.thumb_path;
    const buf = await db().getObject(useThumb ? m.thumb_path! : m.storage_path);
    return buf ? { mime: useThumb ? "image/jpeg" : m.mime, data: buf } : null;
  }
  return m.data ? { mime: m.mime, data: Buffer.from(m.data, "base64") } : null;
}

/** Storage files of the given media rows (photos only; avatars live in the database). */
function objectPaths(rows: Pick<MediaRow, "storage_path" | "thumb_path">[]) {
  return rows.flatMap((r) => [r.storage_path, r.thumb_path]).filter((x): x is string => !!x);
}

async function removeObjectsQuietly(paths: string[]) {
  if (!paths.length) return;
  try {
    await db().removeObjects(paths);
  } catch (e) {
    console.warn("[storage] could not delete files:", (e as Error).message);
  }
}

export async function updateMedia(id: string, body: unknown): Promise<void> {
  const o = v.obj(body);
  const ok = await db().update("media", id, { caption: v.str(o.caption, "caption", { optional: true, max: 200 }) || null });
  if (!ok) throw new NotFoundError("Photo not found");
}

export async function deleteMedia(id: string) {
  const rows = await db().select<MediaRow>("media", { id }, "id,storage_path,thumb_path");
  await db().remove("media", { id });
  await removeObjectsQuietly(objectPaths(rows));
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
  if (o.format !== "trip-kitty-backup" || o.version !== 1) throw new ValidationError("This isn't a Travel Hub backup file");
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
    for (const x of src.prepaid_items ?? [])
      await createPrepaid({
        ...x,
        trip_id: trip.id,
        shares: (x.shares ?? []).map((s) => ({ participant_id: map(s.participant_id), amount: s.amount })).filter((s) => s.participant_id),
      });
    return trip;
  } catch (e) {
    await deleteTrip(trip.id);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Trip guide (read-only itinerary)
// ---------------------------------------------------------------------------

/** Remove booking refs / login IDs for viewers who aren't in Treasurer Mode. */
function redactGuide(g: TripGuide): TripGuide {
  const item = (it: GuideItem): GuideItem => {
    const { private: priv, options, ...rest } = it;
    return { ...rest, hasPrivate: !!priv?.length, options: options?.map(item) };
  };
  const stay = (st: GuideStay): GuideStay => {
    const { private: priv, ...rest } = st;
    return { ...rest, hasPrivate: !!priv?.length };
  };
  return {
    ...g,
    flights: g.flights?.map(item),
    days: g.days.map((d) => ({ ...d, items: d.items.map(item) })),
    stays: g.stays.map(stay),
  };
}

export async function getTripGuide(tripId: string, includePrivate: boolean): Promise<TripGuide | null> {
  const [row] = await db().select<{ content: TripGuide }>("trip_guides", { trip_id: tripId }, "content");
  if (!row) return null;
  return includePrivate ? row.content : redactGuide(row.content);
}

export async function saveTripGuide(tripId: string, body: unknown): Promise<void> {
  await getTrip(tripId);
  const o = v.obj(body);
  v.str(o.title, "title", { max: 200 });
  if (!Array.isArray(o.days) || !Array.isArray(o.stays) || !Array.isArray(o.notes))
    throw new ValidationError("Guide needs title, notes, days and stays");
  if (JSON.stringify(o).length > 500_000) throw new ValidationError("Guide is too large");
  // Keep the previous version so an accidental overwrite can be undone.
  const [prev] = await db().select<{ content: TripGuide }>("trip_guides", { trip_id: tripId }, "content");
  if (prev) {
    try {
      await db().insert("trip_guide_versions", [{ trip_id: tripId, content: prev.content, saved_at: new Date().toISOString() }]);
      // Keep the last 30 versions per trip so the history can't fill the database.
      const versions = await db().select<{ id: string; saved_at: string }>("trip_guide_versions", { trip_id: tripId }, "id,saved_at");
      const old = versions.sort((a, b) => b.saved_at.localeCompare(a.saved_at)).slice(30).map((x) => x.id);
      if (old.length) await db().remove("trip_guide_versions", { id: old });
    } catch (e) {
      console.warn("[guide] could not keep the previous version (run supabase/schema.sql):", (e as Error).message);
    }
  }
  await db().remove("trip_guides", { trip_id: tripId });
  await db().insert("trip_guides", [{ trip_id: tripId, content: o, updated_at: new Date().toISOString() }]);
}

export async function deleteTripGuide(tripId: string) {
  await db().remove("trip_guides", { trip_id: tripId });
}

// ---------------------------------------------------------------------------
// Prepaid / planned costs (settled outside the app: hotels, flights…)
// ---------------------------------------------------------------------------

const missingTable = (e: unknown) => /schema cache|PGRST205|relation .* does not exist|prepaid_items/i.test((e as Error)?.message ?? "");

function normalisePrepaid(r: PrepaidItem): PrepaidItem {
  return {
    ...r,
    exchange_rate_to_base: n(r.exchange_rate_to_base) || 1,
    sort: n(r.sort),
    shares: (Array.isArray(r.shares) ? r.shares : []).map((s) => ({ participant_id: s.participant_id, amount: n(s.amount) })),
  };
}

/** Never breaks the trip page: before the table exists (schema not yet re-run) it returns []. */
export async function listPrepaid(tripId: string): Promise<PrepaidItem[]> {
  try {
    const rows = await db().select<PrepaidItem>("prepaid_items", { trip_id: tripId });
    return rows.map(normalisePrepaid).sort((a, b) => a.sort - b.sort || (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

function prepaidFields(o: Record<string, unknown>, partial: boolean) {
  const patch: Record<string, unknown> = {};
  const has = (k: string) => !partial || o[k] !== undefined;
  if (has("title")) patch.title = v.str(o.title, "title", { max: 120 });
  if (has("category")) patch.category = v.category(o.category ?? "Accommodation");
  if (has("currency")) patch.currency = v.currency(o.currency ?? "JPY");
  if (has("exchange_rate_to_base")) patch.exchange_rate_to_base = v.num(o.exchange_rate_to_base ?? 1, "exchange_rate_to_base", { positive: true, max: 1e6 });
  if (has("status")) {
    const st = (o.status ?? "paid") as PrepaidStatus;
    if (!PREPAID_STATUSES.includes(st)) throw new ValidationError(`status must be one of ${PREPAID_STATUSES.join(", ")}`);
    patch.status = st;
  }
  if (has("date")) {
    const d = o.date ? v.str(o.date, "date", { max: 10 }) : null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ValidationError("date must be YYYY-MM-DD");
    patch.date = d;
  }
  if (has("note")) patch.note = o.note ? v.str(o.note, "note", { max: 300 }) : null;
  if (has("sort")) patch.sort = Math.trunc(v.num(o.sort ?? 0, "sort", { min: -1e6, max: 1e6 }));
  if (has("transaction_id")) patch.transaction_id = v.uuidOrNull(o.transaction_id, "transaction_id");
  if (has("shares")) {
    if (!Array.isArray(o.shares)) throw new ValidationError("shares must be a list");
    if (o.shares.length > 200) throw new ValidationError("Too many shares");
    patch.shares = o.shares.map((raw, i) => {
      const so = v.obj(raw);
      return { participant_id: v.uuid(so.participant_id, `shares[${i}].participant_id`), amount: round2(v.num(so.amount, `shares[${i}].amount`, { min: 0, max: 1e9 })) };
    });
  }
  return patch;
}

export async function createPrepaid(body: unknown): Promise<PrepaidItem> {
  const o = v.obj(body);
  const trip_id = v.uuid(o.trip_id, "trip_id");
  await getTrip(trip_id);
  const [row] = await db().insert<PrepaidItem>("prepaid_items", [{ trip_id, ...prepaidFields(o, false) }]);
  return normalisePrepaid(row);
}

export async function updatePrepaid(id: string, body: unknown): Promise<PrepaidItem> {
  const row = await db().update<PrepaidItem>("prepaid_items", id, prepaidFields(v.obj(body), true));
  if (!row) throw new NotFoundError("Cost not found");
  return normalisePrepaid(row);
}

export async function deletePrepaid(id: string) {
  await db().remove("prepaid_items", { id });
}
