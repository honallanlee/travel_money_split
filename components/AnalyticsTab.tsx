"use client";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { categoryTotals, dailySeries, keyMetrics } from "@/lib/analytics";
import type { TripBundle } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { useDisplay } from "./DisplayCurrency";
import { Card, CategoryIcon, cx, SectionTitle } from "./ui";

const AXIS = { fontSize: 11, fill: "var(--ink-3)" };
const shortDayIn = (locale: string) => (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

function ChartTip({ active, payload, label, fmt, labelFmt }: TooltipProps<number, string> & { fmt: (n: number) => string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-line">
      <p className="mb-0.5 text-ink-3">{labelFmt ? labelFmt(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="tabular font-semibold text-ink">
          {p.name}: {fmt(Number(p.value))}
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsTab({ bundle }: { bundle: TripBundle }) {
  const d = useDisplay();
  const { t, locale } = useT();
  const shortDay = shortDayIn(locale);
  const cats = useMemo(() => categoryTotals(bundle.transactions), [bundle.transactions]);
  const series = useMemo(() => dailySeries(bundle.transactions), [bundle.transactions]);
  const m = useMemo(() => keyMetrics(bundle.transactions, bundle.participants.length), [bundle.transactions, bundle.participants.length]);
  const [trend, setTrend] = useState<"daily" | "cumulative">("cumulative");
  const [showTable, setShowTable] = useState(false);

  if (m.total === 0) {
    return <Card className="p-6 text-center text-sm text-ink-2">{t("Analytics appear once expenses are logged.")}</Card>;
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("Total trip cost")} value={d.fmt(m.total)} />
        <Stat label={t("Average per day")} value={d.fmt(m.avgDaily)} sub={t(m.days === 1 ? "over {n} day" : "over {n} days", { n: m.days })} />
        <Stat label={t("Average per person")} value={d.fmt(m.perPerson)} sub={t("{n} travellers", { n: bundle.participants.length })} />
        <Card className="p-3">
          <p className="text-xs text-ink-3">{t("Cash vs card")}</p>
          <p className="tabular mt-0.5 text-lg font-bold">
            {Math.round(m.cashShare * 100)}% <span className="text-sm font-medium text-ink-3">/ {100 - Math.round(m.cashShare * 100)}%</span>
          </p>
          <div className="mt-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${t("Cash")} ${d.fmt(m.cash)}, ${t("Card")} ${d.fmt(m.card)}`}>
            {m.cash > 0 && <div className="rounded-l-full" style={{ width: `${m.cashShare * 100}%`, background: "var(--series-2)" }} />}
            {m.card > 0 && <div className="flex-1 rounded-r-full" style={{ background: "var(--series-1)" }} />}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-ink-3">
            <span className="flex items-center gap-1">
              <i className="h-2 w-2 rounded-full" style={{ background: "var(--series-2)" }} /> {t("Cash")}
            </span>
            <span className="flex items-center gap-1">
              {t("Card")} <i className="h-2 w-2 rounded-full" style={{ background: "var(--series-1)" }} />
            </span>
          </div>
        </Card>
      </div>

      <SectionTitle
        action={
          <button className="text-xs font-medium text-brand" onClick={() => setShowTable((s) => !s)}>
            {showTable ? t("Chart") : t("Table")}
          </button>
        }
      >
        {t("Spend by category")}
      </SectionTitle>
      <Card className="p-3">
        {showTable ? (
          <table className="w-full text-sm">
            <tbody className="tabular">
              {cats.map((c) => (
                <tr key={c.category} className="border-b border-line last:border-0">
                  <td className="py-1.5">{t(c.category)}</td>
                  <td className="py-1.5 text-right">{d.fmt(c.amount)}</td>
                  <td className="w-12 py-1.5 text-right text-ink-3">{Math.round((c.amount / m.total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="space-y-2.5">
            {cats.map((c) => (
              <li key={c.category} className="group">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <CategoryIcon category={c.category} className="h-4 w-4" /> {t(c.category)}
                  </span>
                  <span className="tabular font-semibold">
                    {d.fmt(c.amount)} <span className="ml-1 text-xs font-normal text-ink-3">{Math.round((c.amount / m.total) * 100)}%</span>
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full transition-all group-hover:brightness-110"
                    style={{ width: `${Math.max(2, (c.amount / cats[0].amount) * 100)}%`, background: "var(--series-1)" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>{t("Spend trend")}</SectionTitle>
      <Card className="p-3">
        <div className="mb-2 inline-flex rounded-lg bg-stone-100 p-0.5 text-xs font-medium">
          {(["cumulative", "daily"] as const).map((k) => (
            <button key={k} onClick={() => setTrend(k)} className={cx("rounded-md px-3 py-1", trend === k ? "bg-surface shadow-sm" : "text-ink-3")}>
              {k === "daily" ? t("Daily burn") : t("Cumulative")}
            </button>
          ))}
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            {trend === "daily" ? (
              <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tickFormatter={d.fmtCompact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
                <Tooltip cursor={{ fill: "var(--grid)" }} content={<ChartTip fmt={d.fmt} labelFmt={shortDay} />} />
                <Bar dataKey="daily" name={t("Spent")} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            ) : (
              <AreaChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tickFormatter={d.fmtCompact} tick={AXIS} axisLine={false} tickLine={false} width={48} />
                <Tooltip cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} content={<ChartTip fmt={d.fmt} labelFmt={shortDay} />} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name={t("Total so far")}
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="url(#cumFill)"
                  dot={{ r: 3, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="tabular mt-0.5 text-lg font-bold">{value}</p>
      {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
    </Card>
  );
}
