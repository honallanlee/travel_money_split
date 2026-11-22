import type { GuideLink, TripGuide } from "./types";

export interface FoundLink extends GuideLink {
  /** where it appears, e.g. "Day 3 · 大石田 → 銀山温泉" */
  where: string;
}

/** Every hyperlink in a guide (items, options, hotels, notes), de-duplicated by URL. */
export function collectGuideLinks(g: TripGuide): FoundLink[] {
  const out = new Map<string, FoundLink>();
  const add = (links: GuideLink[] | undefined, where: string) => {
    for (const l of links ?? []) if (l?.url && !out.has(l.url)) out.set(l.url, { ...l, where });
  };
  const item = (it: { title: string; links?: GuideLink[]; options?: { title: string; links?: GuideLink[] }[] }, where: string) => {
    add(it.links, `${where} · ${it.title}`);
    for (const o of it.options ?? []) item(o, where);
  };
  for (const f of g.flights ?? []) item(f, "Flights");
  for (const d of g.days) for (const it of d.items) item(it, `Day ${d.day}`);
  for (const s of g.stays) add(s.links, `Hotel · ${s.name}`);
  for (const n of g.notes) add(n.links, `Note · ${n.title}`);
  return [...out.values()];
}
