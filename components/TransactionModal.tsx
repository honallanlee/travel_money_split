"use client";
import { AlertTriangle, Camera, Loader2, Plus, ScanLine, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, compressImage } from "@/lib/client";
import { currencyDecimals, formatMoney, round2, roundTo, splitByLineItems, splitByWeights, splitEqually, toCents } from "@/lib/settlement";
import { CATEGORIES, CURRENCIES, type OcrResult, type Split, type Transaction, type TripBundle, type TxType } from "@/lib/types";
import { useT } from "@/lib/i18n";
import type { RunMutation } from "./TripApp";
import { Button, cx, Field, inputBase, inputCls, Modal } from "./ui";

export type TxModalState = { mode: "new"; type: TxType; scanFile?: File } | { mode: "edit"; tx: Transaction };
type SplitMode = "equal" | "custom" | "items";
type ItemDraft = { key: number; description: string; amount: string; assignees: string[] };

const TYPE_OPTIONS: { type: TxType; label: string; hint: string }[] = [
  { type: "CASH_EXPENSE", label: "Kitty cash", hint: "Treasurer paid from the cash pool (default)" },
  { type: "CARD_EXPENSE", label: "Card", hint: "Someone paid by card / transfer — they get credited" },
  { type: "CASH_DEPOSIT", label: "Deposit", hint: "Cash handed to the Treasurer" },
];

let itemKey = 0;
const today = () => new Date().toISOString().slice(0, 10);

function initialState(state: TxModalState, bundle: TripBundle) {
  const base = bundle.trip.base_currency;
  const everyone = bundle.participants.map((p) => p.id);
  const treasurer = bundle.participants.find((p) => p.is_treasurer)?.id ?? bundle.participants[0]?.id ?? "";
  if (state.mode === "new") {
    return {
      type: state.type,
      title: "",
      category: "Food & Drink" as string,
      amount: "",
      currency: base,
      rate: "1",
      paidBy: treasurer,
      date: today(),
      mode: "equal" as SplitMode,
      selected: everyone,
      custom: {} as Record<string, string>,
      items: [] as ItemDraft[],
    };
  }
  const tx = state.tx;
  const ids = tx.splits.map((s) => s.participant_id);
  const shares = tx.splits.map((s) => s.share_amount_base);
  const hasAssigned = tx.line_items?.some((li) => li.assignees?.length);
  const isEqual = shares.length > 0 && Math.max(...shares) - Math.min(...shares) <= 0.011;
  const mode: SplitMode = hasAssigned ? "items" : isEqual || shares.length === 0 ? "equal" : "custom";
  return {
    type: tx.type,
    title: tx.title,
    category: tx.category,
    amount: String(tx.amount_local),
    currency: tx.currency,
    rate: String(tx.exchange_rate_to_base),
    paidBy: tx.paid_by_participant_id ?? treasurer,
    date: tx.occurred_at.slice(0, 10),
    mode,
    selected: ids.length ? ids : everyone,
    custom: Object.fromEntries(tx.splits.map((s) => [s.participant_id, String(round2(s.share_amount_base / (tx.exchange_rate_to_base || 1)))])),
    items: (tx.line_items ?? []).map((li) => ({
      key: ++itemKey,
      description: li.description,
      amount: String(li.amount),
      assignees: li.assignees ?? [],
    })),
  };
}

