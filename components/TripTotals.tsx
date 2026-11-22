"use client";
import { CalendarClock, ChevronDown, Pencil, Plus, Receipt } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { computeTripTotals, type PersonTotal } from "@/lib/personTotals";
import { formatMoney } from "@/lib/settlement";
import type { PrepaidItem, TripBundle } from "@/lib/types";
import { useDisplay } from "./DisplayCurrency";
import PrepaidModal from "./PrepaidModal";
import type { TxPrefill } from "./TransactionModal";
import type { RunMutation } from "./TripApp";
import { Avatar, Card, CategoryIcon, cx, SectionTitle } from "./ui";

/** "HK$9,000 + ¥18,000" for a person's prepaid amounts in their own currencies. */
function byCurrency(m: Record<string, { paid: number; due: number }>, key: "paid" | "due") {
  return Object.entries(m)
    .filter(([, v]) => v[key] > 0)
    .map(([c, v]) => formatMoney(v[key], c))
    .join(" + ");
}

/**
 * Trip total per person: their share of app expenses by category, plus hotels / flights
 * settled before the trip and costs still to pay. Also lists those prepaid costs, which the
 * Treasurer can add and edit.
 */
export default function TripTotals({
  bundle,
  unlocked,
  run,
  onRecordPayment,
}: {
  bundle: TripBundle;
  unlocked: boolean;
  run: RunMutation;
  onRecordPayment: (prefill: TxPrefill) => void;
}) {
  const { t } = useT();
  const d = useDisplay();
  const totals = useMemo(() => computeTripTotals(bundle), [bundle]);
  const [view, setView] = useState<"person" | "family">("person");
  const [editing, setEditing] = useState<PrepaidItem | "new" | null>(null);
  const items = bundle.prepaid_items ?? [];
  const hasFamilies = bundle.mini_groups.length > 0;
  const base = bundle.trip.base_currency;

  if (bundle.participants.length === 0) return null;

  const recordPayment = (item: PrepaidItem) =>
    onRecordPayment({
      title: item.title,
      category: item.category,
      date: item.date ?? undefined,
      amount: item.currency === base ? item.shares.reduce((a, s) => a + s.amount, 0) : undefined,
      custom: item.currency === base ? Object.fromEntries(item.shares.filter((s) => s.amount > 0).map((s) => [s.participant_id, s.amount])) : undefined,
      prepaidId: item.id,
    });

  return (
    <div>
      <SectionTitle>{t("Whole-trip cost")}</SectionTitle>
      <Card className="p-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-ink-3">{t("Everything, all travellers")}</p>
            <p className="tabular text-2xl font-bold">{d.fmt(totals.total)}</p>
          </div>
          <p className="text-right text-xs text-ink-3">
            {t("{amount} per person on average", { amount: d.fmt(totals.total / Math.max(1, bundle.participants.length)) })}
          </p>
        </div>
        <dl className="mt-3 space-y-1 text-sm">
          <Row label={t("Spent during the trip (logged in the app)")} value={d.fmt(totals.tripSpend)} />
          {totals.prepaidPaid > 0 && (
            <Row label={t("Paid before the trip")} value={d.fmt(totals.prepaidPaid)} sub={byCurrency(totals.prepaidByCurrency, "paid")} />
          )}
          {totals.prepaidDue > 0 && (
            <Row label={t("Still to pay")} value={d.fmt(totals.prepaidDue)} sub={byCurrency(totals.prepaidByCurrency, "due")} tone="warn" />
          )}
        </dl>
        {totals.byCategory.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
            {totals.byCategory.map((c) => (
              <span key={c.category} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-ink-2">
                <CategoryIcon category={c.category} className="h-3 w-3" /> {t(c.category)} <b className="tabular">{d.fmt(c.amount)}</b>
              </span>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle
        action={
          hasFamilies ? (
            <div className="inline-flex rounded-lg bg-stone-100 p-0.5 text-xs font-medium">
              {(["person", "family"] as const).map((k) => (
                <button key={k} onClick={() => setView(k)} className={cx("rounded-md px-2.5 py-1", view === k ? "bg-surface shadow-sm" : "text-ink-3")}>
                  {k === "person" ? t("By person") : t("By family")}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {t("Trip total per person")}
      </SectionTitle>
      <div className="space-y-2">
        {view === "person" || !hasFamilies
          ? [...totals.people].sort((a, b) => (a.group_name ?? a.name).localeCompare(b.group_name ?? b.name) || a.name.localeCompare(b.name)).map((p) => (
              <PersonCard key={p.participant_id} p={p} bundle={bundle} />
            ))
          : totals.groups.map((g) => (
              <Card key={g.id} className="p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{g.name}</p>
                  <p className="tabular text-sm font-bold">{d.fmt(g.total)}</p>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t("Trip {a} · Prepaid {b}", { a: d.fmt(g.tripSpend), b: d.fmt(g.prepaidPaid + g.prepaidDue) })}
                  {g.prepaidDue > 0 && ` · ${t("{amount} still to pay", { amount: d.fmt(g.prepaidDue) })}`}
                </p>
                <ul className="mt-2 divide-y divide-line text-xs">
                  {g.member_ids.map((id) => {
                    const p = totals.people.find((x) => x.participant_id === id)!;
                    return (
                      <li key={id} className="flex justify-between py-1">
                        <span>{p.name}</span>
                        <span className="tabular font-medium">{d.fmt(p.total)}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
      </div>

      <SectionTitle
        action={
          unlocked ? (
            <button className="flex items-center gap-1 text-xs font-medium text-brand" onClick={() => setEditing("new")}>
              <Plus className="h-3.5 w-3.5" /> {t("Add")}
            </button>
          ) : undefined
        }
      >
        {t("Hotels, flights & other costs paid outside the app")}
      </SectionTitle>
      {items.length === 0 ? (
        <Card className="p-4 text-center text-xs text-ink-3">
          {t("Nothing yet.")} {unlocked && t("Add hotels or flights booked before the trip so they show in everyone's total.")}
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((item) => {
            const total = item.shares.reduce((a, s) => a + s.amount, 0);
            const people = item.shares.filter((s) => s.amount > 0).length;
            return (
              <div key={item.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <CategoryIcon category={item.category} className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-[11px] text-ink-3">
                    {item.date && `${item.date} · `}
                    {t("{n} people", { n: people })} · {formatMoney(total, item.currency)}
                    {item.currency !== base && ` ≈ ${d.fmt(total * item.exchange_rate_to_base)}`}
                  </p>
                  {item.note && <p className="mt-0.5 text-[11px] text-ink-2">{item.note}</p>}
                  <StatusPill status={item.status} />
                  {unlocked && item.status === "due" && (
                    <button
                      onClick={() => recordPayment(item)}
                      className="ml-2 mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200"
                    >
                      <Receipt className="h-3 w-3" /> {t("Record payment")}
                    </button>
                  )}
                </div>
                {unlocked && (
                  <button className="rounded-lg p-1.5 text-ink-3 hover:bg-stone-100" aria-label={t("Edit")} onClick={() => setEditing(item)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}
      <p className="mt-2 px-1 text-xs text-ink-3">
        {t("These costs count in each person's total but not in the kitty or the settle-up plan, because they were settled separately.")}
      </p>

      {editing && <PrepaidModal bundle={bundle} item={editing === "new" ? null : editing} run={run} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Row({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={cx("text-ink-2", tone === "warn" && "text-warn")}>
        {label}
        {sub && <span className="block text-[11px] text-ink-3">{sub}</span>}
      </dt>
      <dd className={cx("tabular font-semibold", tone === "warn" && "text-warn")}>{value}</dd>
    </div>
  );
}

export function StatusPill({ status }: { status: PrepaidItem["status"] }) {
  const { t } = useT();
  const s = {
    paid: { label: "Paid & settled", cls: "bg-teal-50 text-brand ring-teal-200" },
    due: { label: "To pay", cls: "bg-amber-50 text-warn ring-amber-200" },
    recorded: { label: "Logged as an expense", cls: "bg-stone-100 text-ink-3 ring-line" },
  }[status];
  return <span className={cx("mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", s.cls)}>{t(s.label)}</span>;
}

function PersonCard({ p, bundle }: { p: PersonTotal; bundle: TripBundle }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const d = useDisplay();
  const person = bundle.participants.find((x) => x.id === p.participant_id)!;
  const cats = Object.entries(p.byCategory).sort((a, b) => b[1] - a[1]);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        <Avatar person={person} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.name}</p>
          <p className="truncate text-xs text-ink-3">
            {p.group_name ? `${p.group_name} · ` : ""}
            {t("Trip {a} · Prepaid {b}", { a: d.fmt(p.tripSpend), b: d.fmt(p.prepaidPaid + p.prepaidDue) })}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-sm font-bold">{d.fmt(p.total)}</p>
          {p.prepaidDue > 0 && (
            <p className="flex items-center justify-end gap-0.5 text-[11px] text-warn">
              <CalendarClock className="h-3 w-3" /> {t("{amount} to pay", { amount: byCurrency(p.prepaidByCurrency, "due") })}
            </p>
          )}
        </div>
        <ChevronDown className={cx("h-4 w-4 text-ink-3 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line bg-stone-50 px-3 py-2 text-xs">
          <p className="mb-1 font-semibold text-ink-2">{t("Share of expenses logged in the app")}</p>
          {cats.length === 0 ? (
            <p className="text-ink-3">{t("No expenses yet.")}</p>
          ) : (
            <table className="w-full">
              <tbody className="tabular">
                {cats.map(([c, v]) => (
                  <tr key={c} className="border-t border-line/70 first:border-0">
                    <td className="py-1">{t(c)}</td>
                    <td className="py-1 text-right">{d.fmt(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.prepaid.length > 0 && (
            <>
              <p className="mb-1 mt-3 font-semibold text-ink-2">{t("Paid outside the app")}</p>
              <table className="w-full">
                <tbody className="tabular">
                  {p.prepaid.map((l) => (
                    <tr key={l.item.id} className="border-t border-line/70 first:border-0">
                      <td className="py-1">
                        {l.item.title}
                        {l.item.status === "due" && <span className="ml-1 text-warn">({t("to pay")})</span>}
                      </td>
                      <td className="py-1 text-right">
                        {formatMoney(l.amount, l.item.currency)}
                        {l.item.currency !== bundle.trip.base_currency && <span className="block text-[10px] text-ink-3">≈ {d.fmt(l.base)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-bold">
            <span>{t("Total")}</span>
            <span className="tabular">{d.fmt(p.total)}</span>
          </div>
          {Object.keys(p.prepaidByCurrency).length > 0 && (
            <p className="mt-1 text-[11px] text-ink-3">
              {t("In original currencies: trip {a} + prepaid {b}", {
                a: formatMoney(p.tripSpend, bundle.trip.base_currency),
                b: [byCurrency(p.prepaidByCurrency, "paid"), byCurrency(p.prepaidByCurrency, "due")].filter(Boolean).join(" + "),
              })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
