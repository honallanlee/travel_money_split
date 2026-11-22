import type { TripBackup, TripBundle } from "./types";

/** Portable JSON backup of a trip. Pure, so it also works from the offline copy. */
export function bundleToBackup(b: TripBundle): TripBackup {
  return {
    format: "trip-kitty-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    trip: { name: b.trip.name, base_currency: b.trip.base_currency },
    mini_groups: b.mini_groups.map((g) => ({ id: g.id, name: g.name })),
    participants: b.participants.map((p) => ({ id: p.id, name: p.name, mini_group_id: p.mini_group_id, is_treasurer: p.is_treasurer })),
    transactions: b.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      category: t.category,
      amount_local: t.amount_local,
      currency: t.currency,
      exchange_rate_to_base: t.exchange_rate_to_base,
      amount_base: t.amount_base,
      paid_by_participant_id: t.paid_by_participant_id,
      receipt_url: t.receipt_url,
      line_items: t.line_items,
      occurred_at: t.occurred_at,
      splits: t.splits.map((s) => ({ participant_id: s.participant_id, share_amount_base: s.share_amount_base })),
    })),
    budget_items: b.budget_items.map((x) => ({ category: x.category, planned_amount_base: x.planned_amount_base, notes: x.notes })),
    prepaid_items: (b.prepaid_items ?? []).map((x) => ({
      title: x.title,
      category: x.category,
      currency: x.currency,
      exchange_rate_to_base: x.exchange_rate_to_base,
      // the linked expense is restored as a normal expense, so keep it from being counted twice
      status: x.status,
      date: x.date,
      note: x.note,
      shares: x.shares.map((s) => ({ participant_id: s.participant_id, amount: s.amount })),
      sort: x.sort,
    })),
  };
}

export const backupFilename = (tripName: string, ext: "json" | "csv" | "xlsx") =>
  `${tripName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "trip"}-${new Date().toISOString().slice(0, 10)}.${ext}`;
