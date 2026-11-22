/*
 * Travel Hub service worker: lets the app open with no signal (mountain onsen towns).
 *
 * - Pages: network first; if offline, the last copy of that page (or the home page).
 * - Next.js build files (/_next/static): cache first (their names change on every deploy).
 * - Icons and images: served from cache, refreshed in the background.
 * - API calls are never cached here; the app keeps its own copy of each trip on the device
 *   and shows it read-only while offline.
 */
const VERSION = "v1";
const PAGES = `th-pages-${VERSION}`;
const STATIC = `th-static-${VERSION}`;
const ASSETS = `th-assets-${VERSION}`;
const KEEP = [PAGES, STATIC, ASSETS];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.addAll(["/"]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("th-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the files it already loaded (before this worker was active) so they work offline too.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    Promise.all(
      data.urls.slice(0, 200).map(async (u) => {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
          const isPage = data.pages && data.pages.includes(u);
          const cache = await caches.open(isPage ? PAGES : url.pathname.startsWith("/_next/static/") ? STATIC : ASSETS);
          if (await cache.match(url, { ignoreSearch: isPage })) return;
          const res = await fetch(url, { credentials: "same-origin" });
          if (res.ok) await cache.put(isPage ? url.pathname : url, res);
        } catch {}
      }),
    ),
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

async function networkFirstPage(request) {
  const url = new URL(request.url);
  const cache = await caches.open(PAGES);
  try {
    // A weak mountain signal can hang for a long time; fall back to the saved page after 6 s.
    const res = await Promise.race([fetch(request), timeout(6000)]);
    if (res.ok) cache.put(url.pathname, res.clone());
    return res;
  } catch {
    return (await cache.match(url.pathname)) || (await cache.match("/")) || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Next.js client-side navigation data; let the app handle failures itself.
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") return event.respondWith(networkFirstPage(request));
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(request, STATIC));
  if (/\.(png|jpe?g|svg|ico|webp|webmanifest|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest")
    return event.respondWith(staleWhileRevalidate(request));
});

const OFFLINE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Travel Hub — offline</title><body style="font-family:system-ui;padding:2rem;text-align:center;color:#334">
<h1 style="font-size:1.2rem">You're offline · 目前沒有網絡</h1>
<p>Open the trip once while you have signal and it will work offline next time.</p>
<p>請在有網絡時先開啟一次旅程，之後便可離線瀏覽。</p>
<button onclick="location.reload()" style="padding:.6rem 1.2rem;border-radius:.6rem;border:1px solid #ccc;background:#fff">Retry · 重試</button></body></html>`;
