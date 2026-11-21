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
    expect(computeCashPool(txs)).toEqual({ deposits: 150, expenses: 30, balance: 120 });
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
