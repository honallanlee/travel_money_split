import { json, treasurerRoute, type IdCtx } from "@/lib/http";
import { collectGuideLinks } from "@/lib/linkCheck";
import { getTripGuide } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface LinkResult {
  url: string;
  label: string;
  where: string;
  ok: boolean;
  status: number | null;
  /** final address after redirects, when different */
  finalUrl?: string;
  error?: string;
}

/** Only public web addresses: no localhost, private ranges or odd ports (the server does the fetching). */
function allowed(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.port && u.port !== "80" && u.port !== "443") return null;
    const h = u.hostname;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":")) return null;
    return u;
  } catch {
    return null;
  }
}

const UA = "Mozilla/5.0 (compatible; TravelHubLinkCheck/1.0)";

async function check(url: string): Promise<Pick<LinkResult, "ok" | "status" | "finalUrl" | "error">> {
  const u = allowed(url);
  if (!u) return { ok: false, status: null, error: "Not a public web address" };
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(u, { method, redirect: "follow", headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(10_000) });
    if (method === "GET") await res.body?.cancel().catch(() => {});
    return res;
  };
  try {
    let res = await attempt("HEAD");
    // Many sites refuse HEAD; try a real GET before calling the link broken.
    if (!res.ok) res = await attempt("GET");
    const finalUrl = res.url && res.url !== u.toString() ? res.url : undefined;
    return { ok: res.ok, status: res.status, finalUrl };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "Timed out" : ((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message);
    return { ok: false, status: null, error: msg };
  }
}

/** Treasurer only: checks every hyperlink in the guide from the server and reports which are unreachable. */
export const GET = treasurerRoute(async (_req: Request, { params }: IdCtx) => {
  const { id } = await params;
  const guide = await getTripGuide(id, true);
  if (!guide) return json({ results: [] });
  const links = collectGuideLinks(guide).slice(0, 150);
  const results: LinkResult[] = new Array(links.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < links.length) {
        const i = next++;
        results[i] = { url: links[i].url, label: links[i].label, where: links[i].where, ...(await check(links[i].url)) };
      }
    }),
  );
  return json({ checkedAt: new Date().toISOString(), results });
});
