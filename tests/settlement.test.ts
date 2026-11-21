import { describe, expect, it } from "vitest";
import {
  allocateCents,
  computeCashPool,
  computeLedger,
  computeParticipantBalances,
  formatWhatsAppSummary,
  KITTY_ID,
  rollupEntities,
  simplifyDebts,
  splitByLineItems,
  splitEqually,
  splitSharesBetweenParts,
  currencyDecimals,
  roundTo,
} from "@/lib/settlement";
import type { MiniGroup, Participant, Transaction, TxType } from "@/lib/types";

const T = "trip";
const p = (id: string, group: string | null = null, treasurer = false): Participant => ({
  id,
  trip_id: T,
  mini_group_id: group,
  name: id[0].toUpperCase() + id.slice(1),
  is_treasurer: treasurer,
});
let n = 0;
const tx = (
  type: TxType,
  amount: number,
  payer: string | null,
  splits: Record<string, number> = {},
  rate = 1,
): Transaction => ({
  id: `t${++n}`,
  trip_id: T,
  type,
  title: type,
  category: "Other",
  amount_local: amount / rate,
  currency: rate === 1 ? "GBP" : "EUR",
  exchange_rate_to_base: rate,
  amount_base: amount,
  paid_by_participant_id: payer,
  receipt_url: null,
  line_items: null,
  occurred_at: "2026-06-01T12:00:00Z",
  splits: Object.entries(splits).map(([participant_id, share_amount_base]) => ({ participant_id, share_amount_base })),
});

const people = [p("alice", "smith", true), p("bob", "smith"), p("charlie"), p("dave")];
const groups: MiniGroup[] = [{ id: "smith", trip_id: T, name: "Smith Family" }];
const sumNet = (b: Record<string, { net: number }>) => Math.round(Object.values(b).reduce((a, x) => a + x.net, 0) * 100) / 100;

