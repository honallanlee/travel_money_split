/**
 * Everything each person spends on the trip: their share of expenses logged in the app
 * (by category) plus costs settled outside it (hotels and flights paid before the trip,
 * or still to pay on the spot). Pure, so it works from the offline copy too.
 */
import { currencyDecimals, fromCents, roundTo, toCents } from "./settlement";
import type { PrepaidItem, PrepaidStatus, TripBundle } from "./types";

export interface PrepaidLine {
  item: PrepaidItem;
  /** in the item's own currency */
  amount: number;
  /** in the trip's base currency */
  base: number;
}

export interface PersonTotal {
  participant_id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  /** share of expenses logged in the app, per category (refunds subtract) */
  byCategory: Record<string, number>;
  tripSpend: number;
  prepaid: PrepaidLine[];
  /** settled outside the app */
  prepaidPaid: number;
  /** still to pay (e.g. at the hotel) */
  prepaidDue: number;
  /** prepaid amounts in their own currencies, e.g. { HKD: 9000, JPY: 18000 } */
  prepaidByCurrency: Record<string, { paid: number; due: number }>;
  /** tripSpend + prepaidPaid + prepaidDue, in the base currency */
  total: number;
}

export interface GroupTotal {
  id: string;
  name: string;
  member_ids: string[];
  tripSpend: number;
  prepaidPaid: number;
  prepaidDue: number;
  total: number;
}

export interface TripTotals {
  people: PersonTotal[];
  groups: GroupTotal[];
  tripSpend: number;
  prepaidPaid: number;
  prepaidDue: number;
  total: number;
  /** category totals across app expenses and prepaid costs */
  byCategory: { category: string; amount: number }[];
  prepaidByCurrency: Record<string, { paid: number; due: number }>;
}

/** Prepaid costs that count towards totals ("recorded" ones are already app expenses). */
export const countsTowardsTotal = (s: PrepaidStatus) => s === "paid" || s === "due";

export function prepaidShareBase(amount: number, rate: number, baseCurrency: string) {
  return roundTo(amount * (rate || 1), currencyDecimals(baseCurrency));
}

export function computeTripTotals(bundle: Pick<TripBundle, "trip" | "participants" | "mini_groups" | "transactions" | "prepaid_items">): TripTotals {
  const base = bundle.trip.base_currency;
  const groupName = new Map(bundle.mini_groups.map((g) => [g.id, g.name]));
  const acc = new Map<string, { cat: Map<string, number>; paid: number; due: number; lines: PrepaidLine[]; cur: Record<string, { paid: number; due: number }> }>();
  for (const p of bundle.participants) acc.set(p.id, { cat: new Map(), paid: 0, due: 0, lines: [], cur: {} });
  const catAll = new Map<string, number>();
  const curAll: Record<string, { paid: number; due: number }> = {};

  for (const t of bundle.transactions) {
    const sign = t.type === "REFUND" ? -1 : t.type === "CASH_EXPENSE" || t.type === "CARD_EXPENSE" ? 1 : 0;
    if (!sign) continue;
    for (const s of t.splits ?? []) {
      const a = acc.get(s.participant_id);
      if (!a) continue;
      const c = sign * toCents(s.share_amount_base);
      a.cat.set(t.category, (a.cat.get(t.category) ?? 0) + c);
      catAll.set(t.category, (catAll.get(t.category) ?? 0) + c);
    }
  }

  for (const item of bundle.prepaid_items ?? []) {
    if (!countsTowardsTotal(item.status)) continue;
    const key = item.status === "due" ? "due" : "paid";
    for (const s of item.shares) {
      const a = acc.get(s.participant_id);
      if (!a || !s.amount) continue;
      const b = prepaidShareBase(s.amount, item.exchange_rate_to_base, base);
      a.lines.push({ item, amount: s.amount, base: b });
      a[key] += toCents(b);
      a.cur[item.currency] ??= { paid: 0, due: 0 };
      a.cur[item.currency][key] = fromCents(toCents(a.cur[item.currency][key]) + toCents(s.amount));
      curAll[item.currency] ??= { paid: 0, due: 0 };
      curAll[item.currency][key] = fromCents(toCents(curAll[item.currency][key]) + toCents(s.amount));
      catAll.set(item.category, (catAll.get(item.category) ?? 0) + toCents(b));
    }
  }

  const people: PersonTotal[] = bundle.participants.map((p) => {
    const a = acc.get(p.id)!;
    const spend = [...a.cat.values()].reduce((x, y) => x + y, 0);
    return {
      participant_id: p.id,
      name: p.name,
      group_id: p.mini_group_id,
      group_name: p.mini_group_id ? groupName.get(p.mini_group_id) ?? null : null,
      byCategory: Object.fromEntries([...a.cat.entries()].filter(([, c]) => c !== 0).map(([k, c]) => [k, fromCents(c)])),
      tripSpend: fromCents(spend),
      prepaid: a.lines,
      prepaidPaid: fromCents(a.paid),
      prepaidDue: fromCents(a.due),
      prepaidByCurrency: a.cur,
      total: fromCents(spend + a.paid + a.due),
    };
  });

  const groups = new Map<string, GroupTotal & { _c: [number, number, number] }>();
  for (const p of people) {
    const id = p.group_id ?? p.participant_id;
    let g = groups.get(id);
    if (!g) {
      g = { id, name: p.group_name ?? p.name, member_ids: [], tripSpend: 0, prepaidPaid: 0, prepaidDue: 0, total: 0, _c: [0, 0, 0] };
      groups.set(id, g);
    }
    g.member_ids.push(p.participant_id);
    g._c[0] += toCents(p.tripSpend);
    g._c[1] += toCents(p.prepaidPaid);
    g._c[2] += toCents(p.prepaidDue);
  }

  const sum = (f: (p: PersonTotal) => number) => fromCents(people.reduce((x, p) => x + toCents(f(p)), 0));
  return {
    people,
    groups: [...groups.values()].map(({ _c, ...g }) => ({
      ...g,
      tripSpend: fromCents(_c[0]),
      prepaidPaid: fromCents(_c[1]),
      prepaidDue: fromCents(_c[2]),
      total: fromCents(_c[0] + _c[1] + _c[2]),
    })),
    tripSpend: sum((p) => p.tripSpend),
    prepaidPaid: sum((p) => p.prepaidPaid),
    prepaidDue: sum((p) => p.prepaidDue),
    total: sum((p) => p.total),
    byCategory: [...catAll.entries()]
      .filter(([, c]) => c !== 0)
      .map(([category, c]) => ({ category, amount: fromCents(c) }))
      .sort((a, b) => b.amount - a.amount),
    prepaidByCurrency: curAll,
  };
}
