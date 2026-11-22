"use client";
import { CheckCircle2, Link2Off, LoaderCircle, SearchCheck } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { LinkResult } from "@/app/api/trips/[id]/guide/links/route";
import { Button } from "./ui";

/** Treasurer tool: asks the server to open every link in the guide and lists the broken ones. */
export default function LinkCheck({ tripId }: { tripId: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LinkResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ results: LinkResult[] }>(`/api/trips/${tripId}/guide/links`);
      setResults(r.results);
    } catch (e) {
      setErr(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const bad = results?.filter((r) => !r.ok) ?? [];
  return (
    <div>
      <Button variant="secondary" className="w-full py-1.5 text-xs" onClick={run} disabled={busy}>
        {busy ? <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
        {busy ? t("Checking links…") : t("Check all links")}
      </Button>
      {err && <p className="mt-1 text-neg">{err}</p>}
      {results && (
        <div className="mt-2 rounded-lg bg-white/70 p-2 ring-1 ring-amber-200">
          {bad.length === 0 ? (
            <p className="flex items-center gap-1 text-pos">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("All {n} links open", { n: results.length })}
            </p>
          ) : (
            <>
              <p className="mb-1 font-semibold">{t("{bad} of {n} links didn't open:", { bad: bad.length, n: results.length })}</p>
              <ul className="space-y-1.5">
                {bad.map((r) => (
                  <li key={r.url} className="flex gap-1.5">
                    <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neg" />
                    <span className="min-w-0">
                      <span className="block font-medium">{r.where} — {r.label}</span>
                      <a href={r.url} target="_blank" rel="noreferrer" className="block break-all text-indigo-700 underline">
                        {r.url}
                      </a>
                      <span className="text-ink-3">{r.status ? `HTTP ${r.status}` : r.error}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {results.some((r) => r.ok && r.finalUrl) && (
            <p className="mt-2 text-ink-3">{t("Some links redirect to a new address; they still work.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
