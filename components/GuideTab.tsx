"use client";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BedDouble,
  Bus,
  Car,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Download,
  ExternalLink,
  Footprints,
  Info,
  Lock,
  MapPin,
  Pencil,
  Phone,
  Plane,
  Plus,
  StickyNote,
  Ticket,
  TrainFront,
  Trash2,
  Users,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { downloadFile } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { GuideDay, GuideItem, GuideItemKind, GuideLink, GuideStay, GuideWeather, TripGuide } from "@/lib/types";
import { weatherCategory, weatherForDay, type DayWeather, type LiveDay, type LiveWeather } from "@/lib/weather";
import { todayIn } from "@/lib/dates";
import { telE164 } from "@/lib/phone";
import LinkCheck from "./LinkCheck";
import GuideEditor, { editGuide, isRedacted, itemList, type GuideTarget } from "./GuideEditor";
import { Button, Card, cx, SectionTitle } from "./ui";

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
const telUrl = (p: string) => `tel:${telE164(p)}`;
const deg = (n: number | null) => (n === null ? "–" : `${n}°`);

/** Today's date (YYYY-MM-DD) in the trip's time zone. */

type Section = "days" | "stays" | "prep";

const WX_ICON: Record<ReturnType<typeof weatherCategory>, LucideIcon> = {
  sun: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

/**
 * Live forecasts / recorded weather for the guide's places (those with coordinates), fetched
 * once per visit via /api/weather and kept on the device for offline use.
 */
function useLiveWeather(guide: TripGuide): LiveWeather | null {
  const places = (guide.weather?.places ?? []).filter((p) => typeof p.lat === "number" && typeof p.lon === "number");
  const key = `tms:wx:${guide.startDate}:${places.map((p) => p.name).join(",")}`;
  const [live, setLive] = useState<LiveWeather | null>(null);
  useEffect(() => {
    if (!places.length) return;
    try {
      const cached = localStorage.getItem(key);
      if (cached) setLive(JSON.parse(cached));
    } catch {}
    const qs = new URLSearchParams({
      lat: places.map((p) => p.lat).join(","),
      lon: places.map((p) => p.lon).join(","),
      start: guide.startDate,
      end: guide.endDate,
      tz: guide.timezone || "Asia/Tokyo",
    });
    api<{ today: string; available: boolean; places: { days: LiveDay[] }[] }>(`/api/weather?${qs}`)
      .then((r) => {
        const byPlace: LiveWeather["byPlace"] = {};
        r.places.forEach((p, i) => (byPlace[places[i].name] = Object.fromEntries(p.days.map((d) => [d.date, d]))));
        const next = { today: r.today, available: r.available, byPlace };
        setLive(next);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, guide.endDate]);
  return live;
}
type Fmt = (d: string, o: Intl.DateTimeFormatOptions) => string;

/** Edit actions handed down to rows while the Treasurer is editing. */
interface EditCtx {
  open: (t: GuideTarget) => void;
  /** apply a change and save immediately (delete / reorder) */
  apply: (fn: (g: TripGuide) => void, confirmText?: string) => void;
}

export default function GuideTab({
  tripId,
  guide,
  unlocked,
  canEdit,
  onSave,
}: {
  tripId: string;
  guide: TripGuide;
  unlocked: boolean;
  canEdit: boolean;
  onSave: (next: TripGuide) => Promise<boolean>;
}) {
  const { t, locale } = useT();
  const today = todayIn(guide.timezone);
  const todayDay = guide.days.find((d) => d.date === today)?.day;
  const [section, setSection] = useState<Section>("days");
  const [day, setDay] = useState<number>(todayDay ?? guide.days[0]?.day ?? 1);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<GuideTarget | null>(null);
  const live = useLiveWeather(guide);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem("tms:guide-section") as Section | null;
      if (s) setSection(s);
    } catch {}
  }, []);
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);
  const pickSection = (s: Section) => {
    setSection(s);
    try {
      sessionStorage.setItem("tms:guide-section", s);
    } catch {}
  };

  const redacted = isRedacted(guide);
  const ctx: EditCtx | null =
    editing && !redacted
      ? {
          open: setTarget,
          apply: (fn, confirmText) => {
            if (confirmText && !confirm(confirmText)) return;
            onSave(editGuide(guide, fn));
          },
        }
      : null;

  const fmt: Fmt = (date, opts) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
  const daysUntil = Math.round((Date.parse(guide.startDate) - Date.parse(today)) / 86_400_000);
  const status =
    todayDay !== undefined
      ? t("Today is Day {n} of {total}", { n: todayDay, total: guide.days.length })
      : daysUntil > 0
        ? t("Starts in {n} days", { n: daysUntil })
        : today > guide.endDate
          ? t("Trip finished")
          : "";

  const dayIndex = Math.max(0, guide.days.findIndex((d) => d.day === day));
  const current = guide.days[dayIndex];
  const stayFor = (key?: string) => guide.stays.find((s) => s.key === key);

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-700 to-sky-800 p-4 text-white">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-100">{t("Trip guide")}</p>
            {canEdit && (
              <button
                onClick={() => setEditing((e) => !e)}
                className="-mr-1 -mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold"
                aria-pressed={editing}
              >
                {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {editing ? t("Done") : t("Edit guide")}
              </button>
            )}
          </div>
          <h2 className="mt-0.5 text-xl font-bold leading-snug">{guide.title}</h2>
          {guide.subtitle && <p className="mt-1 text-xs leading-relaxed text-sky-100">{guide.subtitle}</p>}
          <p className="mt-2 text-sm font-semibold">
            {fmt(guide.startDate, { day: "numeric", month: "short" })} – {fmt(guide.endDate, { day: "numeric", month: "short", year: "numeric" })}
            {status && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium">{status}</span>}
          </p>
        </div>
        {editing && (
          <div className="space-y-2 border-b border-line bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {redacted ? (
              <p>{t("Reloading the full guide for editing…")}</p>
            ) : (
              <p>{t("Editing: changes save immediately and everyone sees them. Use ✏️ to edit, 🗑 to delete, ↑↓ to reorder.")}</p>
            )}
            <Button
              variant="secondary"
              className="w-full py-1.5 text-xs"
              onClick={() =>
                downloadFile(`trip-guide-${guide.startDate}.json`, JSON.stringify(guide, null, 2), "application/json")
              }
            >
              <Download className="h-3.5 w-3.5" /> {t("Download guide backup (.json)")}
            </Button>
            <LinkCheck tripId={tripId} />
          </div>
        )}
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
                  <MiniWeather w={weatherForDay(guide.weather, live, d.date, d.weatherPlaces ?? [])[0]} />
                  {d.date === today && <span className="mt-0.5 h-1 w-1 rounded-full bg-current" />}
                </button>
              ))}
            </div>
          </div>
          <DayView
            day={current}
            dayIndex={dayIndex}
            stay={stayFor(current.stay)}
            weather={guide.weather}
            live={live}
            unlocked={unlocked}
            fmt={fmt}
            ctx={ctx}
            onStay={() => pickSection("stays")}
          />
        </>
      )}

      {section === "stays" && (
        <>
          <SectionTitle
            action={
              ctx && (
                <AddButton onClick={() => ctx.open({ kind: "newStay" })} label={t("Add hotel")} />
              )
            }
          >
            {t("Hotels")}
          </SectionTitle>
          <div className="space-y-2">
            {guide.stays.map((s, i) => (
              <StayCard
                key={s.key}
                stay={s}
                unlocked={unlocked}
                fmt={fmt}
                controls={
                  ctx && (
                    <RowControls
                      onEdit={() => ctx.open({ kind: "stay", index: i })}
                      onDelete={() =>
                        ctx.apply((g) => {
                          g.stays.splice(i, 1);
                          for (const d of g.days) if (d.stay === s.key) d.stay = undefined;
                        }, t('Delete "{name}"?', { name: s.name }))
                      }
                    />
                  )
                }
              />
            ))}
          </div>
        </>
      )}

      {section === "prep" && (
        <>
          {(guide.flights?.length || ctx) && (
            <>
              <SectionTitle action={ctx && <AddButton onClick={() => ctx.open({ kind: "newItem", list: "flights" })} label={t("Add item")} />}>
                {t("Flight details")}
              </SectionTitle>
              {guide.flights && guide.flights.length > 0 && (
                <Card className="divide-y divide-line">
                  {guide.flights.map((f, i) => (
                    <ItemRow key={i} item={f} unlocked={unlocked} ctx={ctx} list="flights" index={i} count={guide.flights!.length} />
                  ))}
                </Card>
              )}
            </>
          )}

          {(guide.weather || ctx) && (
            <>
              <SectionTitle action={ctx && <SmallEdit onClick={() => ctx.open({ kind: "weather" })} />}>
                {guide.weather?.title ?? t("Weather")}
              </SectionTitle>
              {guide.weather && <WeatherTable weather={guide.weather} fmt={fmt} today={today} />}
            </>
          )}

          {guide.notes.map((n, i) => (
            <div key={i}>
              <SectionTitle
                action={
                  ctx && (
                    <RowControls
                      compact
                      onEdit={() => ctx.open({ kind: "note", index: i })}
                      onDelete={() => ctx.apply((g) => void g.notes.splice(i, 1), t('Delete "{name}"?', { name: n.title }))}
                      onUp={i > 0 ? () => ctx.apply((g) => void g.notes.splice(i - 1, 0, ...g.notes.splice(i, 1))) : undefined}
                      onDown={i < guide.notes.length - 1 ? () => ctx.apply((g) => void g.notes.splice(i + 1, 0, ...g.notes.splice(i, 1))) : undefined}
                    />
                  )
                }
              >
                {n.title}
              </SectionTitle>
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
          {ctx && (
            <Button variant="secondary" className="mt-4 w-full" onClick={() => ctx.open({ kind: "newNote" })}>
              <Plus className="h-4 w-4" /> {t("Add section")}
            </Button>
          )}
        </>
      )}

      {target && <GuideEditor guide={guide} target={target} onCancel={() => setTarget(null)} onSave={onSave} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DayView({
  day,
  dayIndex,
  stay,
  weather,
  live,
  unlocked,
  fmt,
  ctx,
  onStay,
}: {
  day: GuideDay;
  dayIndex: number;
  stay?: GuideStay;
  weather?: GuideWeather;
  live: LiveWeather | null;
  unlocked: boolean;
  fmt: Fmt;
  ctx: EditCtx | null;
  onStay: () => void;
}) {
  const { t } = useT();
  const dayCost = useMemo(() => day.items.reduce((a, i) => a + (i.cost && !i.who ? i.cost : 0), 0), [day.items]);
  const forecast = weatherForDay(weather, live, day.date, day.weatherPlaces ?? []);

  return (
    <>
      <div className="mb-2 mt-4 flex items-start justify-between gap-2 px-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("Day {n}", { n: day.day })} · {fmt(day.date, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h3 className="text-lg font-bold leading-snug">{day.title}</h3>
          {dayCost > 0 && <p className="text-xs text-ink-3">{t("Planned fares & tickets ≈ {amount} per person", { amount: yen(dayCost) })}</p>}
        </div>
        {ctx && <SmallEdit onClick={() => ctx.open({ kind: "day", index: dayIndex })} />}
      </div>

      {forecast.length > 0 && (
        <div className="mb-2 grid gap-1.5">
          {forecast.map((w) => (
            <WeatherCard key={w.place} w={w} />
          ))}
        </div>
      )}

      <Card className="divide-y divide-line">
        {day.items.map((it, i) => (
          <ItemRow key={i} item={it} unlocked={unlocked} ctx={ctx} list={day.day} index={i} count={day.items.length} />
        ))}
        {day.items.length === 0 && <p className="p-4 text-center text-sm text-ink-3">{t("Nothing planned yet.")}</p>}
      </Card>
      {ctx && (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => ctx.open({ kind: "newItem", list: day.day })}>
          <Plus className="h-4 w-4" /> {t("Add item")}
        </Button>
      )}
      {stay ? (
        <button onClick={onStay} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-rose-50 p-3 text-left ring-1 ring-rose-200">
          <BedDouble className="h-5 w-5 shrink-0 text-rose-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-rose-900/70">
              {t("Tonight")}
              {stay.who ? ` · ${stay.who}` : ""}
            </span>
            <span className="block truncate text-sm font-semibold text-rose-950">{stay.name}</span>
          </span>
        </button>
      ) : (
        <p className="mt-3 px-1 text-xs text-ink-3">{t("No hotel tonight")}</p>
      )}
    </>
  );
}

function ItemRow({
  item,
  unlocked,
  nested,
  ctx,
  list,
  index,
  count,
  option,
}: {
  item: GuideItem;
  unlocked: boolean;
  nested?: boolean;
  ctx?: EditCtx | null;
  list?: "flights" | number;
  index?: number;
  count?: number;
  option?: number;
}) {
  const { t } = useT();
  const k = KIND[item.kind] ?? KIND.note;
  const Icon = k.icon;
  const canEdit = ctx && list !== undefined && index !== undefined;
  const move = (dir: -1 | 1) =>
    ctx!.apply((g) => {
      const arr = itemList(g, list!);
      arr.splice(index! + dir, 0, ...arr.splice(index!, 1));
    });

  return (
    <div className={cx("flex gap-3", nested ? "py-2" : "px-3 py-3")}>
      <div className={cx("grid shrink-0 place-items-center rounded-xl", nested ? "h-7 w-7" : "h-9 w-9", k.cls)}>
        <Icon className={nested ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {item.time && <p className="tabular text-xs font-semibold text-indigo-700">{item.time}</p>}
            <p className={cx("font-semibold leading-snug", nested ? "text-xs" : "text-sm")}>{item.title}</p>
          </div>
          {canEdit && (
            <RowControls
              compact
              onEdit={() => ctx!.open({ kind: "item", list: list!, index: index!, option })}
              onDelete={() =>
                ctx!.apply((g) => {
                  const arr = itemList(g, list!);
                  if (option === undefined) arr.splice(index!, 1);
                  else arr[index!].options!.splice(option, 1);
                }, t('Delete "{name}"?', { name: item.title }))
              }
              onUp={option === undefined && index! > 0 ? () => move(-1) : undefined}
              onDown={option === undefined && count !== undefined && index! < count - 1 ? () => move(1) : undefined}
            />
          )}
        </div>
        {item.who && <p className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800">{item.who}</p>}
        {item.detail && <p className="text-xs leading-relaxed text-ink-2">{item.detail}</p>}
        {(item.duration || item.cost) && (
          <p className="tabular text-xs text-ink-3">{[item.duration, item.cost ? yen(item.cost) : null].filter(Boolean).join(" · ")}</p>
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
                <ItemRow key={i} item={o} unlocked={unlocked} nested ctx={ctx} list={list} index={index} option={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StayCard({ stay, unlocked, fmt, controls }: { stay: GuideStay; unlocked: boolean; fmt: Fmt; controls?: ReactNode }) {
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
            {t(stay.nights.length === 1 ? "{n} night" : "{n} nights", { n: stay.nights.length })}:{" "}
            {stay.nights.map((n) => fmt(n, { day: "numeric", month: "short", weekday: "short" })).join(" · ")}
          </p>
          {stay.who && <p className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800">{stay.who}</p>}
        </div>
        {controls}
      </div>
      {(stay.checkIn || stay.checkOut) && (
        <p className="text-xs text-ink-2">
          {[stay.checkIn && t("Check-in {time}", { time: stay.checkIn }), stay.checkOut && t("Check-out {time}", { time: stay.checkOut })]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {stay.rooms && stay.rooms.length > 0 && (
        <div className="rounded-lg bg-stone-50 px-2 py-1.5">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <Users className="h-3 w-3" /> {t("Rooms")}
          </p>
          {stay.rooms.map((r, i) => (
            <p key={i} className="text-xs text-ink-2">
              {r}
            </p>
          ))}
        </div>
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

function WeatherTable({ weather, fmt, today }: { weather: GuideWeather; fmt: Fmt; today: string }) {
  const { t } = useT();
  return (
    <Card className="overflow-hidden">
      {weather.note && <p className="border-b border-line px-3 py-2 text-xs text-ink-2">{weather.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-max min-w-full text-xs">
          <thead>
            <tr className="bg-stone-50 text-ink-3">
              <th className="sticky left-0 z-10 bg-stone-50 px-2 py-1.5 text-left font-medium">{t("°C high / low")}</th>
              {weather.dates.map((d) => (
                <th key={d} className={cx("px-2 py-1.5 text-center font-medium", d === today && "text-indigo-700")}>
                  {fmt(d, { day: "numeric", month: "numeric" })}
                  <br />
                  {fmt(d, { weekday: "short" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weather.places.map((p) => (
              <tr key={p.name} className="border-t border-line">
                <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-semibold">{p.name}</td>
                {p.days.map((w, i) => (
                  <td key={i} className="px-2 py-1.5 text-center">
                    <span className="tabular block font-medium">
                      {deg(w.hi)}/{deg(w.lo)}
                    </span>
                    <span className="block text-[10px] text-ink-3">{w.text}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

// --- edit controls ---------------------------------------------------------

function RowControls({
  onEdit,
  onDelete,
  onUp,
  onDown,
  compact,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onUp?: () => void;
  onDown?: () => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const btn = cx("grid place-items-center rounded-lg ring-1 ring-line bg-surface", compact ? "h-7 w-7" : "h-8 w-8");
  return (
    <div className="flex shrink-0 gap-1">
      {onUp && (
        <button className={btn} onClick={onUp} aria-label={t("Move up")}>
          <ArrowUp className="h-3.5 w-3.5 text-ink-2" />
        </button>
      )}
      {onDown && (
        <button className={btn} onClick={onDown} aria-label={t("Move down")}>
          <ArrowDown className="h-3.5 w-3.5 text-ink-2" />
        </button>
      )}
      <button className={btn} onClick={onEdit} aria-label={t("Edit")}>
        <Pencil className="h-3.5 w-3.5 text-indigo-700" />
      </button>
      <button className={cx(btn, "ring-red-200")} onClick={onDelete} aria-label={t("Delete")}>
        <Trash2 className="h-3.5 w-3.5 text-neg" />
      </button>
    </div>
  );
}

function SmallEdit({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">
      <Pencil className="h-3 w-3" /> {t("Edit")}
    </button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
}

// --- weather ---------------------------------------------------------------

const KIND_STYLE: Record<DayWeather["kind"], { label: string; cls: string }> = {
  actual: { label: "Actual", cls: "bg-emerald-100 text-emerald-900" },
  forecast: { label: "Live forecast", cls: "bg-sky-100 text-sky-900" },
  estimate: { label: "Estimate", cls: "bg-stone-200 text-stone-700" },
};

function WeatherCard({ w }: { w: DayWeather }) {
  const { t } = useT();
  const Icon = WX_ICON[weatherCategory(w.code, w.text)];
  const k = KIND_STYLE[w.kind];
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-sky-50 px-3 py-2 ring-1 ring-sky-200">
      <Icon className="h-6 w-6 shrink-0 text-sky-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <b className="text-sky-950">{w.place}</b>
          <span className="tabular font-semibold text-sky-950">
            {deg(w.hi)} / {deg(w.lo)}
          </span>
          <span className="text-xs text-sky-900/80">{t(w.text)}</span>
        </p>
        {w.pop !== null && w.pop > 0 && <p className="text-[11px] text-sky-900/70">{t("{n}% chance of rain or snow", { n: w.pop })}</p>}
      </div>
      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", k.cls)}>{t(k.label)}</span>
    </div>
  );
}

function MiniWeather({ w }: { w?: DayWeather }) {
  if (!w) return null;
  const Icon = WX_ICON[weatherCategory(w.code, w.text)];
  return (
    <span className="tabular mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-medium opacity-90">
      <Icon className="h-3 w-3" aria-hidden />
      {w.hi ?? "–"}°
    </span>
  );
}
