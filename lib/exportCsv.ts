import type { TripBundle } from "./types";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Spreadsheet-friendly transaction list (one row per transaction, shares as columns). */
export function buildTransactionsCsv(b: TripBundle, t: (k: string) => string = (k) => k): string {
  const people = b.participants;
  const name = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const header = [
    t("Date"),
    t("Type"),
    t("Description"),
    t("Category"),
    t("Amount"),
    t("Currency"),
    t("Exchange rate"),
    `${t("Amount")} (${b.trip.base_currency})`,
    t("Paid by"),
    ...people.map((p) => `${t("Share")}: ${p.name}`),
  ];
  const rows = [...b.transactions]
    .sort((a, c) => a.occurred_at.localeCompare(c.occurred_at))
    .map((tx) => {
      const shares = Object.fromEntries(tx.splits.map((s) => [s.participant_id, s.share_amount_base]));
      return [
        tx.occurred_at.slice(0, 10),
        tx.type,
        tx.title,
        tx.type === "CASH_DEPOSIT" || tx.type === "CASH_PAYOUT" || tx.type === "TRANSFER" ? "" : t(tx.category),
        tx.amount_local,
        tx.currency,
        tx.exchange_rate_to_base,
        tx.amount_base,
        tx.paid_by_participant_id ? name[tx.paid_by_participant_id] ?? "" : "",
        ...people.map((p) => shares[p.id] ?? ""),
      ];
    });
  // BOM so Excel opens UTF-8 (Chinese names) correctly
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
