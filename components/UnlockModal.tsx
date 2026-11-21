"use client";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { Button, inputCls, Modal } from "./ui";

export default function UnlockModal({
  open,
  onClose,
  onUnlock,
}: {
  open: boolean;
  onClose: () => void;
  onUnlock: (password: string) => Promise<void>;
}) {
  const { t } = useT();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onUnlock(pw);
      setPw("");
      onClose();
    } catch (e) {
      setErr(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Unlock Treasurer Mode")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-teal-50 p-3 text-sm text-teal-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("Treasurer Mode lets you add, edit and delete expenses, deposits, people and budgets. Everyone else sees a read-only view.")}</p>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className={inputCls}
          placeholder={t("Treasurer password")}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-label={t("Treasurer password")}
        />
        {err && <p className="text-sm text-neg">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy || !pw}>
          {busy ? t("Checking…") : t("Unlock")}
        </Button>
      </form>
    </Modal>
  );
}