describe("allocation helpers", () => {
  it("allocateCents always sums to total", () => {
    expect(allocateCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocateCents(1, [1, 1])).toEqual([1, 0]);
    expect(allocateCents(1000, [0, 0])).toEqual([500, 500]);
    expect(allocateCents(-1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-1000);
  });

  it("splitEqually distributes remainder cents", () => {
    const s = splitEqually(10, ["a", "b", "c"]);
    expect(s.map((x) => x.share_amount_base)).toEqual([3.34, 3.33, 3.33]);
  });

  it("splitByLineItems divides items and scales for tax/tip", () => {
    // 20 for alice, 10 shared alice/bob → alice 25, bob 5 → subtotal 30, total 33 (10% service)
    const { splits, unassignedAmount } = splitByLineItems(33, [
      { amount: 20, assignees: ["alice"] },
      { amount: 10, assignees: ["alice", "bob"] },
    ]);
    expect(unassignedAmount).toBe(0);
    const m = Object.fromEntries(splits.map((s) => [s.participant_id, s.share_amount_base]));
    expect(m).toEqual({ alice: 27.5, bob: 5.5 });
  });

  it("splitByLineItems reports unassigned items", () => {
    const { unassignedAmount } = splitByLineItems(15, [
      { amount: 10, assignees: ["alice"] },
      { amount: 5, assignees: [] },
    ]);
    expect(unassignedAmount).toBe(5);
  });
});

describe("cash pool", () => {
  it("deposits increase and cash expenses decrease the pool; card does not touch it", () => {
    const txs = [
      tx("CASH_DEPOSIT", 100, "alice"),
      tx("CASH_DEPOSIT", 50, "charlie"),
      tx("CASH_EXPENSE", 30, null, { alice: 15, charlie: 15 }),
      tx("CARD_EXPENSE", 200, "dave", { alice: 100, dave: 100 }),
    ];
    expect(computeCashPool(txs)).toEqual({ deposits: 150, expenses: 30, payouts: 0, refunds: 0, balance: 120 });
  });

  it("uses amount_base for foreign-currency cash", () => {
    const txs = [tx("CASH_DEPOSIT", 85, "alice", {}, 0.85), tx("CASH_EXPENSE", 42.5, null, { alice: 42.5 }, 0.85)];
    expect(computeCashPool(txs).balance).toBe(42.5);
  });
});

describe("participant balances", () => {
  it("credits deposits, credits card payer, debits shares", () => {
    const txs = [
      tx("CASH_DEPOSIT", 100, "alice"),
      tx("CASH_EXPENSE", 60, "alice", { alice: 20, bob: 20, charlie: 20 }),
      tx("CARD_EXPENSE", 90, "charlie", { alice: 30, bob: 30, charlie: 30 }),
    ];
    const b = computeParticipantBalances(people, txs);
    expect(b.alice).toMatchObject({ deposits: 100, card_paid: 0, shares: 50, net: 50 });
    expect(b.bob).toMatchObject({ deposits: 0, card_paid: 0, shares: 50, net: -50 });
    expect(b.charlie).toMatchObject({ deposits: 0, card_paid: 90, shares: 50, net: 40 });
    expect(b.dave.net).toBe(0);
  });

  it("cash expense does not credit the treasurer even if marked as payer", () => {
    const b = computeParticipantBalances(people, [tx("CASH_EXPENSE", 40, "alice", { bob: 40 })]);
    expect(b.alice.net).toBe(0);
    expect(b.bob.net).toBe(-40);
  });

  it("sum of net balances equals the cash pool balance", () => {
    const txs = [
      tx("CASH_DEPOSIT", 200, "alice"),
      tx("CASH_DEPOSIT", 100, "dave"),
      tx("CASH_EXPENSE", 99.99, null, { alice: 33.33, bob: 33.33, dave: 33.33 }),
      tx("CARD_EXPENSE", 10, "bob", { charlie: 10 }),
    ];
    const b = computeParticipantBalances(people, txs);
    expect(sumNet(b)).toBe(computeCashPool(txs).balance);
  });

  it("ignores splits for unknown (deleted) participants", () => {
    const b = computeParticipantBalances(people, [tx("CARD_EXPENSE", 20, "ghost", { ghost: 10, bob: 10 })]);
    expect(b.bob.net).toBe(-10);
    expect(b.ghost).toBeUndefined();
  });
});

describe("mini-group rollup", () => {
  it("sums family members and keeps solos standalone", () => {
    const txs = [tx("CARD_EXPENSE", 120, "charlie", { alice: 30, bob: 30, charlie: 30, dave: 30 })];
    const ents = rollupEntities(people, groups, computeParticipantBalances(people, txs));
    const byId = Object.fromEntries(ents.map((e) => [e.id, e]));
    expect(byId.smith).toMatchObject({ kind: "group", name: "Smith Family", member_ids: ["alice", "bob"], net: -60 });
    expect(byId.charlie).toMatchObject({ kind: "solo", net: 90 });
    expect(byId.dave.net).toBe(-30);
  });
});

describe("debt simplification", () => {
  it("pairs largest debtor with largest creditor", () => {
    const t = simplifyDebts([
      { id: "a", name: "A", net: 50 },
      { id: "b", name: "B", net: -30 },
      { id: "c", name: "C", net: -20 },
    ]);
    expect(t).toEqual([
      { from_id: "b", from_name: "B", to_id: "a", to_name: "A", amount: 30 },
      { from_id: "c", from_name: "C", to_id: "a", to_name: "A", amount: 20 },
    ]);
  });

  it("ignores sub-penny residue and produces at most n-1 transfers", () => {
    const t = simplifyDebts([
      { id: "a", name: "A", net: 33.33 },
      { id: "b", name: "B", net: 33.34 },
      { id: "c", name: "C", net: -66.67 },
      { id: "d", name: "D", net: 0.004 },
    ]);
    expect(t.length).toBe(2);
    expect(t.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(66.67, 2);
  });

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts([{ id: "a", name: "A", net: 0 }])).toEqual([]);
  });
});

