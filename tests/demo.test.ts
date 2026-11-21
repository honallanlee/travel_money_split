import { beforeAll, describe, expect, it } from "vitest";

// Force the in-memory store so this never touches a real database.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { categoryTotals, keyMetrics } from "@/lib/analytics";
import { getTripBundle, loadDemoTrip } from "@/lib/repo";
import { computeLedger, computeParticipantBalances, toCents } from "@/lib/settlement";
import type { TripBundle } from "@/lib/types";

let b: TripBundle;
beforeAll(async () => {
  const trip = await loadDemoTrip();
  b = await getTripBundle(trip.id);
});

describe("demo trip covers every scenario", () => {
  it("contains each transaction type", () => {
    const types = new Set(b.transactions.map((t) => t.type));
    for (const ty of ["CASH_DEPOSIT", "CASH_EXPENSE", "CARD_EXPENSE", "CASH_PAYOUT", "TRANSFER", "REFUND"]) expect(types).toContain(ty);
  });

  it("every expense/refund's shares add up to its amount; settle-up has one receiver", () => {
    for (const t of b.transactions) {
      if (t.type === "CASH_DEPOSIT" || t.type === "CASH_PAYOUT") expect(t.splits).toHaveLength(0);
      else if (t.type === "TRANSFER") expect(t.splits).toEqual([expect.objectContaining({ share_amount_base: t.amount_base })]);
      else expect(t.splits.reduce((a, s) => a + toCents(s.share_amount_base), 0)).toBe(toCents(t.amount_base));
    }
  });

  it("the split-payment dinner is saved as a kitty part and a card part totalling ¥48,000", () => {
    const parts = b.transactions.filter((t) => t.title.startsWith("Kaiseki dinner"));
    expect(parts.map((p) => p.type).sort()).toEqual(["CARD_EXPENSE", "CASH_EXPENSE"]);
    expect(parts.reduce((a, p) => a + p.amount_base, 0)).toBe(48000);
  });

  it("books balance: Σ net = kitty cash, kitty never negative, everything in whole yen", () => {
    const l = computeLedger(b);
    const sum = Object.values(computeParticipantBalances(b.participants, b.transactions)).reduce((a, x) => a + toCents(x.net), 0);
    expect(sum).toBe(toCents(l.pool.balance));
    expect(l.pool.balance).toBeGreaterThan(0);
    expect(l.transfers.every((x) => Number.isInteger(x.amount))).toBe(true);
    expect(l.transfers.length).toBeGreaterThan(0); // something left to settle, so the Record buttons show
  });

  it("refunds reduce spending; payouts and settle-ups don't count as spending", () => {
    const spend = b.transactions.filter((t) => t.type === "CASH_EXPENSE" || t.type === "CARD_EXPENSE").reduce((a, t) => a + t.amount_base, 0);
    const refunds = b.transactions.filter((t) => t.type === "REFUND").reduce((a, t) => a + t.amount_base, 0);
    expect(keyMetrics(b.transactions, b.participants.length).total).toBe(spend - refunds);
    expect(categoryTotals(b.transactions).reduce((a, c) => a + c.amount, 0)).toBe(spend - refunds);
  });
});
