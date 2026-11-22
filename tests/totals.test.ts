import { describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { nextState, PER_IP } from "@/lib/loginGuard";
import { computeTripTotals } from "@/lib/personTotals";
import { telE164 } from "@/lib/phone";
import { computeLedger } from "@/lib/settlement";
import type { Participant, PrepaidItem, Transaction, TripBundle } from "@/lib/types";

const P = (id: string, g: string | null = null): Participant => ({ id, trip_id: "t", mini_group_id: g, name: id.toUpperCase(), is_treasurer: id === "a" });
const tx = (o: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  trip_id: "t",
  type: "CASH_EXPENSE",
  title: "x",
  category: "Food & Drink",
  amount_local: 0,
  currency: "JPY",
  exchange_rate_to_base: 1,
  amount_base: 0,
  paid_by_participant_id: null,
  receipt_url: null,
  line_items: null,
  occurred_at: "2026-12-12",
  splits: [],
  ...o,
});
const pre = (o: Partial<PrepaidItem>): PrepaidItem => ({
  id: Math.random().toString(36),
  trip_id: "t",
  title: "Hotel",
  category: "Accommodation",
  currency: "HKD",
  exchange_rate_to_base: 20,
  status: "paid",
  date: null,
  note: null,
  shares: [],
  transaction_id: null,
  sort: 0,
  ...o,
});

const bundle: Pick<TripBundle, "trip" | "participants" | "mini_groups" | "transactions" | "prepaid_items"> = {
  trip: { id: "t", name: "T", base_currency: "JPY" },
  participants: [P("a", "g1"), P("b", "g1"), P("c")],
  mini_groups: [{ id: "g1", trip_id: "t", name: "Fam" }],
  transactions: [
    tx({ type: "CASH_DEPOSIT", amount_base: 9000, paid_by_participant_id: "a" }),
    tx({ amount_base: 3000, splits: [{ participant_id: "a", share_amount_base: 1000 }, { participant_id: "b", share_amount_base: 1000 }, { participant_id: "c", share_amount_base: 1000 }] }),
    tx({ type: "CARD_EXPENSE", category: "Transport", amount_base: 600, paid_by_participant_id: "c", splits: [{ participant_id: "a", share_amount_base: 300 }, { participant_id: "c", share_amount_base: 300 }] }),
    tx({ type: "REFUND", amount_base: 300, splits: [{ participant_id: "a", share_amount_base: 300 }] }),
  ],
  prepaid_items: [
    pre({ shares: [{ participant_id: "a", amount: 500 }, { participant_id: "c", amount: 850 }] }),
    pre({ currency: "JPY", exchange_rate_to_base: 1, status: "due", shares: [{ participant_id: "a", amount: 18000 }] }),
    pre({ currency: "JPY", exchange_rate_to_base: 1, status: "recorded", shares: [{ participant_id: "b", amount: 99999 }] }),
  ],
};

describe("computeTripTotals", () => {
  const tt = computeTripTotals(bundle);
  const a = tt.people.find((p) => p.participant_id === "a")!;
  it("adds app shares by category, minus refunds", () => {
    expect(a.byCategory).toEqual({ "Food & Drink": 700, Transport: 300 });
    expect(a.tripSpend).toBe(1000);
  });
  it("adds prepaid (converted) and due costs; ignores recorded ones", () => {
    expect(a.prepaidPaid).toBe(10000);
    expect(a.prepaidDue).toBe(18000);
    expect(a.total).toBe(29000);
    expect(a.prepaidByCurrency).toEqual({ HKD: { paid: 500, due: 0 }, JPY: { paid: 0, due: 18000 } });
    expect(tt.people.find((p) => p.participant_id === "b")!.prepaidPaid).toBe(0);
  });
  it("totals add up across people and families", () => {
    expect(tt.total).toBe(tt.people.reduce((x, p) => x + p.total, 0));
    expect(tt.groups.find((g) => g.id === "g1")!.member_ids).toEqual(["a", "b"]);
    expect(tt.prepaidByCurrency.HKD.paid).toBe(1350);
  });
  it("never changes the settlement ledger", () => {
    const l = computeLedger(bundle);
    expect(l.entities.reduce((x, e) => x + e.net, 0)).toBeCloseTo(l.pool.balance, 2);
  });
});

describe("individual settlement", () => {
  it("settles each person separately, with the same nets", () => {
    const fam = computeLedger(bundle);
    const ind = computeLedger(bundle, { individual: true });
    expect(fam.entities).toHaveLength(2);
    expect(ind.entities).toHaveLength(3);
    expect(ind.entities.every((e) => e.kind === "solo")).toBe(true);
    const sum = (es: { net: number }[]) => es.reduce((x, e) => x + e.net, 0);
    expect(sum(ind.entities)).toBeCloseTo(sum(fam.entities), 2);
  });
});

describe("todayIn", () => {
  it("uses the trip's time zone, not UTC", () => {
    // 23:30 UTC on 12 Dec = 08:30 on 13 Dec in Japan
    const now = new Date("2026-12-12T23:30:00Z");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-12-13");
    expect(todayIn("Europe/London", now)).toBe("2026-12-12");
  });
});

describe("telE164", () => {
  it("adds +81 to Japanese local numbers", () => {
    expect(telE164("022-212-1129")).toBe("+81222121129");
    expect(telE164("+81 3 3343 3111")).toBe("+81333433111");
    expect(telE164("0081-3-1234")).toBe("+8131234");
  });
});

describe("login lockout counter", () => {
  it("locks after 5 failures within the window and resets after it", () => {
    let s = null as ReturnType<typeof nextState> | null;
    const t0 = Date.parse("2026-12-01T00:00:00Z");
    for (let i = 0; i < 4; i++) s = nextState(s, PER_IP, t0 + i * 1000);
    expect(s!.locked_until).toBeNull();
    s = nextState(s, PER_IP, t0 + 5000);
    expect(Date.parse(s.locked_until!)).toBe(t0 + 5000 + PER_IP.lockMs);
    const later = nextState({ failures: 3, window_start: new Date(t0).toISOString(), locked_until: null }, PER_IP, t0 + PER_IP.windowMs + 1);
    expect(later.failures).toBe(1);
  });
});

import { OUTSIDE_ID, splitWithinFamily } from "@/lib/settlement";

describe("splitWithinFamily", () => {
  it("shares a family's settlement so every member ends square (example from the demo trip)", () => {
    // Charlie is owed 271,834, Dana owes 136,496 → the family receives 135,338 in the plan
    const x = splitWithinFamily([
      { id: "c", name: "Charlie", net: 271834 },
      { id: "d", name: "Dana", net: -136496 },
    ]);
    expect(x).toContainEqual(expect.objectContaining({ from_id: OUTSIDE_ID, to_id: "c", amount: 135338 }));
    expect(x).toContainEqual(expect.objectContaining({ from_id: "d", to_id: "c", amount: 136496 }));
    // everyone square afterwards
    const net: Record<string, number> = { c: 271834, d: -136496, [OUTSIDE_ID]: -135338 };
    for (const t of x) { net[t.from_id] += t.amount; net[t.to_id] -= t.amount; }
    expect(Object.values(net).every((v) => Math.abs(v) < 0.01)).toBe(true);
  });
});
