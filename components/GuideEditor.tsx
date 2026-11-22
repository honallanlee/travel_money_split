"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import type { GuideDay, GuideItem, GuideItemKind, GuideLink, GuideNote, GuideStay, GuideWeather, TripGuide } from "@/lib/types";
import { Button, cx, Field, inputCls, Modal } from "./ui";

/**
 * Treasurer-only editing of the trip guide. Everything is edited as plain text fields;
 * list fields use one line per entry ("label | url" for links, "key | value" for tables).
 */

export type GuideTarget =
  | { kind: "item"; list: "flights" | number; index: number; option?: number } // list = day number
  | { kind: "newItem"; list: "flights" | number }
  | { kind: "stay"; index: number }
  | { kind: "newStay" }
  | { kind: "note"; index: number }
  | { kind: "newNote" }
  | { kind: "day"; index: number }
  | { kind: "weather" };

export const ITEM_KINDS: GuideItemKind[] = ["flight", "train", "bus", "walk", "car", "meal", "activity", "hotel", "note"];
const KIND_LABELS: Record<GuideItemKind, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  walk: "Walk",
  car: "Car",
  meal: "Meal",
  activity: "Activity",
  hotel: "Hotel",
  note: "Note",
};

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
const pairs = (s: string): [string, string][] =>
  lines(s).map((l) => {
    const i = l.indexOf("|");
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  });
const linksFrom = (s: string): GuideLink[] =>
  pairs(s)
    .map(([label, url]) => (url ? { label, url } : { label: label, url: label }))
    .filter((l) => /^https?:\/\//i.test(l.url));
const linksTo = (l?: GuideLink[]) => (l ?? []).map((x) => `${x.label} | ${x.url}`).join("\n");
const opt = (s: string) => s.trim() || undefined;
const optList = <T,>(a: T[]) => (a.length ? a : undefined);

/** True when booking references were stripped (viewer isn't the Treasurer) — never save that copy. */
export function isRedacted(g: TripGuide): boolean {
  const itemRed = (i: GuideItem): boolean => (!!i.hasPrivate && !i.private?.length) || !!i.options?.some(itemRed);
  return (
    g.days.some((d) => d.items.some(itemRed)) ||
    !!g.flights?.some(itemRed) ||
    g.stays.some((s) => !!s.hasPrivate && !s.private?.length)
  );
}

/** Drop server-added display flags before saving. */
function clean(g: TripGuide): TripGuide {
  const item = (i: GuideItem): GuideItem => {
    const { hasPrivate: _h, options, ...rest } = i;
    return { ...rest, ...(options?.length ? { options: options.map(item) } : {}) };
  };
  return {
    ...g,
    flights: g.flights?.map(item),
    days: g.days.map((d) => ({ ...d, items: d.items.map(item) })),
    stays: g.stays.map(({ hasPrivate: _h, ...s }) => s),
  };
}

/** Apply a change to a deep copy of the guide. */
export function editGuide(g: TripGuide, fn: (draft: TripGuide) => void): TripGuide {
  const draft = structuredClone(g);
  fn(draft);
  return clean(draft);
}

export function itemList(g: TripGuide, list: "flights" | number): GuideItem[] {
  if (list === "flights") return (g.flights ??= []);
  return g.days.find((d) => d.day === list)!.items;
}

export function getTarget(g: TripGuide, t: GuideTarget): GuideItem | GuideStay | GuideNote | GuideDay | GuideWeather | null {
  switch (t.kind) {
    case "item": {
      const it = itemList(g, t.list)[t.index];
      return t.option === undefined ? it : it?.options?.[t.option] ?? null;
    }
    case "stay":
      return g.stays[t.index];
    case "note":
      return g.notes[t.index];
    case "day":
      return g.days[t.index];
    case "weather":
      return g.weather ?? { title: "天氣預測", dates: g.days.map((d) => d.date), places: [] };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------

export default function GuideEditor({
  guide,
  target,
  onCancel,
  onSave,
}: {
  guide: TripGuide;
  target: GuideTarget;
  onCancel: () => void;
  onSave: (next: TripGuide) => Promise<boolean>;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const save = async (next: TripGuide) => {
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) onCancel();
  };
  const existing = getTarget(guide, target);

  const title =
    target.kind === "newItem"
      ? t("Add item")
      : target.kind === "newStay"
        ? t("Add hotel")
        : target.kind === "newNote"
          ? t("Add section")
          : target.kind === "day"
            ? t("Edit day")
            : target.kind === "weather"
              ? t("Edit weather")
              : t("Edit");

  return (
    <Modal open onClose={onCancel} title={title}>
      {(target.kind === "item" || target.kind === "newItem") && (
        <ItemForm
          initial={(existing as GuideItem) ?? { kind: "activity", title: "" }}
          busy={busy}
          onSubmit={(it) =>
            save(
              editGuide(guide, (g) => {
                const list = itemList(g, target.list);
                if (target.kind === "newItem") list.push(it);
                else if (target.option === undefined) list[target.index] = { ...it, options: list[target.index].options };
                else list[target.index].options![target.option] = it;
              }),
            )
          }
        />
      )}
      {(target.kind === "stay" || target.kind === "newStay") && (
        <StayForm
          initial={(existing as GuideStay) ?? { key: `stay-${Date.now()}`, name: "", nights: [] }}
          busy={busy}
          onSubmit={(st) =>
            save(
              editGuide(guide, (g) => {
                if (target.kind === "newStay") g.stays.push(st);
                else g.stays[target.index] = st;
              }),
            )
          }
        />
      )}
      {(target.kind === "note" || target.kind === "newNote") && (
        <NoteForm
          initial={(existing as GuideNote) ?? { title: "", lines: [] }}
          busy={busy}
          onSubmit={(n) =>
            save(
              editGuide(guide, (g) => {
                if (target.kind === "newNote") g.notes.push(n);
                else g.notes[target.index] = n;
              }),
            )
          }
        />
      )}
      {target.kind === "day" && (
        <DayForm
          initial={existing as GuideDay}
          stays={guide.stays}
          places={guide.weather?.places.map((p) => p.name) ?? []}
          busy={busy}
          onSubmit={(d) => save(editGuide(guide, (g) => void (g.days[target.index] = { ...d, items: g.days[target.index].items })))}
        />
      )}
      {target.kind === "weather" && (
        <WeatherForm initial={existing as GuideWeather} busy={busy} onSubmit={(w) => save(editGuide(guide, (g) => void (g.weather = w)))} />
      )}
    </Modal>
  );
}

function Area({ label, value, onChange, hint, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; hint?: string; rows?: number }) {
  return (
    <Field label={label} hint={hint}>
      <textarea className={cx(inputCls, "text-sm")} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Submit({ busy, disabled }: { busy: boolean; disabled?: boolean }) {
  const { t } = useT();
  return (
    <Button type="submit" className="w-full" disabled={busy || disabled}>
      {busy ? t("Saving…") : t("Save")}
    </Button>
  );
}

function ItemForm({ initial, busy, onSubmit }: { initial: GuideItem; busy: boolean; onSubmit: (it: GuideItem) => void }) {
  const { t } = useT();
  const [f, setF] = useState({
    time: initial.time ?? "",
    kind: initial.kind,
    title: initial.title,
    who: initial.who ?? "",
    detail: initial.detail ?? "",
    duration: initial.duration ?? "",
    cost: initial.cost ? String(initial.cost) : "",
    alert: initial.alert ?? "",
    address: initial.address ?? "",
    map: initial.map ?? "",
    phone: initial.phone ?? "",
    notes: (initial.notes ?? []).join("\n"),
    links: linksTo(initial.links),
    private: (initial.private ?? []).join("\n"),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          kind: f.kind,
          title: f.title.trim(),
          time: opt(f.time),
          who: opt(f.who),
          detail: opt(f.detail),
          duration: opt(f.duration),
          cost: Number(f.cost) > 0 ? Math.round(Number(f.cost)) : undefined,
          alert: opt(f.alert),
          address: opt(f.address),
          map: opt(f.map),
          phone: opt(f.phone),
          notes: optList(lines(f.notes)),
          links: optList(linksFrom(f.links)),
          private: optList(lines(f.private)),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Text label={t("Time")} value={f.time} onChange={set("time")} placeholder="09:00–10:30" />
        <Field label={t("Type")}>
          <select className={inputCls} value={f.kind} onChange={(e) => set("kind")(e.target.value)}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABELS[k])}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Text label={t("Title")} value={f.title} onChange={set("title")} />
      <Text label={t("Who (optional)")} value={f.who} onChange={set("who")} placeholder="Alex + Sam" />
      <Area label={t("Details")} value={f.detail} onChange={set("detail")} rows={2} />
      <div className="grid grid-cols-2 gap-2">
        <Text label={t("Duration")} value={f.duration} onChange={set("duration")} placeholder="40 min" />
        <Text label={t("Cost per person (¥)")} value={f.cost} onChange={set("cost")} />
      </div>
      <Text label={t("Warning (optional)")} value={f.alert} onChange={set("alert")} />
      <Text label={t("Address")} value={f.address} onChange={set("address")} />
      <Text label={t("Map search (place name + town)")} value={f.map} onChange={set("map")} placeholder="上杉神社 米沢" />
      <Text label={t("Phone")} value={f.phone} onChange={set("phone")} />
      <Area label={t("Notes (one per line)")} value={f.notes} onChange={set("notes")} />
      <Area label={t("Links (label | https://…, one per line)")} value={f.links} onChange={set("links")} rows={2} />
      <Area
        label={t("Booking references (Treasurer only, one per line)")}
        value={f.private}
        onChange={set("private")}
        rows={2}
        hint={t("Only shown in Treasurer Mode.")}
      />
      <Submit busy={busy} disabled={!f.title.trim()} />
    </form>
  );
}

function StayForm({ initial, busy, onSubmit }: { initial: GuideStay; busy: boolean; onSubmit: (s: GuideStay) => void }) {
  const { t } = useT();
  const [f, setF] = useState({
    key: initial.key,
    name: initial.name,
    who: initial.who ?? "",
    nights: initial.nights.join("\n"),
    address: initial.address ?? "",
    map: initial.map ?? "",
    phone: initial.phone ?? "",
    checkIn: initial.checkIn ?? "",
    checkOut: initial.checkOut ?? "",
    rooms: (initial.rooms ?? []).join("\n"),
    notes: (initial.notes ?? []).join("\n"),
    links: linksTo(initial.links),
    private: (initial.private ?? []).join("\n"),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const nights = lines(f.nights).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          key: f.key,
          name: f.name.trim(),
          who: opt(f.who),
          nights,
          address: opt(f.address),
          map: opt(f.map),
          phone: opt(f.phone),
          checkIn: opt(f.checkIn),
          checkOut: opt(f.checkOut),
          rooms: optList(lines(f.rooms)),
          notes: optList(lines(f.notes)),
          links: optList(linksFrom(f.links)),
          private: optList(lines(f.private)),
        });
      }}
    >
      <Text label={t("Hotel name")} value={f.name} onChange={set("name")} />
      <Text label={t("Who (optional)")} value={f.who} onChange={set("who")} />
      <Area label={t("Nights (YYYY-MM-DD, one per line)")} value={f.nights} onChange={set("nights")} rows={2} />
      <Text label={t("Address")} value={f.address} onChange={set("address")} />
      <Text label={t("Map search (place name + town)")} value={f.map} onChange={set("map")} placeholder="上杉神社 米沢" />
      <Text label={t("Phone")} value={f.phone} onChange={set("phone")} />
      <div className="grid grid-cols-2 gap-2">
        <Text label={t("Check-in")} value={f.checkIn} onChange={set("checkIn")} placeholder="15:00" />
        <Text label={t("Check-out")} value={f.checkOut} onChange={set("checkOut")} placeholder="11:00" />
      </div>
      <Area label={t("Rooms (one per line)")} value={f.rooms} onChange={set("rooms")} />
      <Area label={t("Notes (one per line)")} value={f.notes} onChange={set("notes")} rows={2} />
      <Area label={t("Links (label | https://…, one per line)")} value={f.links} onChange={set("links")} rows={2} />
      <Area
        label={t("Booking references (Treasurer only, one per line)")}
        value={f.private}
        onChange={set("private")}
        rows={3}
        hint={t("Only shown in Treasurer Mode.")}
      />
      <Submit busy={busy} disabled={!f.name.trim()} />
    </form>
  );
}

function NoteForm({ initial, busy, onSubmit }: { initial: GuideNote; busy: boolean; onSubmit: (n: GuideNote) => void }) {
  const { t } = useT();
  const [f, setF] = useState({
    title: initial.title,
    lines: initial.lines.join("\n"),
    table: (initial.table ?? []).map(([k, v]) => `${k} | ${v}`).join("\n"),
    links: linksTo(initial.links),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title: f.title.trim(), lines: lines(f.lines), table: optList(pairs(f.table)), links: optList(linksFrom(f.links)) });
      }}
    >
      <Text label={t("Title")} value={f.title} onChange={set("title")} />
      <Area label={t("Lines (one per line)")} value={f.lines} onChange={set("lines")} rows={5} />
      <Area label={t("Table (key | value, one per line)")} value={f.table} onChange={set("table")} />
      <Area label={t("Links (label | https://…, one per line)")} value={f.links} onChange={set("links")} rows={2} />
      <Submit busy={busy} disabled={!f.title.trim()} />
    </form>
  );
}

