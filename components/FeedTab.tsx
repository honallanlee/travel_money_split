"use client";
import { CheckCircle2, ChevronDown, Paperclip, Pencil, ReceiptText, Trash2, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { isExpense } from "@/lib/analytics";
import { formatMoney, round2, type Ledger } from "@/lib/settlement";
import type { Participant, Transaction, TripBundle } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { useDisplay } from "./DisplayCurrency";
import { Avatar, Button, Card, CategoryIcon, cx, dayKey, formatDay, inputCls, Money, SectionTitle, TypePill } from "./ui";

export default function FeedTab({
  bundle,
  ledger,
  unlocked,
  onEdit,
  onDelete,
  onAddFirst,
}: {
  bundle: TripBundle;
  ledger: Ledger;
  unlocked: boolean;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onAddFirst: () => void;
}) {
  const { t, locale } = useT();
  const cur = bundle.trip.base_currency;
  const people = useMemo(() => Object.fromEntries(bundle.participants.map((p) => [p.id, p])), [bundle.participants]);
  const names = useMemo(() => Object.fromEntries(bundle.participants.map((p) => [p.id, p.name])), [bundle.participants]);
  const byDay = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of bundle.transactions) {
      const k = dayKey(t.occurred_at);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [bundle.transactions]);

  return (
    <div>
      <CashWalletCard ledger={ledger} currency={cur} treasurer={ledger.treasurerName} />

      {bundle.participants.length === 0 && (
        <Card className="mt-4 p-5 text-center">
          <Users className="mx-auto mb-2 h-7 w-7 text-brand" />
          <p className="font-semibold">{t("Add your travellers")}</p>
          <p className="mb-3 mt-1 text-sm text-ink-2">
            {unlocked ? t("Add people and families before logging expenses.") : t("The Treasurer hasn't added anyone yet.")}
          </p>
          {unlocked && <Button onClick={onAddFirst}>{t("Add people")}</Button>}
        </Card>
      )}

      {byDay.length === 0 && bundle.participants.length > 0 && (
        <Card className="mt-4 p-6 text-center text-sm text-ink-2">
          <ReceiptText className="mx-auto mb-2 h-7 w-7 text-ink-3" aria-hidden />
          {t("No transactions yet.")}{unlocked ? " " + t("Tap Add to log the first one.") : ""}
        </Card>
      )}

      {byDay.map(([day, txs]) => {
        const daySpend = txs.reduce((a, t) => a + (isExpense(t) ? t.amount_base : t.type === "REFUND" ? -t.amount_base : 0), 0);
        return (
          <section key={day}>
            <SectionTitle action={Math.abs(daySpend) > 0.004 && <Money amount={round2(daySpend)} className="text-xs text-ink-3" />}>
              {formatDay(day, locale)}
            </SectionTitle>
            <Card className="divide-y divide-line overflow-hidden">
              {txs.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  currency={cur}
                  names={names}
                  people={people}
                  unlocked={unlocked}
                  onEdit={() => onEdit(tx)}
                  onDelete={() => onDelete(tx)}
                />
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function CashWalletCard({ ledger, currency, treasurer }: { ledger: Ledger; currency: string; treasurer: string | null }) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const d = useDisplay();
  const { t } = useT();
  const { pool } = ledger;
  const diff = counted === "" ? null : round2(Number(counted) - pool.balance);

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-teal-700 to-teal-900 p-4 text-white">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-teal-100">
          <Wallet className="h-4 w-4" /> {treasurer ? t("Expected cash in {name}'s wallet", { name: treasurer }) : t("Expected cash in Treasurer's wallet")}
        </div>
        <p className="tabular mt-1 text-4xl font-bold">{formatMoney(pool.balance, currency)}</p>
        {d.converted && <p className="tabular text-sm text-teal-100">≈ {d.fmt(pool.balance)}</p>}
        <div className={cx("mt-3 grid gap-2 text-sm", pool.payouts > 0 ? "grid-cols-3" : "grid-cols-2")}>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <p className="text-xs text-teal-100">{t("Deposited")}</p>
            <p className="tabular font-semibold">{formatMoney(pool.deposits, currency)}</p>
            {d.converted && <p className="tabular text-[11px] text-teal-100">≈ {d.fmt(pool.deposits)}</p>}
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2">
            <p className="text-xs text-teal-100">{t("Spent in cash")}</p>
            <p className="tabular font-semibold">{formatMoney(pool.expenses, currency)}</p>
            {d.converted && <p className="tabular text-[11px] text-teal-100">≈ {d.fmt(pool.expenses)}</p>}
          </div>
          {pool.payouts > 0 && (
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-xs text-teal-100">{t("Paid out")}</p>
              <p className="tabular font-semibold">{formatMoney(pool.payouts, currency)}</p>
              {d.converted && <p className="tabular text-[11px] text-teal-100">≈ {d.fmt(pool.payouts)}</p>}
            </div>
          )}
        </div>
        {pool.refunds > 0 && (
          <p className="mt-2 text-xs text-teal-100">{t("Includes {amount} of cash refunds back into the kitty.", { amount: formatMoney(pool.refunds, currency) })}</p>
        )}
      </div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-brand" aria-expanded={open}>
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {t("Reconcile cash")}
        </span>
        <ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-4 pb-4 pt-3">
          <p className="text-xs text-ink-2">{t("Count the physical cash (in {currency}) and enter it to check it matches the ledger.", { currency })}</p>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className={inputCls}
            placeholder={t("Counted cash, e.g. {amount}", { amount: String(pool.balance) })}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            aria-label={t("Counted cash")}
          />
          {diff !== null && Number.isFinite(diff) && (
            <p
              className={cx(
                "rounded-xl px-3 py-2 text-sm font-medium",
                Math.abs(diff) < 0.01 ? "bg-emerald-50 text-pos" : "bg-red-50 text-neg",
              )}
            >
              {Math.abs(diff) < 0.01
                ? t("✓ Cash matches the ledger exactly.")
                : diff > 0
                  ? t("{amount} more than expected — an unlogged deposit?", { amount: formatMoney(diff, currency) })
                  : t("{amount} short — an unlogged cash expense?", { amount: formatMoney(-diff, currency) })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function TxRow({
  tx,
  currency,
  names,
  people,
  unlocked,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  currency: string;
  names: Record<string, string>;
  people: Record<string, Participant>;
  unlocked: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const d = useDisplay();
  const { t } = useT();
  const isDeposit = tx.type === "CASH_DEPOSIT";
  const isPayout = tx.type === "CASH_PAYOUT";
  const isSettle = tx.type === "TRANSFER";
  const isRefund = tx.type === "REFUND";
  const isTransfer = isDeposit || isPayout || isSettle;
  const payer = tx.paid_by_participant_id ? names[tx.paid_by_participant_id] : null;
  const receiverId = isSettle ? tx.splits[0]?.participant_id : undefined;
  const foreign = tx.currency !== currency;
  const showOriginal = tx.currency !== d.code;

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-stone-50" aria-expanded={open}>
        <div
          className={cx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
            isDeposit
              ? "bg-emerald-50 text-emerald-700"
              : isPayout
                ? "bg-violet-50 text-violet-700"
                : isSettle
                  ? "bg-stone-100 text-stone-700"
                  : isRefund
                    ? "bg-rose-50 text-rose-700"
                    : tx.type === "CASH_EXPENSE"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-sky-50 text-sky-700",
          )}
        >
          <CategoryIcon category={tx.category} type={tx.type} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tx.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <TypePill type={tx.type} />
            {isSettle && payer && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-0.5 pl-0.5 pr-1.5 text-[11px] font-medium text-ink-2">
                <Avatar person={people[tx.paid_by_participant_id!]} size={16} className="ring-0" />
                {payer} → {receiverId ? names[receiverId] ?? t("Removed") : "?"}
              </span>
            )}
            {isRefund && !payer && (
              <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{t("into kitty")}</span>
            )}
            {payer && !isSettle && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-0.5 pl-0.5 pr-1.5 text-[11px] font-medium text-ink-2">
                <Avatar person={people[tx.paid_by_participant_id!]} size={16} className="ring-0" />
                {t(
                  isDeposit
                    ? "from {name}"
                    : isPayout || isRefund
                      ? "to {name}"
                      : tx.type === "CASH_EXPENSE"
                        ? "via {name}"
                        : "paid by {name}",
                  { name: payer },
                )}
              </span>
            )}
            {!isTransfer && <span>÷ {tx.splits.length}</span>}
            {tx.receipt_url && <Paperclip className="h-3.5 w-3.5" aria-label={t("Receipt attached")} />}
          </div>
        </div>
        <div className="text-right">
          <Money
            amount={isRefund ? -tx.amount_base : tx.amount_base}
            className={cx("text-sm font-semibold", isDeposit && "text-pos", isRefund && "text-rose-700")}
            signed={isDeposit}
          />
          {showOriginal && <p className="tabular text-[11px] text-ink-3">{formatMoney(tx.amount_local, tx.currency)}</p>}
        </div>
      </button>
      {open && (
        <div className="space-y-2 bg-stone-50 px-4 pb-3 pt-1 text-sm">
          <p className="text-xs text-ink-3">
            {isDeposit ? t("Cash deposit") : isPayout ? t("Paid from kitty") : isSettle ? t("Settle-up payment") : t(tx.category)}
            {isRefund && ` · ${t("shares given back")}`}
            {foreign && ` · ${t("rate")} 1 ${tx.currency} = ${tx.exchange_rate_to_base} ${currency}`}
          </p>
          {!isTransfer && (
            <ul className="space-y-1">
              {tx.splits.map((s) => (
                <li key={s.participant_id} className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <Avatar person={people[s.participant_id]} size={20} className="ring-0" />
                    {names[s.participant_id] ?? t("Removed")}
                  </span>
                  <Money amount={s.share_amount_base} />
                </li>
              ))}
            </ul>
          )}
          {tx.receipt_url && (
            <a href={tx.receipt_url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl bg-surface p-2 ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${tx.receipt_url}?size=thumb`} alt={t("Receipt")} loading="lazy" className="h-12 w-12 rounded-lg object-cover" />
              <span className="text-xs font-medium text-indigo-700">{t("View receipt")}</span>
            </a>
          )}
          {tx.line_items && tx.line_items.length > 0 && (
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer font-medium">{t("Receipt items ({n})", { n: tx.line_items.length })}</summary>
              <ul className="mt-1 space-y-0.5">
                {tx.line_items.map((li, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">
                      {li.description}
                      {li.assignees?.length ? ` — ${li.assignees.map((a) => names[a] ?? "?").join(", ")}` : ""}
                    </span>
                    <span className="tabular">{formatMoney(li.amount, tx.currency)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {unlocked && (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onEdit}>
                <Pencil className="h-4 w-4" /> {t("Edit")}
              </Button>
              <Button variant="danger" onClick={onDelete} aria-label={t("Delete transaction")}>
                <Trash2 className="h-4 w-4" /> {t("Delete")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
