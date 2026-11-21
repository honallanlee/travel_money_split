"use client";
import { ArrowLeftRight, Download, FileSpreadsheet, Languages, Users } from "lucide-react";
import { backupFilename, bundleToBackup } from "@/lib/backup";
import { downloadFile } from "@/lib/client";
import { buildTransactionsCsv } from "@/lib/exportCsv";
import { useT } from "@/lib/i18n";
import type { TripBundle } from "@/lib/types";
import { useDisplay } from "./DisplayCurrency";
import ImportBackup from "./ImportBackup";
import { Button, cx, Modal, SectionTitle } from "./ui";

export default function TripMenu({
  bundle,
  unlocked,
  onClose,
  onManage,
  onToast,
}: {
  bundle: TripBundle;
  unlocked: boolean;
  onClose: () => void;
  onManage: () => void;
  onToast: (msg: string) => void;
}) {
  const { t, lang, setLang } = useT();
  const d = useDisplay();

  const exportJson = () => {
    downloadFile(backupFilename(bundle.trip.name, "json"), JSON.stringify(bundleToBackup(bundle), null, 2), "application/json");
    onToast(t("Backup downloaded"));
  };
  const exportCsv = () => {
    downloadFile(backupFilename(bundle.trip.name, "csv"), buildTransactionsCsv(bundle, t), "text/csv;charset=utf-8");
    onToast(t("Spreadsheet downloaded"));
  };

  return (
    <Modal open onClose={onClose} title={t("Menu")}>
      <SectionTitle>{t("Language")}</SectionTitle>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label={t("Language")}>
        {(
          [
            ["en", "English"],
            ["zh-Hant", "繁體中文"],
          ] as const
        ).map(([code, label]) => (
          <button
            key={code}
            role="radio"
            aria-checked={lang === code}
            onClick={() => setLang(code)}
            className={cx("flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold", lang === code ? "bg-surface shadow-sm" : "text-ink-2")}
          >
            {lang === code && <Languages className="h-4 w-4" />}
            {label}
          </button>
        ))}
      </div>

      <SectionTitle>{t("Currency")}</SectionTitle>
      <Button
        variant="secondary"
        className="w-full justify-between"
        onClick={() => {
          onClose();
          d.openPicker();
        }}
      >
        <span className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" /> {t("Show amounts in…")}
        </span>
        <span className="text-ink-3">{d.code}</span>
      </Button>

      <SectionTitle>{t("Backup & export")}</SectionTitle>
      <p className="mb-2 px-1 text-xs text-ink-3">{t("Save a copy to this phone. The backup file can restore the whole trip if anything goes wrong.")}</p>
      <div className="space-y-2">
        <Button variant="secondary" className="w-full justify-start" onClick={exportJson}>
          <Download className="h-4 w-4" /> {t("Download backup (.json)")}
        </Button>
        <Button variant="secondary" className="w-full justify-start" onClick={exportCsv}>
          <FileSpreadsheet className="h-4 w-4" /> {t("Download spreadsheet (.csv)")}
        </Button>
        {unlocked && <ImportBackup className="w-full justify-start" onError={onToast} />}
      </div>
      {unlocked && <p className="mt-2 px-1 text-xs text-ink-3">{t("Restoring creates a new copy of the trip; nothing is overwritten.")}</p>}

      {unlocked && (
        <>
          <SectionTitle>{t("Treasurer")}</SectionTitle>
          <Button variant="secondary" className="w-full justify-start" onClick={onManage}>
            <Users className="h-4 w-4" /> {t("Trip & travellers")}
          </Button>
        </>
      )}
    </Modal>
  );
}
