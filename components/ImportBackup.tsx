"use client";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { Trip } from "@/lib/types";
import { Button } from "./ui";

/** Treasurer-only: restore a downloaded backup as a new trip. */
export default function ImportBackup({ onError, className }: { onError: (msg: string) => void; className?: string }) {
  const { t } = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(t("That file isn't valid JSON"));
      }
      const trip = await api<Trip>("/api/import", "POST", data);
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" className={className} disabled={busy} onClick={() => input.current?.click()}>
        <Upload className="h-4 w-4" /> {busy ? t("Restoring…") : t("Restore from backup file")}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}
