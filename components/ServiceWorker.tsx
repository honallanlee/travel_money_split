"use client";
import { useEffect } from "react";

/**
 * Registers /sw.js (production only) so the app can open with no signal, and hands it
 * the page and files already loaded, which the worker could not see on the first visit.
 */
const enabled = () => process.env.NODE_ENV === "production" && typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Ask the worker to keep the current page and every file loaded so far (call after in-app navigation). */
export function cacheThisPage() {
  if (!enabled()) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      const files = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && !u.includes("/api/"));
      const page = location.pathname;
      reg.active?.postMessage({ type: "precache", urls: [page, ...files], pages: [page] });
    })
    .catch(() => {});
}

export default function ServiceWorker() {
  useEffect(() => {
    if (!enabled()) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(cacheThisPage)
      .catch(() => {});
  }, []);
  return null;
}