function DayForm({
  initial,
  stays,
  places,
  busy,
  onSubmit,
}: {
  initial: GuideDay;
  stays: GuideStay[];
  places: string[];
  busy: boolean;
  onSubmit: (d: GuideDay) => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(initial.title);
  const [stay, setStay] = useState(initial.stay ?? "");
  const [weather, setWeather] = useState<string[]>(initial.weatherPlaces ?? []);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...initial, title: title.trim(), stay: stay || undefined, weatherPlaces: weather.length ? weather : undefined });
      }}
    >
      <Text label={t("Title")} value={title} onChange={setTitle} />
      <Field label={t("Hotel tonight")}>
        <select className={inputCls} value={stay} onChange={(e) => setStay(e.target.value)}>
          <option value="">{t("No hotel tonight")}</option>
          {stays.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {places.length > 0 && (
        <Field label={t("Weather to show")}>
          <div className="flex flex-wrap gap-1.5">
            {places.map((p) => {
              const on = weather.includes(p);
              return (
                <button
                  type="button"
                  key={p}
                  onClick={() => setWeather((w) => (on ? w.filter((x) => x !== p) : [...w, p]))}
                  className={cx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", on ? "bg-indigo-700 text-white ring-indigo-700" : "ring-line")}
                  aria-pressed={on}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <Submit busy={busy} disabled={!title.trim()} />
    </form>
  );
}

/** Weather as text: one place per line, "Place | 7/-1 Sunny | 6/0 Cloudy | …" in date order. */
function WeatherForm({ initial, busy, onSubmit }: { initial: GuideWeather; busy: boolean; onSubmit: (w: GuideWeather) => void }) {
  const { t } = useT();
  const toText = (w: GuideWeather) =>
    w.places.map((p) => [p.name, ...p.days.map((d) => `${d.hi ?? ""}/${d.lo ?? ""} ${d.text}`.trim())].join(" | ")).join("\n");
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note ?? "");
  const [rows, setRows] = useState(toText(initial));
  const parse = (): GuideWeather["places"] =>
    lines(rows).map((l) => {
      const [name, ...cells] = l.split("|").map((x) => x.trim());
      const prev = initial.places.find((p) => p.name === name);
      return {
        name,
        lat: prev?.lat,
        lon: prev?.lon,
        days: initial.dates.map((_, i) => {
          const m = /^(-?\d+)?\s*\/\s*(-?\d+)?\s*(.*)$/.exec(cells[i] ?? "");
          return m ? { hi: m[1] ? Number(m[1]) : null, lo: m[2] ? Number(m[2]) : null, text: m[3].trim() } : { hi: null, lo: null, text: cells[i] ?? "" };
        }),
      };
    });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...initial, title: title.trim(), note: opt(note), places: parse() });
      }}
    >
      <Text label={t("Title")} value={title} onChange={setTitle} />
      <Area label={t("Note")} value={note} onChange={setNote} rows={2} />
      <Area
        label={t("Forecast")}
        value={rows}
        onChange={setRows}
        rows={10}
        hint={t("One place per line: Place | high/low weather | … in date order ({first} → {last}).", {
          first: initial.dates[0] ?? "",
          last: initial.dates[initial.dates.length - 1] ?? "",
        })}
      />
      <Submit busy={busy} disabled={!title.trim()} />
    </form>
  );
}
