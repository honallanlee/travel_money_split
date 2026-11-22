"use client";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { formatMoney, round2 } from "@/lib/settlement";
import { CATEGORIES, CURRENCIES, PREPAID_STATUSES, type PrepaidItem, type PrepaidStatus, type TripBundle } from "@/lib/types";
import type { RunMutation } from "./TripApp";
import { Button, cx, Field, inputBase, inputCls, Modal } from "./ui";

const STATUS_LABEL: Record<PrepaidStatus, { label: string; hint: string }> = {
  paid: { label: "Paid & settled", hint: "Already paid and sorted out between you. Counts in totals only." },
  due: { label: "To pay", hint: "Not paid yet (e.g. pay at the hotel). Use “Record payment” when it is paid." },
  recorded: { label: "Logged as an expense", hint: "Paid during the trip and logged in the app, so it isn't counted twice." },
};

/** Add or edit a cost settled outside the app (hotel, flight…), with an amount per person. */
export default function PrepaidModal({
  bundle,
  item,
  run,
  onClose,
}: {
  bundle: TripBundle;
  item: PrepaidItem | null;
  run: RunMutation;
  onClose: () => void;
}) {
  const { t } = useT();
  const base = bundle.trip.base_currency;
  const people = bundle.participants;
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "Accommodation");
  const [currency, setCurrency] = useState(item?.currency ?? base);
  const [rate, setRate] = useState(String(item?.exchange_rate_to_base ?? 1));
  const [status, setStatus] = useState<PrepaidStatus>(item?.status ?? "paid");
  const [date, setDate] = useState(item?.date ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries((item?.shares ?? []).map((s) => [s.participant_id, String(s.amount)])),
  );
  const [fill, setFill] = useState("");
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const foreign = currency !== base;
  const total = round2(people.reduce((a, p) => a + (Number(amounts[p.id]) || 0), 0));

  const fetchRate = async () => {
    setRateMsg(t("Fetching…"));
    try {
      const r = await api<{ date: string; rates: Record<string, number> }>(`/api/rates?base=${currency}`);
      const x = r.rates[base];
      if (!x) throw new Error();
      setRate(String(round2(x * 10000) / 10000));
      setRateMsg(t("Rate on {date}", { date: r.date }));
    } catch {
      setRateMsg(t("Exchange rates are unavailable right now — enter a rate manually"));
    }
  };

  const save = async () => {
    const shares = people.map((p) => ({ participant_id: p.id, amount: Number(amounts[p.id]) || 0 })).filter((s) => s.amount > 0);
    if (!title.trim()) return setError(t("Add a description"));
    if (shares.length === 0) return setError(t("Enter at least one amount"));
    if (foreign && !(Number(rate) > 0)) return setError(t("Enter the exchange rate"));
    setSaving(true);
    const body = {
      trip_id: bundle.trip.id,
      title: title.trim(),
      category,
      currency,
      exchange_rate_to_base: foreign ? Number(rate) : 1,
      status,
      date: date || null,
      note: note.trim() || null,
      shares,
      ...(status !== "recorded" ? { transaction_id: null } : {}),
    };
    const ok = await run(() => (item ? api(`/api/prepaid/${item.id}`, "PUT", body) : api("/api/prepaid", "POST", body)), "Saved");
    setSaving(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (!item || !confirm(t('Delete "{name}"?', { name: item.title }))) return;
    if (await run(() => api(`/api/prepaid/${item.id}`, "DELETE"), "Deleted")) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? t("Edit cost") : t("Add a cost paid outside the app")}
      footer={
        <div className="flex gap-2">
          {item && (
            <Button variant="danger" onClick={remove} aria-label={t("Delete")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={saving}>
            {t("Save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t("Description")}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Hotel, night of 14 Dec")} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Category")}>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Date")}>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Currency")}>
            <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([base, currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {foreign && (
            <Field label={t("1 {from} = ? {to}", { from: currency, to: base })} hint={rateMsg ?? undefined}>
              <div className="flex gap-1">
                <input type="number" inputMode="decimal" step="any" min="0" className={cx(inputBase, "w-full min-w-0")} value={rate} onChange={(e) => setRate(e.target.value)} />
                <button type="button" onClick={fetchRate} className="rounded-xl px-2 ring-1 ring-line" aria-label={t("Use today's rate")} title={t("Use today's rate")}>
                  <RefreshCw className="h-4 w-4 text-ink-2" />
                </button>
              </div>
            </Field>
          )}
        </div>
        <Field label={t("Status")} hint={t(STATUS_LABEL[status].hint)}>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-200/70 p-1">
            {PREPAID_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cx("rounded-lg px-1 py-1.5 text-[11px] font-semibold leading-tight", status === s ? "bg-surface shadow-sm" : "text-ink-2")}
              >
                {t(STATUS_LABEL[s].label)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("Note (optional)")}>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Pay at the hotel in yen")} />
        </Field>

        <div>
          <div className="mb-1 flex items-end justify-between gap-2">
            <span className="text-xs font-medium text-ink-2">{t("Amount per person ({currency})", { currency })}</span>
            <span className="flex gap-1">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className={cx(inputBase, "w-24 py-1 text-sm")}
                placeholder={t("Same for all")}
                value={fill}
                onChange={(e) => setFill(e.target.value)}
                aria-label={t("Same for all")}
              />
              <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!fill} onClick={() => setAmounts(Object.fromEntries(people.map((p) => [p.id, fill])))}>
                {t("Fill")}
              </Button>
            </span>
          </div>
          <div className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
            {people.map((p) => (
              <label key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span>{p.name}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className={cx(inputBase, "w-28 py-1 text-right")}
                  value={amounts[p.id] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-right text-xs text-ink-2">
            {t("Total")}: <b className="tabular">{formatMoney(total, currency)}</b>
            {foreign && Number(rate) > 0 && <span className="text-ink-3"> ≈ {formatMoney(total * Number(rate), base)}</span>}
          </p>
        </div>
        {error && <p className="text-sm text-neg">{error}</p>}
      </div>
    </Modal>
  );
}