describe("full ledger", () => {
  it("leftover kitty cash is returned via the Cash Kitty party", () => {
    const txs = [
      tx("CASH_DEPOSIT", 100, "alice"),
      tx("CASH_DEPOSIT", 100, "charlie"),
      tx("CASH_EXPENSE", 120, null, { alice: 30, bob: 30, charlie: 30, dave: 30 }),
    ];
    const l = computeLedger({ participants: people, mini_groups: groups, transactions: txs });
    expect(l.pool.balance).toBe(80);
    expect(l.treasurerName).toBe("Alice");
    // Smith +100-60=40, Charlie +70, Dave -30, Kitty -80
    const kitty = l.settlementParties.find((x) => x.id === KITTY_ID)!;
    expect(kitty.net).toBe(-80);
    const total = (id: string, dir: "from_id" | "to_id") =>
      l.transfers.filter((t) => t[dir] === id).reduce((a, t) => a + t.amount, 0);
    expect(total(KITTY_ID, "from_id")).toBe(80);
    expect(total("dave", "from_id")).toBe(30);
    expect(total("smith", "to_id")).toBe(40);
    expect(total("charlie", "to_id")).toBe(70);
  });

  it("no kitty party when the pool is empty", () => {
    const l = computeLedger({
      participants: people,
      mini_groups: groups,
      transactions: [tx("CARD_EXPENSE", 40, "dave", { alice: 20, charlie: 20 })],
    });
    expect(l.settlementParties.some((x) => x.kind === "kitty")).toBe(false);
    expect(l.transfers).toHaveLength(2);
  });

  it("formats a WhatsApp summary", () => {
    const l = computeLedger({
      participants: people,
      mini_groups: groups,
      transactions: [tx("CARD_EXPENSE", 40, "dave", { charlie: 40 })],
    });
    const s = formatWhatsAppSummary("Lisbon", "GBP", l);
    expect(s).toContain("*Lisbon — Settle Up*");
    expect(s).toContain("Charlie pays Dave £40.00");
  });
});

describe("whole-unit currencies (JPY)", () => {
  it("knows JPY has no minor unit", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("GBP")).toBe(2);
    expect(roundTo(1234.56, 0)).toBe(1235);
  });

  it("splits yen into whole yen", () => {
    expect(splitEqually(1000, ["a", "b", "c"], 0).map((s) => s.share_amount_base)).toEqual([334, 333, 333]);
  });

  it("itemised yen split stays whole and sums to the total", () => {
    const { splits } = splitByLineItems(
      3300,
      [
        { amount: 2000, assignees: ["a"] },
        { amount: 1000, assignees: ["a", "b", "c"] },
      ],
      0,
    );
    expect(splits.every((s) => Number.isInteger(s.share_amount_base))).toBe(true);
    expect(splits.reduce((a, s) => a + s.share_amount_base, 0)).toBe(3300);
  });

  it("puts a non-whole total's leftover on the largest share", () => {
    expect(allocateCents(100050, [1, 1], 100).reduce((a, b) => a + b)).toBe(100050);
  });
});

describe("kitty payouts (CASH_PAYOUT)", () => {
  it("reimbursing a card payer from the kitty lowers the pool and clears what they're owed", () => {
    const txs = [
      tx("CASH_DEPOSIT", 300, "alice"),
      tx("CARD_EXPENSE", 120, "dave", { alice: 30, bob: 30, charlie: 30, dave: 30 }), // Dave owed 90
      tx("CASH_PAYOUT", 90, "dave"), // kitty pays Dave back
    ];
    const pool = computeCashPool(txs);
    expect(pool).toEqual({ deposits: 300, expenses: 0, payouts: 90, refunds: 0, balance: 210 });
    const b = computeParticipantBalances(people, txs);
    expect(b.dave).toMatchObject({ card_paid: 120, shares: 30, received: 90, net: 0 });
    expect(sumNet(b)).toBe(pool.balance); // invariant still holds
  });

  it("settling up from leftover kitty cash zeroes the plan", () => {
    const base = [
      tx("CASH_DEPOSIT", 100, "alice"),
      tx("CASH_DEPOSIT", 100, "charlie"),
      tx("CASH_EXPENSE", 120, null, { alice: 30, bob: 30, charlie: 30, dave: 30 }),
    ];
    const before = computeLedger({ participants: people, mini_groups: groups, transactions: base });
    // Record exactly what the plan says the kitty should pay out; Dave pays his share into the kitty.
    const payouts = before.transfers
      .filter((x) => x.from_id === KITTY_ID)
      .map((x) => tx("CASH_PAYOUT", x.amount, x.to_id === "smith" ? "alice" : x.to_id));
    const daveIn = before.transfers.filter((x) => x.from_id === "dave").map((x) => x);
    expect(daveIn.length).toBeGreaterThan(0);
    const after = computeLedger({
      participants: people,
      mini_groups: groups,
      transactions: [...base, ...payouts, tx("CASH_DEPOSIT", 30, "dave"),
        // the kitty then passes Dave's 30 on to whoever it was meant for
        ...daveIn.map((x) => tx("CASH_PAYOUT", x.amount, x.to_id === "smith" ? "alice" : x.to_id))],
    });
    expect(after.transfers).toEqual([]);
    expect(after.pool.balance).toBe(0);
  });

  it("payouts are not counted as spending", async () => {
    const { categoryTotals, keyMetrics } = await import("@/lib/analytics");
    const txs = [tx("CASH_EXPENSE", 60, null, { alice: 60 }), tx("CASH_PAYOUT", 500, "bob"), tx("CASH_DEPOSIT", 600, "alice")];
    expect(categoryTotals(txs)).toEqual([{ category: "Other", amount: 60 }]);
    expect(keyMetrics(txs, 4).total).toBe(60);
  });
});

