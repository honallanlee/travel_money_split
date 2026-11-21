"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

export function useTreasurer() {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api<{ unlocked: boolean }>("/api/auth")
      .then((r) => setUnlocked(r.unlocked))
      .catch(() => setUnlocked(false))
      .finally(() => setChecked(true));
  }, []);

  const unlock = useCallback(async (password: string) => {
    await api("/api/auth", "POST", { password });
    setUnlocked(true);
  }, []);

  const lock = useCallback(async () => {
    await api("/api/auth", "DELETE").catch(() => {});
    setUnlocked(false);
  }, []);

  /** Call when a write returns 401 (session expired). */
  const expire = useCallback(() => setUnlocked(false), []);

  return { unlocked, checked, unlock, lock, expire };
}