export default function TransactionModal({
  state,
  bundle,
  run,
  onClose,
}: {
  state: TxModalState;
  bundle: TripBundle;
  run: RunMutation;
  onClose: () => void;
}) {
  const { t } = useT();
  const base = bundle.trip.base_currency;
  const people = bundle.participants;
  const nameOf = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);
  const init = useMemo(() => initialState(state, bundle), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [type, setType] = useState<TxType>(init.type);
  const [title, setTitle] = useState(init.title);
  const [category, setCategory] = useState(init.category);
  const [amount, setAmount] = useState(init.amount);
  const [currency, setCurrency] = useState(init.currency);
  const [rate, setRate] = useState(init.rate);
  const [paidBy, setPaidBy] = useState(init.paidBy);
  const [date, setDate] = useState(init.date);
  const [mode, setMode] = useState<SplitMode>(init.mode);
  const [selected, setSelected] = useState<string[]>(init.selected);
  const [custom, setCustom] = useState<Record<string, string>>(init.custom);
  const [items, setItems] = useState<ItemDraft[]>(init.items);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannedOnce = useRef(false);

  const isDeposit = type === "CASH_DEPOSIT";
  // New deposits default to "everyone puts in the same amount"; editing an existing deposit is always one person.
  const [depositMode, setDepositMode] = useState<"everyone" | "single">(state.mode === "new" ? "everyone" : "single");
  const [depositors, setDepositors] = useState<string[]>(() => people.map((p) => p.id));
  const groupDeposit = isDeposit && depositMode === "everyone";
  const foreign = currency !== base;
  const amountLocal = Number(amount) || 0;
  const rateNum = foreign ? Number(rate) || 0 : 1;
  const baseDec = currencyDecimals(base);
  const amountBase = roundTo(amountLocal * rateNum, baseDec);

  // ---- receipt OCR ---------------------------------------------------------
  const scan = useCallback(
    async (file: File) => {
      setScanning(true);
      setScanMsg(null);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      try {
        const blob = await compressImage(file);
        const fd = new FormData();
        fd.append("file", blob, "receipt.jpg");
        const res = await fetch("/api/ocr", { method: "POST", body: fd, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(data.error ?? "Scan failed", res.status);
        const r = data as OcrResult;
        if (r.merchant) setTitle(r.merchant);
        if (r.date) setDate(r.date);
        if (r.total) setAmount(String(r.total));
        if (r.category) setCategory(r.category);
        if (r.currency) {
          setCurrency(r.currency);
          if (r.currency === base) setRate("1");
        }
        if (r.line_items.length) {
          setItems(r.line_items.map((li) => ({ key: ++itemKey, description: li.description, amount: String(li.amount), assignees: [] })));
          setMode("items");
        }
        setScanMsg(
          t("Read {n} items from the receipt — check the details.", { n: r.line_items.length }) +
            (r.currency && r.currency !== base ? " " + t("Set the {from}→{to} rate.", { from: r.currency, to: base }) : ""),
        );
      } catch (e) {
        setScanMsg(t((e as Error).message));
      } finally {
        setScanning(false);
      }
    },
    [base, t],
  );

  useEffect(() => {
    if (state.mode === "new" && state.scanFile && !scannedOnce.current) {
      scannedOnce.current = true;
      scan(state.scanFile);
    }
  }, [state, scan]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // ---- split preview ------------------------------------------------------
  const splitResult = useMemo((): { splits: Split[]; problem: string | null; note?: string } => {
    if (isDeposit) return { splits: [], problem: null };
    if (amountBase <= 0) return { splits: [], problem: t("Enter an amount") };
    if (mode === "equal") {
      if (selected.length === 0) return { splits: [], problem: t("Pick at least one person") };
      const order = people.map((p) => p.id).filter((id) => selected.includes(id));
      return { splits: splitEqually(amountBase, order, baseDec), problem: null };
    }
    if (mode === "custom") {
      const weights: Record<string, number> = {};
      let sum = 0;
      for (const p of people) {
        const v = Number(custom[p.id]) || 0;
        if (v > 0) {
          weights[p.id] = v;
          sum += v;
        }
      }
      const remaining = round2(amountLocal - sum);
      if (Object.keys(weights).length === 0) return { splits: [], problem: t("Enter at least one amount") };
      if (Math.abs(toCents(remaining)) > 0)
        return {
          splits: splitByWeights(amountBase, weights, baseDec),
          problem:
            remaining > 0
              ? t("{amount} left to assign", { amount: formatMoney(remaining, currency) })
              : t("{amount} over the total", { amount: formatMoney(-remaining, currency) }),
        };
      return { splits: splitByWeights(amountBase, weights, baseDec), problem: null };
    }
    // items
    const parsed = items.map((i) => ({ amount: Number(i.amount) || 0, assignees: i.assignees }));
    if (parsed.every((i) => i.amount <= 0)) return { splits: [], problem: t("Add receipt items") };
    const { splits, unassignedAmount } = splitByLineItems(amountBase, parsed, baseDec);
    const subtotal = round2(parsed.reduce((a, i) => a + Math.max(0, i.amount), 0));
    const extra = round2(amountLocal - subtotal);
    const note =
      Math.abs(extra) >= 0.01
        ? t(extra > 0 ? "{amount} tax/tip/service shared proportionally" : "{amount} discount shared proportionally", {
            amount: formatMoney(Math.abs(extra), currency),
          })
        : undefined;
    if (unassignedAmount > 0)
      return { splits, problem: t("{amount} of items not assigned to anyone", { amount: formatMoney(unassignedAmount, currency) }), note };
    return { splits, problem: null, note };
  }, [isDeposit, amountBase, amountLocal, mode, selected, custom, items, people, currency, baseDec, t]);

  const formProblem =
    people.length === 0
      ? t("Add travellers first (Menu → Trip & travellers)")
      : !isDeposit && !title.trim()
        ? t("Add a description")
        : amountLocal <= 0
          ? t("Enter an amount")
          : foreign && rateNum <= 0
            ? t("Enter the exchange rate")
            : groupDeposit && depositors.length === 0
              ? t("Pick at least one person")
              : (type !== "CASH_EXPENSE" && !groupDeposit && !paidBy)
                ? t("Choose who paid")
                : splitResult.problem;
  const depositorIds = people.map((p) => p.id).filter((id) => depositors.includes(id));
  const totalBase = groupDeposit ? amountBase * depositorIds.length : amountBase;

  const save = async () => {
    if (formProblem) return setError(formProblem);
    setSaving(true);
    setError(null);
    const lineItems =
      !isDeposit && items.length
        ? items
            .filter((i) => i.description.trim() || Number(i.amount))
            .map((i) => ({ description: i.description.trim() || "Item", amount: Number(i.amount) || 0, assignees: mode === "items" ? i.assignees : [] }))
        : null;
    const payload = {
      trip_id: bundle.trip.id,
      type,
      title: title.trim() || (isDeposit ? t("Cash deposit") : ""),
      category,
      amount_local: amountLocal,
      currency,
      exchange_rate_to_base: rateNum,
      paid_by_participant_id: type === "CASH_EXPENSE" ? null : paidBy,
      occurred_at: date,
      line_items: lineItems,
      splits: splitResult.splits,
    };
    const ok = groupDeposit
      ? await run(
          () =>
            api("/api/transactions/deposits", "POST", {
              trip_id: bundle.trip.id,
              title: payload.title,
              amount_local: amountLocal,
              currency,
              exchange_rate_to_base: rateNum,
              occurred_at: date,
              participant_ids: depositorIds,
            }),
          "Deposits logged",
        )
      : await run(
          () =>
            state.mode === "edit" ? api(`/api/transactions/${state.tx.id}`, "PUT", payload) : api("/api/transactions", "POST", payload),
          state.mode === "edit" ? "Saved" : isDeposit ? "Deposit logged" : "Expense logged",
        );
    setSaving(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (state.mode !== "edit" || !confirm(t('Delete "{name}"?', { name: state.tx.title }))) return;
    if (await run(() => api(`/api/transactions/${state.tx.id}`, "DELETE"), "Deleted")) onClose();
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const shareOf = (id: string) => splitResult.splits.find((s) => s.participant_id === id)?.share_amount_base ?? 0;
  const currencies = [...new Set([base, currency, ...CURRENCIES])];

  return (
    <Modal
      open
      onClose={onClose}
      title={state.mode === "edit" ? t("Edit transaction") : isDeposit ? t("Log cash deposit") : t("Log expense")}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-neg">{error}</p>}
          <div className="flex gap-2">
            {state.mode === "edit" && (
              <Button variant="danger" onClick={remove} aria-label={t("Delete transaction")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button className="flex-1" onClick={save} disabled={saving || scanning}>
              {saving ? t("Saving…") : state.mode === "edit" ? t("Save changes") : t("Save")}
              {totalBase > 0 && !saving && <span className="tabular opacity-80">· {formatMoney(totalBase, base)}</span>}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Type selector */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label={t("Transaction type")}>
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.type}
              role="radio"
              aria-checked={type === o.type}
              onClick={() => setType(o.type)}
              className={cx("rounded-lg px-2 py-2 text-xs font-semibold", type === o.type ? "bg-surface shadow-sm" : "text-ink-2")}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-ink-3">{t(TYPE_OPTIONS.find((o) => o.type === type)!.hint)}</p>

        {/* Receipt scan */}
        {!isDeposit && (
          <div className="rounded-2xl bg-surface p-3 ring-1 ring-line">
            <div className="flex items-center gap-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Receipt" className="h-14 w-14 rounded-lg object-cover ring-1 ring-line" />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-lg bg-stone-100 text-ink-3">
                  <ScanLine className="h-6 w-6" />
                </div>
              )}
              <div className="flex-1 text-sm">
                <p className="font-semibold">{scanning ? t("Reading receipt…") : t("Scan a receipt")}</p>
                <p className="text-xs text-ink-3">{t("AI fills in merchant, total and line items.")}</p>
              </div>
              <label className={cx("cursor-pointer rounded-xl bg-teal-50 p-2.5 text-brand", scanning && "pointer-events-none opacity-50")}>
                {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                <span className="sr-only">{t("Choose receipt photo")}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) scan(f);
                  }}
                />
              </label>
            </div>
            {scanMsg && <p className="mt-2 text-xs text-ink-2">{scanMsg}</p>}
          </div>
        )}

        <Field label={isDeposit ? t("Note") : t("Description")}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isDeposit ? t("Cash deposit") : t("Dinner at…")} />
        </Field>

        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <Field label={groupDeposit ? t("Amount each") : t("Amount")}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={cx(inputCls, "tabular text-lg font-semibold")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={currencyDecimals(currency) ? "0.00" : "0"}
            />
          </Field>
          <Field label={t("Currency")}>
            <select
              className={inputCls}
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                if (e.target.value === base) setRate("1");
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        {foreign && (
          <Field
            label={t("Exchange rate: 1 {from} = ? {to}", { from: currency, to: base })}
            hint={amountBase > 0 ? `${formatMoney(amountLocal, currency)} = ${formatMoney(amountBase, base)}` : t("Use the rate you actually got for cash.")}
          >
            <input type="number" inputMode="decimal" step="0.000001" min="0" className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!isDeposit && (
            <Field label={t("Category")}>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {[...new Set([...CATEGORIES, category])].map((c) => (
                  <option key={c} value={c}>
                    {t(c)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("Date")}>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        {isDeposit && state.mode === "new" && (
          <div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label={t("Who is depositing?")}>
              {(
                [
                  ["everyone", "Everyone, same amount"],
                  ["single", "One person"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={depositMode === m}
                  onClick={() => setDepositMode(m)}
                  className={cx("rounded-lg px-2 py-2 text-xs font-semibold", depositMode === m ? "bg-surface shadow-sm" : "text-ink-2")}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
        )}

        {groupDeposit ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">{t("Deposited by")}</span>
              <span className="flex gap-3 text-xs font-medium text-brand">
                <button onClick={() => setDepositors(people.map((p) => p.id))}>{t("All")}</button>
                <button onClick={() => setDepositors([])}>{t("None")}</button>
              </span>
            </div>
            <div className="rounded-2xl bg-surface ring-1 ring-line">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-teal-700"
                    checked={depositors.includes(p.id)}
                    onChange={() => setDepositors((d) => toggle(d, p.id))}
                  />
                  <span className="flex-1 text-sm">{p.name}</span>
                  <span className="tabular text-sm text-ink-2">{depositors.includes(p.id) && amountLocal > 0 ? formatMoney(amountLocal, currency) : "—"}</span>
                </label>
              ))}
            </div>
            {amountLocal > 0 && depositorIds.length > 0 && (
              <p className="mt-2 text-xs text-ink-3">
                {t("{n} people × {each} = {total} into the kitty", {
                  n: depositorIds.length,
                  each: formatMoney(amountLocal, currency),
                  total: formatMoney(totalBase, base),
                })}
              </p>
            )}
          </div>
        ) : type !== "CASH_EXPENSE" ? (
          <Field label={isDeposit ? t("Deposited by") : t("Paid by")}>
            <select className={inputCls} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t("Paid from the cash kitty — reduces the Treasurer's expected cash by {amount}.", { amount: formatMoney(amountBase, base) })}
          </p>
        )}

        {/* Splits */}
        {!isDeposit && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">{t("Split between")}</span>
              <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5 text-xs font-semibold">
                {(
                  [
                    ["equal", "Equally"],
                    ["custom", "Custom"],
                    ["items", "Line items"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)} className={cx("rounded-md px-2.5 py-1", mode === m ? "bg-surface shadow-sm" : "text-ink-2")}>
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>

            {mode === "equal" && (
              <div className="rounded-2xl bg-surface ring-1 ring-line">
                <div className="flex justify-end gap-3 border-b border-line px-3 py-1.5 text-xs font-medium text-brand">
                  <button onClick={() => setSelected(people.map((p) => p.id))}>{t("All")}</button>
                  <button onClick={() => setSelected([])}>{t("None")}</button>
                </div>
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                    <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={selected.includes(p.id)} onChange={() => setSelected((s) => toggle(s, p.id))} />
                    <span className="flex-1 text-sm">{p.name}</span>
                    <span className="tabular text-sm text-ink-2">{selected.includes(p.id) ? formatMoney(shareOf(p.id), base) : "—"}</span>
                  </label>
                ))}
              </div>
            )}

            {mode === "custom" && (
              <div className="rounded-2xl bg-surface ring-1 ring-line">
                {people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 text-sm">{p.name}</span>
                    {foreign && Number(custom[p.id]) > 0 && <span className="tabular text-xs text-ink-3">{formatMoney(shareOf(p.id), base)}</span>}
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className={cx(inputBase, "tabular w-28 py-1.5 text-right")}
                      placeholder="0.00"
                      value={custom[p.id] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [p.id]: e.target.value }))}
                      aria-label={t("{name}'s amount in {currency}", { name: p.name, currency })}
                    />
                  </div>
                ))}
                <p className="border-t border-line px-3 py-2 text-xs text-ink-3">{t("Amounts in {currency}; must add up to the total.", { currency })}</p>
              </div>
            )}

            {mode === "items" && (
              <ItemsEditor items={items} setItems={setItems} people={people} currency={currency} nameOf={nameOf} />
            )}

            {splitResult.note && <p className="mt-2 text-xs text-ink-3">{splitResult.note}</p>}
            {splitResult.problem && amountLocal > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warn">
                <AlertTriangle className="h-3.5 w-3.5" /> {splitResult.problem}
              </p>
            )}
            {mode !== "equal" && splitResult.splits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {splitResult.splits.map((s) => (
                  <span key={s.participant_id} className="tabular rounded-full bg-stone-100 px-2 py-0.5 text-xs text-ink-2">
                    {nameOf[s.participant_id]} {formatMoney(s.share_amount_base, base)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ItemsEditor({
  items,
  setItems,
  people,
  currency,
  nameOf,
}: {
  items: ItemDraft[];
  setItems: React.Dispatch<React.SetStateAction<ItemDraft[]>>;
  people: TripBundle["participants"];
  currency: string;
  nameOf: Record<string, string>;
}) {
  const { t } = useT();
  const update = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const assignAll = () => setItems((list) => list.map((i) => (i.assignees.length ? i : { ...i, assignees: people.map((p) => p.id) })));
  const subtotal = round2(items.reduce((a, i) => a + (Number(i.amount) || 0), 0));

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.key} className="rounded-2xl bg-surface p-2.5 ring-1 ring-line">
          <div className="flex gap-2">
            <input
              className={cx(inputCls, "flex-1 py-1.5 text-sm")}
              value={it.description}
              placeholder={t("Item")}
              onChange={(e) => update(it.key, { description: e.target.value })}
              aria-label={t("Item description")}
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              className={cx(inputBase, "tabular w-24 py-1.5 text-right text-sm")}
              value={it.amount}
              placeholder="0.00"
              onChange={(e) => update(it.key, { amount: e.target.value })}
              aria-label={t("Item amount")}
            />
            <button className="p-1 text-ink-3 hover:text-neg" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} aria-label={t("Remove item")}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map((p) => {
              const on = it.assignees.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => update(it.key, { assignees: on ? it.assignees.filter((a) => a !== p.id) : [...it.assignees, p.id] })}
                  className={cx(
                    "rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                    on ? "bg-brand text-white ring-brand" : "bg-surface text-ink-2 ring-line",
                  )}
                  aria-pressed={on}
                  aria-label={t(on ? "Unassign {item} from {name}" : "Assign {item} to {name}", { item: it.description || t("item"), name: nameOf[p.id] })}
                >
                  {on ? "✓ " : ""}
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="secondary" className="py-1.5 text-xs" onClick={() => setItems((l) => [...l, { key: ++itemKey, description: "", amount: "", assignees: [] }])}>
            <Plus className="h-3.5 w-3.5" /> {t("Item")}
          </Button>
          {items.some((i) => i.assignees.length === 0) && (
            <Button variant="ghost" className="py-1.5 text-xs" onClick={assignAll}>
              {t("Unassigned → everyone")}
            </Button>
          )}
        </div>
        <span className="tabular text-xs text-ink-3">{t("Items: {amount}", { amount: formatMoney(subtotal, currency) })}</span>
      </div>
    </div>
  );
}
