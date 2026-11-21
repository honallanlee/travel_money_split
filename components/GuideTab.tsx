"use client";
import {
  AlertTriangle,
  BedDouble,
  Bus,
  Car,
  ExternalLink,
  Footprints,
  Info,
  Lock,
  MapPin,
  Phone,
  Plane,
  StickyNote,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import type { GuideDay, GuideItem, GuideItemKind, GuideLink, GuideStay, TripGuide } from "@/lib/types";
import { Card, cx, SectionTitle } from "./ui";

const KIND: Record<GuideItemKind, { icon: LucideIcon; cls: string }> = {
  flight: { icon: Plane, cls: "bg-sky-50 text-sky-700" },
  train: { icon: TrainFront, cls: "bg-teal-50 text-teal-700" },
  bus: { icon: Bus, cls: "bg-emerald-50 text-emerald-700" },
  walk: { icon: Footprints, cls: "bg-stone-100 text-stone-600" },
  car: { icon: Car, cls: "bg-stone-100 text-stone-700" },
  meal: { icon: UtensilsCrossed, cls: "bg-amber-50 text-amber-700" },
  activity: { icon: Ticket, cls: "bg-violet-50 text-violet-700" },
  hotel: { icon: BedDouble, cls: "bg-rose-50 text-rose-700" },
  note: { icon: StickyNote, cls: "bg-stone-100 text-stone-600" },
};

const yen = (n: number) => `¥${n.toLocaleString("en-US")}`;
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const telUrl = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

/** Today's date (YYYY-MM-DD) in the trip's time zone. */
function todayIn(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

type Section = "days" | "stays" | "prep";

export default function GuideTab({ guide, unlocked }: { guide: TripGuide; unlocked: boolean }) {
  const { t, locale } = useT();
  const today = todayIn(guide.timezone);
  const todayDay = guide.days.find((d) => d.date === today)?.day;
  const [section, setSection] = useState<Section>("days");
  const [day, setDay] = useState<number>(todayDay ?? guide.days[0]?.day ?? 1);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem("tms:guide-section") as Section | null;
      if (s) setSection(s);
    } catch {}
  }, []);
  const pickSection = (s: Section) => {
    setSection(s);
    try {
      sessionStorage.setItem("tms:guide-section", s);
    } catch {}
  };

  const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
  const daysUntil = Math.round((Date.parse(guide.startDate) - Date.parse(today)) / 86_400_000);
  const status =
    todayDay !== undefined
      ? t("Today is Day {n} of {total}", { n: todayDay, total: guide.days.length })
      : daysUntil > 0
        ? t("Starts in {n} days", { n: daysUntil })
        : today > guide.endDate
          ? t("Trip finished")
          : "";

  const current = guide.days.find((d) => d.day === day) ?? guide.days[0];
  const stayFor = (key?: string) => guide.stays.find((s) => s.key === key);

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-700 to-sky-800 p-4 text-white">
          <p className="text-xs font-medium uppercase tracking-wider text-sky-100">{t("Trip guide")}</p>
          <h2 className="mt-0.5 text-xl font-bold leading-snug">{guide.title}</h2>
          {guide.subtitle && <p className="mt-1 text-xs leading-relaxed text-sky-100">{guide.subtitle}</p>}
          <p className="mt-2 text-sm font-semibold">
            {fmt(guide.startDate, { day: "numeric", month: "short" })} – {fmt(guide.endDate, { day: "numeric", month: "short", year: "numeric" })}
            {status && <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium">{status}</span>}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1 p-1.5" role="tablist" aria-label={t("Trip guide")}>
          {(
            [
              ["days", "Itinerary"],
              ["stays", "Hotels"],
              ["prep", "Before you go"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              onClick={() => pickSection(id)}
              className={cx("rounded-lg py-2 text-xs font-semibold", section === id ? "bg-indigo-50 text-indigo-800" : "text-ink-3")}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </Card>

      {section === "days" && current && (
        <>
          <div className="-mx-3 mt-3 overflow-x-auto px-3 pb-1">
            <div className="flex gap-1.5">
              {guide.days.map((d) => (
                <button
                  key={d.day}
                  onClick={() => setDay(d.day)}
                  className={cx(
                    "flex w-14 shrink-0 flex-col items-center rounded-xl py-1.5 ring-1 transition",
                    d.day === day ? "bg-indigo-700 text-white ring-indigo-700" : "bg-surface text-ink-2 ring-line",
                  )}
                  aria-pressed={d.day === day}
                  aria-label={t("Day {n}", { n: d.day })}
                >
                  <span className="text-[10px] font-semibold uppercase opacity-80">{t("Day {n}", { n: d.day })}</span>
                  <span className="text-sm font-bold">{fmt(d.date, { day: "numeric" })}</span>
                  <span className="text-[10px] opacity-80">{fmt(d.date, { weekday: "short" })}</span>
                  {d.date === today && <span className="mt-0.5 h-1 w-1 rounded-full bg-current" />}
                </button>
              ))}
            </div>
          </div>
          <DayView day={current} stay={stayFor(current.stay)} unlocked={unlocked} fmt={fmt} onStay={() => pickSection("stays")} />
        </>
      )}

      {section === "stays" && (
        <>
          <SectionTitle>{t("Hotels")}</SectionTitle>
          <div className="space-y-2">
            {guide.stays.map((s) => (
              <StayCard key={s.key} stay={s} unlocked={unlocked} fmt={fmt} />
            ))}
          </div>
        </>
      )}

      {section === "prep" && (
        <>
          {guide.flights && guide.flights.length > 0 && (
            <>
              <SectionTitle>{t("Flight details")}</SectionTitle>
              <Card className="divide-y divide-line">
                {guide.flights.map((f, i) => (
                  <ItemRow key={i} item={f} unlocked={unlocked} />
                ))}
              </Card>
            </>
          )}
          {guide.notes.map((n, i) => (
            <div key={i}>
              <SectionTitle>{n.title}</SectionTitle>
              <Card className="space-y-2 p-3 text-sm leading-relaxed">
                {n.lines.map((l, j) => (
                  <p key={j} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>{l}</span>
                  </p>
                ))}
                {n.table && (
                  <table className="w-full text-xs">
                    <tbody>
                      {n.table.map(([k, v]) => (
                        <tr key={k} className="border-t border-line">
                          <td className="py-1.5 pr-2 text-ink-3">{k}</td>
                          <td className="py-1.5 font-medium">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {n.links && <Links links={n.links} />}
              </Card>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DayView({
  day,
  stay,
  unlocked,
  fmt,
  onStay,
}: {
  day: GuideDay;
  stay?: GuideStay;
  unlocked: boolean;
  fmt: (d: string, o: Intl.DateTimeFormatOptions) => string;
  onStay: () => void;
}) {
  const { t } = useT();
  const dayCost = useMemo(() => day.items.reduce((a, i) => a + (i.cost && !i.who ? i.cost : 0), 0), [day.items]);
  return (
    <>
      <div className="mb-2 mt-4 px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {t("Day {n}", { n: day.day })} · {fmt(day.date, { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h3 className="text-lg font-bold leading-snug">{day.title}</h3>
        {dayCost > 0 && <p className="text-xs text-ink-3">{t("Planned fares & tickets ≈ {amount} per person", { amount: yen(dayCost) })}</p>}
      </div>
      <Card className="divide-y divide-line">
        {day.items.map((it, i) => (
          <ItemRow key={i} item={it} unlocked={unlocked} />
        ))}
      </Card>
      {stay ? (
        <button onClick={onStay} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-rose-50 p-3 text-left ring-1 ring-rose-200">
          <BedDouble className="h-5 w-5 shrink-0 text-rose-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-rose-900/70">{t("Tonight")}</span>
            <span className="block truncate text-sm font-semibold text-rose-950">{stay.name}</span>
          </span>
        </button>
      ) : (
        <p className="mt-3 px-1 text-xs text-ink-3">{t("No hotel tonight")}</p>
      )}
    </>
  );
}

function ItemRow({ item, unlocked, nested }: { item: GuideItem; unlocked: boolean; nested?: boolean }) {
  const { t } = useT();
  const k = KIND[item.kind] ?? KIND.note;
  const Icon = k.icon;
  return (
    <div className={cx("flex gap-3", nested ? "py-2" : "px-3 py-3")}>
      <div className={cx("grid shrink-0 place-items-center rounded-xl", nested ? "h-7 w-7" : "h-9 w-9", k.cls)}>
        <Icon className={nested ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {item.time && <p className="tabular text-xs font-semibold text-indigo-700">{item.time}</p>}
        <p className={cx("font-semibold leading-snug", nested ? "text-xs" : "text-sm")}>{item.title}</p>
        {item.who && <p className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800">{item.who}</p>}
        {item.detail && <p className="text-xs leading-relaxed text-ink-2">{item.detail}</p>}
        {(item.duration || item.cost) && (
          <p className="tabular text-xs text-ink-3">
            {[item.duration, item.cost ? yen(item.cost) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {item.alert && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {item.alert}
          </p>
        )}
        {item.notes?.map((n, i) => (
          <p key={i} className="flex gap-1.5 text-xs text-ink-2">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-3" /> {n}
          </p>
        ))}
        <Contact address={item.address} phone={item.phone} />
        {item.links && <Links links={item.links} />}
        <Private lines={item.private} has={item.hasPrivate} unlocked={unlocked} />
        {item.options && item.options.length > 0 && (
          <div className="mt-1 rounded-xl bg-stone-50 px-2.5 ring-1 ring-line">
            <p className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{t("Or")}</p>
            <div className="divide-y divide-line">
              {item.options.map((o, i) => (
                <ItemRow key={i} item={o} unlocked={unlocked} nested />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StayCard({ stay, unlocked, fmt }: { stay: GuideStay; unlocked: boolean; fmt: (d: string, o: Intl.DateTimeFormatOptions) => string }) {
  const { t } = useT();
  return (
    <Card className="space-y-1.5 p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700">
          <BedDouble className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{stay.name}</p>
          <p className="text-xs text-ink-3">
            {t(stay.nights.length === 1 ? "{n} night" : "{n} nights", { n: stay.nights.length })}: {stay.nights.map((n) => fmt(n, { day: "numeric", month: "short", weekday: "short" })).join(" · ")}
          </p>
        </div>
      </div>
      {(stay.checkIn || stay.checkOut) && (
        <p className="text-xs text-ink-2">
          {[stay.checkIn && t("Check-in {time}", { time: stay.checkIn }), stay.checkOut && t("Check-out {time}", { time: stay.checkOut })]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {stay.notes?.map((n, i) => (
        <p key={i} className="flex gap-1.5 text-xs text-ink-2">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-3" /> {n}
        </p>
      ))}
      <Contact address={stay.address} phone={stay.phone} />
      {stay.links && <Links links={stay.links} />}
      <Private lines={stay.private} has={stay.hasPrivate} unlocked={unlocked} />
    </Card>
  );
}

function Contact({ address, phone }: { address?: string; phone?: string }) {
  if (!address && !phone) return null;
  return (
    <div className="space-y-1">
      {address && (
        <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-xs text-indigo-700 underline-offset-2 hover:underline">
          <MapPin className="mt-px h-3.5 w-3.5 shrink-0" /> {address}
        </a>
      )}
      {phone && (
        <a href={telUrl(phone)} className="flex items-center gap-1.5 text-xs text-indigo-700">
          <Phone className="h-3.5 w-3.5 shrink-0" /> {phone}
        </a>
      )}
    </div>
  );
}

function Links({ links }: { links: GuideLink[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200"
        >
          {l.label} <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

/** Booking references: shown in Treasurer Mode, otherwise just a lock hint. */
function Private({ lines, has, unlocked }: { lines?: string[]; has?: boolean; unlocked: boolean }) {
  const { t } = useT();
  if (lines?.length && unlocked)
    return (
      <div className="rounded-lg bg-stone-100 px-2 py-1.5">
        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          <Lock className="h-3 w-3" /> {t("Booking details")}
        </p>
        {lines.map((l, i) => (
          <p key={i} className="tabular select-all text-xs text-ink-2">
            {l}
          </p>
        ))}
      </div>
    );
  if (has || lines?.length)
    return (
      <p className="flex items-center gap-1 text-[11px] text-ink-3">
        <Lock className="h-3 w-3" /> {t("Booking references visible in Treasurer Mode")}
      </p>
    );
  return null;
}
