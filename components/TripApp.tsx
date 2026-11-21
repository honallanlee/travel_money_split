"use client";
import {
  ArrowLeft,
  BarChart3,
  Camera,
  CloudOff,
  Coins,
  Database,
  Images,
  ListOrdered,
  Lock,
  LockOpen,
  Menu,
  Plus,
  Receipt,
  Scale,
  Target,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { computeLedger } from "@/lib/settlement";
import type { Transaction, TripBundle, TxType } from "@/lib/types";
import AnalyticsTab from "./AnalyticsTab";
import BalancesTab from "./BalancesTab";
import { DisplayCurrencyChip, DisplayCurrencyProvider, useDisplay } from "./DisplayCurrency";
import FeedTab from "./FeedTab";
import PeopleModal from "./PeopleModal";
import PhotosTab from "./PhotosTab";
import PlannerTab from "./PlannerTab";
import TransactionModal, { type TxModalState } from "./TransactionModal";
import TripMenu from "./TripMenu";
import { cx, Toast } from "./ui";
import UnlockModal from "./UnlockModal";
import { useTreasurer } from "./useTreasurer";

type Tab = "feed" | "balances" | "photos" | "analytics" | "planner";
const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  { id: "feed", label: "Feed", icon: ListOrdered },
  { id: "balances", label: "Settle", icon: Scale },
  { id: "photos", label: "Photos", icon: Images },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "planner", label: "Planner", icon: Target },
];