describe("direct settle-up payments (TRANSFER)", () => {
  it("paying someone directly clears both sides and leaves the kitty alone", () => {
    const base = [tx("CARD_EXPENSE", 100, "charlie", { charlie: 50, dave: 50 })]; // Dave owes Charlie 50
    const before = computeLedger({ participants: people, mini_groups: groups, transactions: base });
    expect(before.transfers).toEqual([{ from_id: "dave", from_name: "Dave", to_id: "charlie", to_name: "Charlie", amount: 50 }]);
    const after = computeLedger({
      participants: people,
      mini_groups: groups,
      transactions: [...base, tx("TRANSFER", 50, "dave", { charlie: 50 })],
    });
    expect(after.balances.dave).toMatchObject({ settled: 50, net: 0 });
    expect(after.balances.charlie).toMatchObject({ settled: -50, net: 0 });
    expect(after.pool.balance).toBe(0);
    expect(after.transfers).toEqual([]);
  });
});

describe("refunds (REFUND)", () => {
  it("cash refund into the kitty raises the pool and gives shares back", () => {
    const txs = [
      tx("CASH_DEPOSIT", 100, "alice"),
      tx("CASH_EXPENSE", 60, null, { alice: 30, bob: 30 }),
      tx("REFUND", 20, null, { alice: 10, bob: 10 }),
    ];
    const pool = computeCashPool(txs);
    expect(pool).toMatchObject({ refunds: 20, balance: 60 });
    const b = computeParticipantBalances(people, txs);
    expect(b.alice).toMatchObject({ shares: 20, net: 80 });
    expect(b.bob).toMatchObject({ shares: 20, net: -20 });
    expect(sumNet(b)).toBe(pool.balance);
  });

  it("card refund reduces the payer's outlay, not the kitty", () => {
    const txs = [tx("CARD_EXPENSE", 90, "dave", { charlie: 45, dave: 45 }), tx("REFUND", 30, "dave", { charlie: 15, dave: 15 })];
    const b = computeParticipantBalances(people, txs);
    expect(b.dave).toMatchObject({ card_paid: 60, shares: 30, net: 30 });
    expect(b.charlie.net).toBe(-30);
    expect(computeCashPool(txs).balance).toBe(0);
  });

  it("refunds count as negative spending in analytics", async () => {
    const { categoryTotals, keyMetrics } = await import("@/lib/analytics");
    const t1 = { ...tx("CASH_EXPENSE", 60, null, { alice: 60 }), category: "Shopping" };
    const t2 = { ...tx("REFUND", 20, null, { alice: 20 }), category: "Shopping" };
    expect(categoryTotals([t1, t2])).toEqual([{ category: "Shopping", amount: 40 }]);
    expect(keyMetrics([t1, t2], 1)).toMatchObject({ total: 40, cash: 40 });
  });
});

describe("split payment (part kitty, part card)", () => {
  it("divides each share between the parts and both add up exactly", () => {
    const shares = [
      { participant_id: "a", share_amount_base: 4000 },
      { participant_id: "b", share_amount_base: 3000 },
      { participant_id: "c", share_amount_base: 3000 },
    ];
    const { part, rest } = splitSharesBetweenParts(shares, 3333, 0); // ¥3,333 on card, ¥6,667 from kitty
    expect(part.reduce((x, s) => x + s.share_amount_base, 0)).toBe(3333);
    expect(rest.reduce((x, s) => x + s.share_amount_base, 0)).toBe(6667);
    expect([...part, ...rest].every((s) => Number.isInteger(s.share_amount_base))).toBe(true);
    // each person still pays their full share across both parts
    for (const s of shares) {
      const total = [...part, ...rest].filter((x) => x.participant_id === s.participant_id).reduce((x, y) => x + y.share_amount_base, 0);
      expect(total).toBe(s.share_amount_base);
    }
  });
});
