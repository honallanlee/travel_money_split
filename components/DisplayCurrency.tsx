"use client";
import { ArrowLeftRight, Check, RefreshCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/settlement";
import { CURRENCIES } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { Button, cx, Field, inputCls, Modal } from "./ui";

/**
 * Per-viewer display currency. Everything is recorded and settled in the trip's base
 * currency (e.g. JPY); this only converts what each viewer *sees*, using live reference
 * rates or a rate they type in. The choice is remembered in this browser per trip.
 */
type RatesResponse = { base: string; date: string; source: string; rates: Record<string, number> };

export interface Display {
  base: string;
  code: string;
  /** multiply a base amount by this to get the display amount */
  rate: number;
  converted: boolean;
  rateInfo: { date: string; source: string; manual: boolean } | null;
  fmt: (amountBase: number) => string;
  fmtCompact: (amountBase: number) => string;
  fmtBase: (amountBase: number) => string;
  openPicker: () => void;
}

const fallback = (base: string): Display => ({
  base,
  code: base,
  rate: 1,
  converted: false,
  rateInfo: null,
  fmt: (n) => formatMoney(n, base),
  fmtCompact: (n) => compact(n, base),
  fmtBase: (n) => formatMoney(n, base),
  openPicker: () => {},
});

const Ctx = createContext<Display>(fallback("JPY"));
export const useDisplay = () => useContext(Ctx);

function compact(n: number, cur: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: cur,
      currencyDisplay: cur === "JPY" ? "narrowSymbol" : "symbol",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

export function DisplayCurrencyProvider({ base, tripId, children }: { base: string; tripId: string; children: ReactNode }) {
  const codeKey = `tms:display:${tripId}`;
  const [code, setCode] = useState(base);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [live, setLive] = useState<RatesResponse | null>(null);
  const [ratesErr, setRatesErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCode(read(codeKey) ?? base);
    try {
      setManual(JSON.parse(read(`tms:manual-rates:${base}`) ?? "{}"));
    } catch {}
  }, [codeKey, base]);

  const loadRates = useCallback(() => {
    setRatesErr(null);
    api<RatesResponse>(`/api/rates?base=${base}`)
      .then(setLive)
      .catch((e) => setRatesErr(e.message));
  }, [base]);

  // Only fetch rates once someone actually wants a different currency.
  useEffect(() => {
    if ((code !== base || open) && !live) loadRates();
  }, [code, base, open, live, loadRates]);

  const value = useMemo<Display>(() => {
    const manualRate = manual[code];
    const liveRate = live?.rates[code];
    const rate = code === base ? 1 : manualRate ?? liveRate;
    if (!rate || code === base) return { ...fallback(base), openPicker: () => setOpen(true) };
    return {
      base,
      code,
      rate,
      converted: true,
      rateInfo: manualRate ? { date: "", source: "your rate", manual: true } : { date: live!.date, source: live!.source, manual: false },
      fmt: (n) => formatMoney(n * rate, code),
      fmtCompact: (n) => compact(n * rate, code),
      fmtBase: (n) => formatMoney(n, base),
      openPicker: () => setOpen(true),
    };
  }, [base, code, manual, live]);

  const choose = (c: string) => {
    setCode(c);
    write(codeKey, c === base ? null : c);
  };
  const setManualRate = (c: string, r: number | null) => {
    const next = { ...manual };
    if (r && r > 0) next[c] = r;
    else delete next[c];
    setManual(next);
    write(`tms:manual-rates:${base}`, JSON.stringify(next));
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {open && (
        <CurrencyPicker
          base={base}
          code={code}
          live={live}
          ratesErr={ratesErr}
          manual={manual}
          onRetry={loadRates}
          onChoose={choose}
          onManual={setManualRate}
          onClose={() => setOpen(false)}
        />
      )}
    </Ctx.Provider>
  );
}

/** Small header chip showing the current display currency. */
export function DisplayCurrencyChip() {
  const d = useDisplay();
  const { t } = useT();
  return (
    <button
      onClick={d.openPicker}
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-px text-xs font-semibold",
        d.converted ? "bg-sky-100 text-sky-900" : "bg-stone-200 text-ink-2",
      )}
      aria-label={t("Showing amounts in {code}. Change display currency", { code: d.code })}
    >
      {d.converted ? `${d.base} → ${d.code}` : d.base}
      <ArrowLeftRight className="h-3 w-3" />
    </button>
  );
}

function CurrencyPicker({
  base,
  code,
  live,
  ratesErr,
  manual,
  onRetry,
  onChoose,
  onManual,
  onClose,
}: {
  base: string;
  code: string;
  live: RatesResponse | null;
  ratesErr: string | null;
  manual: Record<string, number>;
  onRetry: () => void;
  onChoose: (c: string) => void;
  onManual: (c: string, r: number | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const options = [...new Set([base, ...CURRENCIES, ...Object.keys(live?.rates ?? {}).sort()])].filter(
    (c) => !q || c.includes(q.toUpperCase()),
  );
  const sample = base === "JPY" ? 10000 : 100;
  const current = code === base ? 1 : manual[code] ?? live?.rates[code];
  const [rateText, setRateText] = useState(manual[code] ? String(manual[code]) : "");

  useEffect(() => setRateText(manual[code] ? String(manual[code]) : ""), [code, manual]);

  return (
    <Modal open onClose={onClose} title={t("Show amounts in…")}>
      <p className="mb-3 text-sm text-ink-2">
        {t("Everything is recorded and settled in {base}. Pick your own currency to see the trip converted. This only changes your view and is remembered on this device.", { base })}
      </p>

      {code !== base && (
        <div className="mb-4 space-y-2 rounded-2xl bg-surface p-3 ring-1 ring-line">
          <p className="text-sm">
            {current ? (
              <>
                <b className="tabular">{formatMoney(sample, base)}</b> ≈ <b className="tabular">{formatMoney(sample * current, code)}</b>
                <span className="block text-xs text-ink-3">
                  1 {base} = {current.toPrecision(5)} {code} ·{" "}
                  {manual[code] ? t("your rate") : live ? `${live.source}, ${live.date}` : ""}
                </span>
              </>
            ) : ratesErr ? (
              <span className="text-neg">{ratesErr}</span>
            ) : (
              t("Fetching live rate…")
            )}
          </p>
          <Field label={t("Use my own rate (1 {base} = ? {code})", { base, code })} hint={t("Handy if you changed money at a different rate. Leave blank for the live rate.")}>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                className={inputCls}
                placeholder={live?.rates[code] ? String(live.rates[code]) : "e.g. 0.0048"}
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
              />
              <Button variant="secondary" onClick={() => onManual(code, Number(rateText) || null)}>
                {rateText ? t("Set") : t("Live")}
              </Button>
            </div>
          </Field>
          {ratesErr && (
            <Button variant="ghost" className="w-full" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> {t("Retry live rates")}
            </Button>
          )}
        </div>
      )}

      <input className={cx(inputCls, "mb-2")} placeholder={t("Search currency (e.g. GBP)")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Search currency")} />
      <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-2xl bg-surface ring-1 ring-line">
        {options.map((c) => {
          const r = c === base ? 1 : manual[c] ?? live?.rates[c];
          return (
            <button key={c} onClick={() => onChoose(c)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-stone-50">
              <span className="font-semibold">
                {c}
                {c === base && <span className="ml-2 text-xs font-normal text-ink-3">{t("trip currency")}</span>}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-3">
                {r && c !== base ? <span className="tabular">{formatMoney(sample * r, c)}</span> : null}
                {c === code && <Check className="h-4 w-4 text-brand" />}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