export type RunMutation = (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
export type LoadedBundle = TripBundle & { storage?: string };
type Offline = { savedAt: string } | null;

const cacheKey = (id: string) => `tms:cache:${id}`;

export default function TripApp({ tripId }: { tripId: string }) {
  const tr = useTreasurer();
  const { t } = useT();
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [offline, setOffline] = useState<Offline>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
  const [toast, setToast] = useState<string | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [txModal, setTxModal] = useState<TxModalState | null>(null);

  /**
   * Loads the trip and keeps a copy on this device. If the server or database is
   * unreachable ("fallout mode"), the last saved copy is shown read-only instead.
   */
  const reload = useCallback(async () => {
    try {
      const fresh = await api<LoadedBundle>(`/api/trips/${tripId}`);
      setBundle(fresh);
      setOffline(null);
      setLoadErr(null);
      try {
        localStorage.setItem(cacheKey(tripId), JSON.stringify({ savedAt: new Date().toISOString(), bundle: fresh }));
      } catch {}
    } catch (e) {
      const notFound = e instanceof ApiError && e.status === 404;
      let cached: { savedAt: string; bundle: LoadedBundle } | null = null;
      try {
        cached = notFound ? null : JSON.parse(localStorage.getItem(cacheKey(tripId)) ?? "null");
      } catch {}
      if (cached?.bundle) {
        setBundle({ ...cached.bundle, photos: cached.bundle.photos ?? [] });
        setOffline({ savedAt: cached.savedAt });
      } else setLoadErr((e as Error).message);
    }
  }, [tripId]);

  useEffect(() => {
    reload();
    try {
      const saved = localStorage.getItem("tms:tab") as Tab | null;
      if (saved && TABS.some((x) => x.id === saved)) setTab(saved);
    } catch {}
  }, [reload]);

  const selectTab = (id: Tab) => {
    setTab(id);
    window.scrollTo({ top: 0 });
    try {
      localStorage.setItem("tms:tab", id);
    } catch {}
  };

  const run: RunMutation = useCallback(
    async (fn, success) => {
      try {
        await fn();
        await reload();
        if (success) setToast(t(success));
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          tr.expire();
          setToast(t("Session expired — unlock again"));
        } else setToast(t((e as Error).message));
        return false;
      }
    },
    [reload, tr, t],
  );

  const ledger = useMemo(() => (bundle ? computeLedger(bundle) : null), [bundle]);
  const canEdit = tr.unlocked && !offline;

  const openNew = (type: TxType, scanFile?: File) => {
    setFabOpen(false);
    setTxModal({ mode: "new", type, scanFile });
  };
  const openEdit = (tx: Transaction) => canEdit && setTxModal({ mode: "edit", tx });

  if (loadErr && !bundle) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4 text-neg">{loadErr}</p>
        <Link href="/" className="text-brand underline">
          {t("Back to trips")}
        </Link>
      </main>
    );
  }
  if (!bundle || !ledger) {
    return <main className="mx-auto max-w-md p-6 text-center text-ink-3">{t("Loading trip…")}</main>;
  }

  const cur = bundle.trip.base_currency;

  return (
    <DisplayCurrencyProvider base={cur} tripId={bundle.trip.id}>
      <div className="mx-auto min-h-dvh max-w-md pb-28">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center gap-1.5">
            <Link href="/" className="rounded-full p-2 text-ink-2 hover:bg-stone-200" aria-label={t("All trips")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-bold leading-tight">{bundle.trip.name}</h1>
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <DisplayCurrencyChip />
                <span>{t("{n} travellers", { n: bundle.participants.length })}</span>
              </div>
            </div>
            <button
              onClick={() => (tr.unlocked ? tr.lock().then(() => setToast(t("Treasurer Mode locked"))) : setShowUnlock(true))}
              className={cx(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1",
                tr.unlocked ? "bg-teal-50 text-brand ring-teal-200" : "bg-surface text-ink-2 ring-line",
              )}
              aria-label={tr.unlocked ? t("Lock Treasurer Mode") : t("Unlock Treasurer Mode")}
            >
              {tr.unlocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {tr.unlocked ? t("Treasurer") : t("View only")}
            </button>
            <button onClick={() => setShowMenu(true)} className="rounded-full p-2 text-ink-2 hover:bg-stone-200" aria-label={t("Menu")}>
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        {offline && (
          <div className="mx-3 mt-3 flex gap-2 rounded-xl bg-red-50 p-2.5 text-xs text-red-900 ring-1 ring-red-200">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>
              {t("Can't reach the server — showing the copy saved on this device ({time}). Editing is paused.", {
                time: new Date(offline.savedAt).toLocaleString(),
              })}{" "}
              <button className="font-semibold underline" onClick={reload}>
                {t("Retry")}
              </button>
            </span>
          </div>
        )}
        {bundle.storage === "memory" && !offline && (
          <div className="mx-3 mt-3 flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
            <Database className="h-4 w-4 shrink-0" /> {t("In-memory demo storage — data resets when the server restarts.")}
          </div>
        )}
        <ConversionNote />

        <main className="px-3 pt-4">
          {tab === "feed" && <FeedTab bundle={bundle} ledger={ledger} unlocked={canEdit} onEdit={openEdit} onAddFirst={() => setShowPeople(true)} />}
          {tab === "balances" && <BalancesTab bundle={bundle} ledger={ledger} onCopied={() => setToast(t("Copied — paste into WhatsApp"))} />}
          {tab === "photos" && <PhotosTab bundle={bundle} unlocked={canEdit} offline={!!offline} run={run} />}
          {tab === "analytics" && <AnalyticsTab bundle={bundle} />}
          {tab === "planner" && <PlannerTab bundle={bundle} unlocked={canEdit} run={run} />}
        </main>

        {/* Floating add button (Treasurer Mode) */}
        {canEdit && (
          <div className="fixed bottom-20 right-[max(1rem,calc(50vw-14rem+1rem))] z-40 flex flex-col items-end gap-2">
            {fabOpen && (
              <div className="mb-1 flex flex-col items-end gap-2">
                <FabItem icon={Receipt} label={t("Log Expense")} onClick={() => openNew("CASH_EXPENSE")} />
                <label className="flex cursor-pointer items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-3 text-sm font-semibold shadow-lg ring-1 ring-line">
                  {t("Scan Receipt")} <Camera className="h-5 w-5 text-brand" />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) openNew("CASH_EXPENSE", f);
                    }}
                  />
                </label>
                <FabItem icon={Coins} label={t("Log Cash Deposit")} onClick={() => openNew("CASH_DEPOSIT")} />
              </div>
            )}
            <button
              onClick={() => setFabOpen((o) => !o)}
              className="flex h-14 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-xl shadow-teal-900/20"
              aria-expanded={fabOpen}
              aria-label={t("Add")}
            >
              {fabOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {fabOpen ? t("Close") : t("Add")}
            </button>
          </div>
        )}

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto grid max-w-md grid-cols-5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => selectTab(id)}
                className={cx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", tab === id ? "text-brand" : "text-ink-3")}
                aria-current={tab === id ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                {t(label)}
              </button>
            ))}
          </div>
        </nav>

        <UnlockModal open={showUnlock} onClose={() => setShowUnlock(false)} onUnlock={tr.unlock} />
        {showMenu && (
          <TripMenu
            bundle={bundle}
            unlocked={canEdit}
            onClose={() => setShowMenu(false)}
            onManage={() => {
              setShowMenu(false);
              setShowPeople(true);
            }}
            onToast={setToast}
          />
        )}
        {showPeople && canEdit && <PeopleModal bundle={bundle} run={run} onClose={() => setShowPeople(false)} />}
        {txModal && canEdit && (
          <TransactionModal
            key={txModal.mode === "edit" ? txModal.tx.id : "new"}
            state={txModal}
            bundle={bundle}
            run={run}
            onClose={() => setTxModal(null)}
          />
        )}
        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    </DisplayCurrencyProvider>
  );
}

function FabItem({ icon: Icon, label, onClick }: { icon: typeof Receipt; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-3 text-sm font-semibold shadow-lg ring-1 ring-line">
      {label} <Icon className="h-5 w-5 text-brand" />
    </button>
  );
}

function ConversionNote() {
  const d = useDisplay();
  const { t } = useT();
  if (!d.converted) return null;
  return (
    <button onClick={d.openPicker} className="mx-3 mt-3 block w-[calc(100%-1.5rem)] rounded-xl bg-sky-50 px-3 py-2 text-left text-xs text-sky-900 ring-1 ring-sky-200">
      {t("Showing amounts in {code} at 1 {base} = {rate} {code}.", { code: d.code, base: d.base, rate: d.rate.toPrecision(4) })}{" "}
      {d.rateInfo?.manual ? t("(your rate)") : d.rateInfo?.date ? `(${d.rateInfo.date})` : ""} {t("Recorded & settled in {base}.", { base: d.base })}
    </button>
  );
}
