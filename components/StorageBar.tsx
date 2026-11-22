"use client";
import { Database, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { StorageUsage } from "@/lib/types";
import { Card, cx } from "./ui";

const fmtBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`;

function Bar({ ratio }: { ratio: number }) {
  const pct = Math.min(100, ratio * 100);
  const tone = ratio >= 0.9 ? "bg-red-600" : ratio >= 0.75 ? "bg-amber-500" : "bg-teal-600";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={cx("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(pct, ratio > 0 ? 1.5 : 0)}%` }} />
    </div>
  );
}

/** Photo storage (Supabase Storage, 1 GB) and database (500 MB) usage, shared by all trips. */
export default function StorageBar({ refreshKey }: { refreshKey?: number }) {
  const { t } = useT();
  const [u, setU] = useState<StorageUsage | null>(null);
  useEffect(() => {
    api<StorageUsage>("/api/storage")
      .then(setU)
      .catch(() => {});
  }, [refreshKey]);
  if (!u) return null;
  const pr = u.photos.used / u.photos.limit;
  const dr = u.database.used !== null ? u.database.used / u.database.limit : null;
  return (
    <Card className="mb-3 space-y-3 p-3 text-xs">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-ink-2">
            <HardDrive className="h-3.5 w-3.5" /> {t("Photo storage")}
          </span>
          <span className="tabular text-ink-2">
            {t("{used} of {limit}", { used: fmtBytes(u.photos.used), limit: fmtBytes(u.photos.limit) })}
          </span>
        </div>
        <Bar ratio={pr} />
        <p className="mt-1 text-ink-3">
          {pr >= 0.95
            ? t("Storage is full — delete some photos to add more.")
            : t(u.photos.count === 1 ? "{n} photo · about {left} more fit" : "{n} photos · about {left} more fit", { n: u.photos.count, left: Math.max(0, Math.floor((u.photos.limit * 0.95 - u.photos.used) / 450_000)) })}
        </p>
      </div>
      {dr !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-ink-2">
              <Database className="h-3.5 w-3.5" /> {t("Database (expenses, itinerary, avatars)")}
            </span>
            <span className="tabular text-ink-2">{t("{used} of {limit}", { used: fmtBytes(u.database.used!), limit: fmtBytes(u.database.limit) })}</span>
          </div>
          <Bar ratio={dr} />
        </div>
      )}
    </Card>
  );
}
