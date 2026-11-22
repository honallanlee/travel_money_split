/**
 * Core ledger maths. All arithmetic is done in integer cents to avoid float drift;
 * public functions accept and return amounts in major units (e.g. pounds).
 */
import type { MiniGroup, Participant, Split, Transaction, TripBundle } from "./types";

export const EPSILON_CENTS = 1; // balances below 0.01 are treated as settled

export const toCents = (n: number) => Math.round((Number(n) || 0) * 100);
export const fromCents = (c: number) => c / 100;
export const round2 = (n: number) => fromCents(toCents(n));

/** Number of minor-unit decimals for a currency (JPY → 0, GBP → 2). Capped at 2 to match storage. */
export function currencyDecimals(currency: string): number {
  try {
    const d = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return Math.min(2, Math.max(0, d));
  } catch {
    return 2;
  }
}

/** Smallest unit in cents for a given number of decimals (2 → 1, 0 → 100). */
const stepFor = (decimals: number) => 10 ** (2 - Math.min(2, Math.max(0, decimals)));

/** Round to the currency's smallest unit, e.g. whole yen. */
export function roundTo(n: number, decimals = 2): number {
  const step = stepFor(decimals);
  return fromCents(Math.round(toCents(n) / step) * step);
}

/**
 * Distribute `totalCents` proportionally to `weights` using the largest-remainder
 * method, so the parts always sum exactly to the total. Zero/empty weights split equally.
 */
export function allocateCents(totalCents: number, weights: number[], stepCents = 1): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (stepCents > 1) {
    // Allocate whole units (e.g. yen), then put any sub-unit leftover on the largest part.
    const units = Math.trunc(totalCents / stepCents);
    const parts = allocateCents(units, weights).map((u) => u * stepCents);
    const rest = totalCents - units * stepCents;
    if (rest) parts[parts.indexOf(Math.max(...parts))] += rest;
    return parts;
  }
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? clean : clean.map(() => 1);
  const effSum = sum > 0 ? sum : n;

  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const raw = effective.map((w) => (abs * w) / effSum);
  const floors = raw.map(Math.floor);
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % n, remainder--) floors[order[k].i] += 1;
  return floors.map((c) => c * sign);
}

/** Split a base-currency total equally across participants (remainder cents go to the first people). */
export function splitEqually(total: number, participantIds: string[], decimals = 2): Split[] {
  const cents = allocateCents(toCents(total), participantIds.map(() => 1), stepFor(decimals));
  return participantIds.map((id, i) => ({ participant_id: id, share_amount_base: fromCents(cents[i]) }));
}

/** Split a total proportionally to per-person weights (e.g. custom amounts typed in local currency). */
export function splitByWeights(total: number, weights: Record<string, number>, decimals = 2): Split[] {
  const ids = Object.keys(weights).filter((id) => weights[id] > 0);
  const cents = allocateCents(toCents(total), ids.map((id) => weights[id]), stepFor(decimals));
  return ids.map((id, i) => ({ participant_id: id, share_amount_base: fromCents(cents[i]) }));
}

/**
 * Itemised receipt splitting. Each line item is divided equally between its assignees;
 * the resulting per-person subtotals are then scaled to `total` so tax, tip or service
 * charges not listed as items are shared proportionally.
 */
export function splitByLineItems(
  total: number,
  items: { amount: number; assignees?: string[] }[],
  decimals = 2,
): { splits: Split[]; unassignedAmount: number } {
  const weights: Record<string, number> = {};
  let unassigned = 0;
  for (const item of items) {
    const amt = Number(item.amount) || 0;
    const who = item.assignees ?? [];
    if (amt <= 0) continue;
    if (who.length === 0) {
      unassigned += amt;
      continue;
    }
    for (const id of who) weights[id] = (weights[id] ?? 0) + amt / who.length;
  }
  return { splits: splitByWeights(total, weights, decimals), unassignedAmount: round2(unassigned) };
}

