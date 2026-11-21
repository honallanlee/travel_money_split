import { describe, expect, it } from "vitest";
import { backupFilename, bundleToBackup } from "@/lib/backup";
import { buildTransactionsCsv } from "@/lib/exportCsv";
import { translate } from "@/lib/i18n";
import { formatWhatsAppSummary, computeLedger } from "@/lib/settlement";
import type { TripBundle } from "@/lib/types";

const bundle: TripBundle = {
  trip: { id: "trip", name: "東京 Trip", base_currency: "JPY" },
  mini_groups: [{ id: "g1", trip_id: "trip", name: "陳家" }],
  participants: [
    { id: "a", trip_id: "trip", mini_group_id: "g1", name: "Alice", is_treasurer: true, avatar_media_id: "m1" },
    { id: "b", trip_id: "trip", mini_group_id: null, name: 'Bob "B"', is_treasurer: false },
  ],
  transactions: [
    {
      id: "t1",
      trip_id: "trip",
      type: "CASH_EXPENSE",
      title: "Ramen, gyoza",
      category: "Food & Drink",
      amount_local: 3000,
      currency: "JPY",
      exchange_rate_to_base: 1,
      amount_base: 3000,
      paid_by_participant_id: "a",
      receipt_url: null,
      line_items: null,
      occurred_at: "2026-04-03T12:00:00.000Z",
      created_at: "2026-04-03T12:00:00.000Z",
      splits: [
        { id: "s1", participant_id: "a", share_amount_base: 1500 },
        { id: "s2", participant_id: "b", share_amount_base: 1500 },
      ],
    },
  ],
  budget_items: [{ id: "b1", trip_id: "trip", category: "Food & Drink", planned_amount_base: 50000, notes: null }],
  photos: [],
};

describe("backup export", () => {
  it("produces a portable backup without server-only fields", () => {
    const b = bundleToBackup(bundle);
    expect(b.format).toBe("trip-kitty-backup");
    expect(b.version).toBe(1);
    expect(b.participants[0]).toEqual({ id: "a", name: "Alice", mini_group_id: "g1", is_treasurer: true });
    expect(b.transactions[0].splits).toEqual([
      { participant_id: "a", share_amount_base: 1500 },
      { participant_id: "b", share_amount_base: 1500 },
    ]);
    expect(JSON.stringify(b)).not.toContain("avatar_media_id");
    expect(b.budget_items[0]).toEqual({ category: "Food & Drink", planned_amount_base: 50000, notes: null });
  });

  it("makes safe filenames, keeping Chinese characters", () => {
    expect(backupFilename("東京 Trip!", "json")).toMatch(/^東京-Trip-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe("CSV export", () => {
  it("escapes commas/quotes and adds a UTF-8 BOM", () => {
    const csv = buildTransactionsCsv(bundle);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Ramen, gyoza"');
    expect(csv).toContain('"Share: Bob ""B"""');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("translations", () => {
  it("translates with interpolation and falls back to English", () => {
    expect(translate("zh-Hant", "{n} travellers", { n: 5 })).toBe("5 位旅伴");
    expect(translate("en", "{n} travellers", { n: 5 })).toBe("5 travellers");
    expect(translate("zh-Hant", "Food & Drink")).toBe("餐飲");
  });

  it("produces a Chinese WhatsApp summary", () => {
    const t = (k: string, v?: Record<string, string | number>) => translate("zh-Hant", k, v);
    const s = formatWhatsAppSummary("東京", "JPY", computeLedger(bundle), { t });
    expect(s).toContain("*東京 — 結算*");
    expect(s).toContain("付給");
  });
});
