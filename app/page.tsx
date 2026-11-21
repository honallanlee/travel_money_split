"use client";
import { ChevronRight, Database, Lock, LockOpen, Map as MapIcon, Plane, Plus, ReceiptText, Scale, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ImportBackup from "@/components/ImportBackup";
import UnlockModal from "@/components/UnlockModal";
import { Button, Card, Field, inputCls, SectionTitle } from "@/components/ui";
import { useTreasurer } from "@/components/useTreasurer";
import { api } from "@/lib/client";
import { LanguageToggle, useT } from "@/lib/i18n";
import { CURRENCIES, type Trip } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const tr = useTreasurer();
  const { t } = useT();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [storage, setStorage] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [cur, setCur] = useState("JPY");

  const load = useCallback(() => {
    api<{ trips: Trip[]; storage: string }>("/api/trips")
      .then((r) => {
        setTrips(r.trips);
        setStorage(r.storage);
      })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const loadDemo = async () => {
    setBusy(true);
    try {
      const trip = await api<Trip>("/api/demo", "POST");
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const trip = await api<Trip>("/api/trips", "POST", { name, base_currency: cur });
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
            <Plane className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Travel Hub</h1>
            <p className="text-xs text-ink-3">{t("Your group trip, all in one place")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
        <LanguageToggle />
        <button
          onClick={() => (tr.unlocked ? tr.lock() : setShowUnlock(true))}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-3 py-1.5 text-xs font-semibold ring-1 ring-line"
          aria-label={tr.unlocked ? t("Lock Treasurer Mode") : t("Unlock Treasurer Mode")}
        >
          {tr.unlocked ? <LockOpen className="h-4 w-4 text-brand" /> : <Lock className="h-4 w-4" />}
          {tr.unlocked ? t("Treasurer") : t("View only")}
        </button>
        </div>
      </header>

      {storage === "memory" && (
        <div className="mb-4 flex gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          <Database className="h-4 w-4 shrink-0" />
          <p>{t("Running without Supabase — data is kept in memory and resets when the server restarts. Add your Supabase keys to .env.local to persist.")}</p>
        </div>
      )}
      {err && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-neg">{err}</p>}

      <Card className="mb-2 p-4">
        <p className="text-sm leading-relaxed text-ink-2">
          {t("Travel Hub keeps everything for your group trip in one place — share the trip link and everyone can follow along on their phone.")}
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {(
            [
              [MapIcon, "Day-by-day itinerary, hotels & travel notes"],
              [Wallet, "Shared cash kitty run by the Treasurer"],
              [ReceiptText, "Split expenses & scan receipts"],
              [Scale, "Family balances & a simple settle-up plan"],
            ] as const
          ).map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-2 rounded-xl bg-stone-50 p-2">
              <Icon className="mt-px h-4 w-4 shrink-0 text-brand" />
              <span className="text-ink-2">{t(text)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <SectionTitle>{t("Trips")}</SectionTitle>
      {trips === null ? (
        <Card className="p-6 text-center text-sm text-ink-3">{t("Loading…")}</Card>
      ) : trips.length === 0 ? (
        <Card className="p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-brand" />
          <p className="font-semibold">{t("No trips yet")}</p>
          <p className="mb-4 mt-1 text-sm text-ink-2">{t("Load a sample Japan trip in yen — families, a cash kitty, card payments and a budget — to try everything out.")}</p>
          <Button onClick={loadDemo} disabled={busy} className="w-full">
            {busy ? t("Loading…") : t("Load Demo Trip Data")}
          </Button>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {trips.map((trip) => (
            <Link key={trip.id} href={`/trips/${trip.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-stone-50">
              <div>
                <p className="font-semibold">{trip.name}</p>
                <p className="text-xs text-ink-3">{t("Base currency {code}", { code: trip.base_currency })}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-ink-3" />
            </Link>
          ))}
        </Card>
      )}

      {tr.unlocked && (
        <>
          <SectionTitle>{t("New trip")}</SectionTitle>
          <Card className="p-4">
            <form onSubmit={create} className="space-y-3">
              <Field label={t("Trip name")}>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Japan 2026")} required />
              </Field>
              <Field label={t("Base currency")} hint={t("All balances and settlements are calculated in this currency.")}>
                <select className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
                <Plus className="h-4 w-4" /> {t("Create trip")}
              </Button>
            </form>
          </Card>
          {trips && trips.length > 0 && (
            <Button variant="ghost" className="mt-3 w-full" onClick={loadDemo} disabled={busy}>
              {t("Load another demo trip")}
            </Button>
          )}
          <SectionTitle>{t("Restore")}</SectionTitle>
          <ImportBackup className="w-full" onError={(m) => setErr(t(m))} />
          <p className="mt-2 px-1 text-xs text-ink-3">{t("Restoring creates a new copy of the trip; nothing is overwritten.")}</p>
        </>
      )}

      <UnlockModal open={showUnlock} onClose={() => setShowUnlock(false)} onUnlock={tr.unlock} />
    </main>
  );
}