/**
 * Split payment (part kitty cash, part card): divide each person's share of the whole bill
 * between the two parts in proportion, so both parts' shares add up exactly.
 */
export function splitSharesBetweenParts(
  splits: Split[],
  partBase: number,
  decimals = 2,
): { part: Split[]; rest: Split[] } {
  const step = 10 ** (2 - Math.min(2, Math.max(0, decimals)));
  const partCents = allocateCents(toCents(partBase), splits.map((s) => toCents(s.share_amount_base)), step);
  const part = splits.map((s, i) => ({ participant_id: s.participant_id, share_amount_base: fromCents(partCents[i]) }));
  const rest = splits.map((s, i) => ({
    participant_id: s.participant_id,
    share_amount_base: fromCents(toCents(s.share_amount_base) - partCents[i]),
  }));
  return { part: part.filter((s) => s.share_amount_base > 0), rest: rest.filter((s) => s.share_amount_base > 0) };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface CashPool {
  deposits: number;
  expenses: number;
  /** cash handed out of the kitty to people (reimbursements / settling up) */
  payouts: number;
  /** cash refunds from shops paid back into the kitty */
  refunds: number;
  balance: number;
}

/** Expected Cash in Treasurer's Wallet = Σ deposits − Σ cash expenses − Σ payouts + Σ cash refunds */
export function computeCashPool(transactions: Transaction[]): CashPool {
  let dep = 0;
  let exp = 0;
  let out = 0;
  let ref = 0;
  for (const t of transactions) {
    if (t.type === "CASH_DEPOSIT") dep += toCents(t.amount_base);
    else if (t.type === "CASH_EXPENSE") exp += toCents(t.amount_base);
    else if (t.type === "CASH_PAYOUT") out += toCents(t.amount_base);
    else if (t.type === "REFUND" && !t.paid_by_participant_id) ref += toCents(t.amount_base);
  }
  return {
    deposits: fromCents(dep),
    expenses: fromCents(exp),
    payouts: fromCents(out),
    refunds: fromCents(ref),
    balance: fromCents(dep - exp - out + ref),
  };
}

export interface ParticipantBalance {
  participant_id: string;
  deposits: number;
  card_paid: number;
  shares: number;
  /** cash received from the kitty */
  received: number;
  /** direct settle-up payments: paid to others minus received from others */
  settled: number;
  net: number;
}

/**
 * net = cash deposits + card outlays − expense shares − cash received from the kitty + direct payments made.
 * Refunds reduce shares (and, for a card refund, the recipient's card outlay). Positive = owed money.
 */
export function computeParticipantBalances(
  participants: Participant[],
  transactions: Transaction[],
): Record<string, ParticipantBalance> {
  const acc: Record<string, { dep: number; card: number; share: number; recv: number; settled: number }> = {};
  for (const p of participants) acc[p.id] = { dep: 0, card: 0, share: 0, recv: 0, settled: 0 };

  for (const t of transactions) {
    const payer = t.paid_by_participant_id ? acc[t.paid_by_participant_id] : undefined;
    if (t.type === "CASH_DEPOSIT") {
      if (payer) payer.dep += toCents(t.amount_base);
      continue;
    }
    if (t.type === "CASH_PAYOUT") {
      if (payer) payer.recv += toCents(t.amount_base);
      continue;
    }
    if (t.type === "TRANSFER") {
      if (payer) payer.settled += toCents(t.amount_base);
      for (const s of t.splits ?? []) {
        const who = acc[s.participant_id];
        if (who) who.settled -= toCents(s.share_amount_base);
      }
      continue;
    }
    if (t.type === "REFUND") {
      // A card refund lands with one person: it undoes part of what they paid out.
      if (payer) payer.card -= toCents(t.amount_base);
      for (const s of t.splits ?? []) {
        const who = acc[s.participant_id];
        if (who) who.share -= toCents(s.share_amount_base);
      }
      continue;
    }
    if (t.type === "CARD_EXPENSE" && payer) payer.card += toCents(t.amount_base);
    for (const s of t.splits ?? []) {
      const who = acc[s.participant_id];
      if (who) who.share += toCents(s.share_amount_base);
    }
  }

  const out: Record<string, ParticipantBalance> = {};
  for (const [id, a] of Object.entries(acc)) {
    out[id] = {
      participant_id: id,
      deposits: fromCents(a.dep),
      card_paid: fromCents(a.card),
      shares: fromCents(a.share),
      received: fromCents(a.recv),
      settled: fromCents(a.settled),
      net: fromCents(a.dep + a.card - a.share - a.recv + a.settled),
    };
  }
  return out;
}

export type EntityKind = "group" | "solo" | "kitty";

export interface SettlementEntity {
  id: string;
  name: string;
  kind: EntityKind;
  member_ids: string[];
  deposits: number;
  card_paid: number;
  shares: number;
  received: number;
  settled: number;
  net: number;
}

export const KITTY_ID = "__cash_kitty__";

/**
 * Sum participant balances by mini-group. Ungrouped participants stay standalone.
 * Groups with no members are omitted.
 */
export function rollupEntities(
  participants: Participant[],
  groups: MiniGroup[],
  balances: Record<string, ParticipantBalance>,
): SettlementEntity[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const entities = new Map<string, SettlementEntity & { _c: [number, number, number, number, number, number] }>();

  for (const p of participants) {
    const b = balances[p.id];
    if (!b) continue;
    const g = p.mini_group_id ? groupById.get(p.mini_group_id) : undefined;
    const key = g ? g.id : p.id;
    let e = entities.get(key);
    if (!e) {
      e = {
        id: key,
        name: g ? g.name : p.name,
        kind: g ? "group" : "solo",
        member_ids: [],
        deposits: 0,
        card_paid: 0,
        shares: 0,
        received: 0,
        settled: 0,
        net: 0,
        _c: [0, 0, 0, 0, 0, 0],
      };
      entities.set(key, e);
    }
    e.member_ids.push(p.id);
    e._c[0] += toCents(b.deposits);
    e._c[1] += toCents(b.card_paid);
    e._c[2] += toCents(b.shares);
    e._c[3] += toCents(b.net);
    e._c[4] += toCents(b.received);
    e._c[5] += toCents(b.settled);
  }

  return [...entities.values()].map(({ _c, ...e }) => ({
    ...e,
    deposits: fromCents(_c[0]),
    card_paid: fromCents(_c[1]),
    shares: fromCents(_c[2]),
    received: fromCents(_c[4]),
    settled: fromCents(_c[5]),
    net: fromCents(_c[3]),
  }));
}

export interface Transfer {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
}

/**
 * Greedy minimum-transfers: repeatedly pair the largest debtor with the largest
 * creditor and settle min(|debt|, credit) until everything is within 0.01.
 */
export function simplifyDebts(entities: { id: string; name: string; net: number }[]): Transfer[] {
  const people = entities.map((e) => ({ id: e.id, name: e.name, c: toCents(e.net) }));
  const transfers: Transfer[] = [];
  // Upper bound on iterations: each step zeroes at least one party.
  for (let guard = 0; guard < people.length * 2 + 2; guard++) {
    let debtor: (typeof people)[number] | undefined;
    let creditor: (typeof people)[number] | undefined;
    for (const p of people) {
      if (p.c <= -EPSILON_CENTS && (!debtor || p.c < debtor.c)) debtor = p;
      if (p.c >= EPSILON_CENTS && (!creditor || p.c > creditor.c)) creditor = p;
    }
    if (!debtor || !creditor) break;
    const amt = Math.min(-debtor.c, creditor.c);
    debtor.c += amt;
    creditor.c -= amt;
    transfers.push({
      from_id: debtor.id,
      from_name: debtor.name,
      to_id: creditor.id,
      to_name: creditor.name,
      amount: fromCents(amt),
    });
  }
  return transfers;
}

export interface Ledger {
  pool: CashPool;
  balances: Record<string, ParticipantBalance>;
  entities: SettlementEntity[];
  /** entities plus the cash kitty (if it holds leftover cash) — these are what get settled */
  settlementParties: SettlementEntity[];
  transfers: Transfer[];
  treasurerName: string | null;
}

/**
 * Full ledger for a trip. Because deposits credit depositors but cash spent from the
 * kitty credits nobody, Σ(participant net) == cash pool balance. Any leftover cash is
 * modelled as a "Cash Kitty" party that owes it back (or is owed, if overdrawn), so the
 * settlement plan includes the Treasurer returning unspent cash.
 * With `individual`, families are ignored and everyone settles on their own.
 */
export function computeLedger(
  bundle: Pick<TripBundle, "participants" | "mini_groups" | "transactions">,
  opts: { individual?: boolean } = {},
): Ledger {
  const pool = computeCashPool(bundle.transactions);
  const balances = computeParticipantBalances(bundle.participants, bundle.transactions);
  // individual: every traveller settles on their own instead of as a family
  const entities = rollupEntities(bundle.participants, opts.individual ? [] : bundle.mini_groups, balances);
  const treasurer = bundle.participants.find((p) => p.is_treasurer) ?? null;

  const parties = [...entities];
  if (Math.abs(toCents(pool.balance)) >= EPSILON_CENTS) {
    parties.push({
      id: KITTY_ID,
      name: treasurer ? `Cash Kitty (${treasurer.name})` : "Cash Kitty",
      kind: "kitty",
      member_ids: [],
      deposits: 0,
      card_paid: 0,
      shares: 0,
      received: 0,
      settled: 0,
      net: -pool.balance,
    });
  }

  return {
    pool,
    balances,
    entities,
    settlementParties: parties,
    transfers: simplifyDebts(parties),
    treasurerName: treasurer?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatMoney(amount: number, currency: string): string {
  try {
    // "¥" rather than "JP¥"; other currencies keep their unambiguous symbol (e.g. HK$, US$)
    const currencyDisplay = currency === "JPY" ? "narrowSymbol" : "symbol";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;
const interp: Translate = (k, vars) => Object.entries(vars ?? {}).reduce((acc, [n, v]) => acc.replaceAll(`{${n}}`, String(v)), k);

export function formatWhatsAppSummary(
  tripName: string,
  currency: string,
  ledger: Pick<Ledger, "entities" | "transfers" | "pool">,
  opts: {
    fmt?: (amountBase: number) => string;
    note?: string;
    /** translator; English keys are used when omitted */
    t?: Translate;
    /** display name for a settlement party (e.g. translated "Cash Kitty") */
    partyName?: (id: string, name: string) => string;
  } = {},
): string {
  const money = opts.fmt ?? ((n: number) => formatMoney(n, currency));
  const tt = opts.t ?? interp;
  const nm = opts.partyName ?? ((_id: string, name: string) => name);
  const lines: string[] = [];
  lines.push(`*${tt("{trip} — Settle Up", { trip: tripName })}* 💸`);
  if (opts.note) lines.push(`_${opts.note}_`);
  lines.push("");
  lines.push(tt("Cash kitty: {amount} remaining", { amount: money(ledger.pool.balance) }));
  lines.push("");
  lines.push(`*${tt("Balances")}*`);
  for (const e of ledger.entities) {
    const square = Math.abs(e.net) < 0.01;
    const tag = square ? tt("settled") : e.net > 0 ? tt("is owed") : tt("owes");
    lines.push(`• ${e.name}: ${tag}${square ? "" : " " + money(Math.abs(e.net))}`);
  }
  lines.push("");
  lines.push(`*${tt("Payments")}*`);
  if (ledger.transfers.length === 0) lines.push(tt("Everyone is square ✅"));
  ledger.transfers.forEach((x, i) => {
    lines.push(`${i + 1}. ${tt("{from} pays {to} {amount}", { from: nm(x.from_id, x.from_name), to: nm(x.to_id, x.to_name), amount: money(x.amount) })}`);
  });
  return lines.join("\n");
}
