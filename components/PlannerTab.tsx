"use client";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { budgetComparison } from "@/lib/analytics";
import { api } from "@/lib/client";
import { CATEGORIES, type BudgetItem, type TripBundle } from "@/lib/types";
import type { RunMutation } from "./TripApp";
import { useT } from "@/lib/i18n";
import { useDisplay } from "./DisplayCurrency";
import { Button, Card, CategoryIcon, cx, inputBase, inputCls, SectionTitle } from "./ui";

export default function PlannerTab({ bundle, unlocked, run }: { bundle: TripBundle; unlocked: boolean; run: RunMutation }) {
  const cur = bundle.trip.base_currency;
  const d = useDisplay();
  const { t } = useT();
  const { rows, unbudgeted } = useMemo(() => budgetComparison(bundle.budget_items, bundle.transactions), [bundle]);
  const totalPlanned = rows.reduce((a, r) => a + r.planned_amount_base, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0) + unbudgeted.reduce((a, u) => a + u.amount, 0);
  const unusedCats = CATEGORIES.filter((c) => !rows.some((r) => r.category === c));

  return (
    <div>
      <Card className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-3">{t("Spent vs planned")}</p>
            <p className="tabular text-2xl font-bold">
              {d.fmt(totalActual)} <span className="text-base font-medium text-ink-3">/ {d.fmt(totalPlanned)}</span>
            </p>
          </div>
          {totalPlanned > 0 && (
            <p className={cx("text-sm font-semibold", totalActual > totalPlanned ? "text-neg" : "text-pos")}>
              {totalActual > totalPlanned
                ? t("{amount} over", { amount: d.fmt(totalActual - totalPlanned) })
                : t("{amount} left", { amount: d.fmt(totalPlanned - totalActual) })}
            </p>
          )}
        </div>
        {totalPlanned > 0 && <Progress ratio={totalActual / totalPlanned} className="mt-3" />}
      </Card>

      <SectionTitle>{t("Budget by category")}</SectionTitle>
      {rows.length === 0 && (
        <Card className="p-6 text-center text-sm text-ink-2">
          {t("No budget yet.")}{unlocked ? " " + t("Add planned amounts per category below.") : ""}
        </Card>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <BudgetRow key={r.id} item={r} actual={r.actual} ratio={r.ratio} currency={cur} unlocked={unlocked} run={run} />
        ))}
      </div>

      {unbudgeted.length > 0 && (
        <>
          <SectionTitle>{t("Unbudgeted spending")}</SectionTitle>
          <Card className="divide-y divide-line">
            {unbudgeted.map((u) => (
              <div key={u.category} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-ink-2">
                  <CategoryIcon category={u.category} className="h-4 w-4" />
                  {t(u.category)}
                </span>
                <span className="tabular font-semibold">{d.fmt(u.amount)}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      {unlocked && <AddBudget tripId={bundle.trip.id} categories={unusedCats} currency={cur} run={run} />}
    </div>
  );
}

function Progress({ ratio, className }: { ratio: number; className?: string }) {
  const pct = Math.min(100, ratio * 100);
  const tone = ratio > 1 ? "bg-red-600" : ratio > 0.85 ? "bg-amber-500" : "bg-teal-600";
  return (
    <div className={cx("h-2.5 overflow-hidden rounded-full bg-stone-100", className)}>
      <div className={cx("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(pct, ratio > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

function BudgetRow({
  item,
  actual,
  ratio,
  currency,
  unlocked,
  run,
}: {
  item: BudgetItem;
  actual: number;
  ratio: number;
  currency: string;
  unlocked: boolean;
  run: RunMutation;
}) {
  const d = useDisplay();
  const { t } = useT();
  const [planned, setPlanned] = useState(String(item.planned_amount_base));
  const [notes, setNotes] = useState(item.notes ?? "");
  const over = ratio > 1;
  const dirty = Number(planned) !== item.planned_amount_base || (notes || null) !== item.notes;

  return (
    <Card className={cx("p-3", over && "ring-red-200")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <CategoryIcon category={item.category} className="h-4 w-4 text-ink-2" />
          {t(item.category)}
          {over && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-neg">
              <AlertTriangle className="h-3 w-3" /> {t("OVER")}
            </span>
          )}
          {!over && ratio > 0.85 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
              <AlertTriangle className="h-3 w-3" /> {t("NEAR LIMIT")}
            </span>
          )}
        </span>
        <span className="tabular text-sm">
          <span className={cx("font-semibold", over && "text-neg")}>{d.fmt(actual)}</span>
          <span className="text-ink-3"> / {d.fmt(item.planned_amount_base)}</span>
        </span>
      </div>
      <Progress ratio={ratio} className="mt-2" />
      {!unlocked && item.notes && <p className="mt-1.5 text-xs text-ink-3">{item.notes}</p>}
      {unlocked && (
        <div className="mt-2.5 flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={cx(inputBase, "w-28 py-1.5")}
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            aria-label={t("Planned {category}", { category: t(item.category) })}
          />
          <input className={cx(inputCls, "flex-1 py-1.5")} placeholder={t("Notes")} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t("Notes")} />
          {dirty ? (
            <Button
              className="py-1.5"
              onClick={() =>
                run(() => api(`/api/budgets/${item.id}`, "PUT", { planned_amount_base: Number(planned), notes }), "Budget saved")
              }
            >
              {t("Save")}
            </Button>
          ) : (
            <button
              className="rounded-xl p-2 text-ink-3 hover:bg-red-50 hover:text-neg"
              aria-label={t("Delete {category} budget", { category: t(item.category) })}
              onClick={() => confirm(t("Delete the {category} budget?", { category: t(item.category) })) && run(() => api(`/api/budgets/${item.id}`, "DELETE"), "Deleted")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function AddBudget({ tripId, categories, currency, run }: { tripId: string; categories: string[]; currency: string; run: RunMutation }) {
  const { t } = useT();
  const [cat, setCat] = useState<string>(categories[0] ?? "");
  const [amt, setAmt] = useState("");
  const selected = categories.includes(cat) ? cat : categories[0] ?? "";
  if (categories.length === 0) return null;
  return (
    <>
      <SectionTitle>{t("Add budget line")}</SectionTitle>
      <Card className="flex gap-2 p-3">
        <select className={cx(inputCls, "flex-1 py-2")} value={selected} onChange={(e) => setCat(e.target.value)} aria-label={t("Category")}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder={currency}
          className={cx(inputBase, "w-28 py-2")}
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          aria-label={t("Planned amount")}
        />
        <Button
          disabled={!amt || Number(amt) < 0}
          aria-label={t("Add budget line")}
          onClick={async () => {
            if (await run(() => api("/api/budgets", "POST", { trip_id: tripId, category: selected, planned_amount_base: Number(amt) }), "Budget added"))
              setAmt("");
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </Card>
    </>
  );
}
