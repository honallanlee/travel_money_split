"use client";
import {
  BedDouble,
  Bus,
  Coins,
  HandCoins,
  ArrowRightLeft,
  Undo2,
  Plane,
  ShoppingBag,
  Ticket,
  UtensilsCrossed,
  X,
  Package,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { formatMoney } from "@/lib/settlement";
import { useT } from "@/lib/i18n";
import type { Participant } from "@/lib/types";
import { useDisplay } from "./DisplayCurrency";
import type { TxType } from "@/lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Food & Drink": UtensilsCrossed,
  Transport: Bus,
  Accommodation: BedDouble,
  Flights: Plane,
  Activities: Ticket,
  Shopping: ShoppingBag,
  Other: Package,
};

export function CategoryIcon({ category, type, className }: { category: string; type?: TxType; className?: string }) {
  const Icon =
    type === "CASH_DEPOSIT"
      ? Coins
      : type === "CASH_PAYOUT"
        ? HandCoins
        : type === "TRANSFER"
          ? ArrowRightLeft
          : type === "REFUND"
            ? Undo2
            : CATEGORY_ICONS[category] ?? Package;
  return <Icon className={className ?? "h-5 w-5"} aria-hidden />;
}

const PILL: Record<TxType, { label: string; cls: string }> = {
  CASH_DEPOSIT: { label: "CASH DEPOSIT", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  CASH_EXPENSE: { label: "CASH", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  CARD_EXPENSE: { label: "CARD", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  CASH_PAYOUT: { label: "KITTY PAYOUT", cls: "bg-violet-50 text-violet-800 ring-violet-200" },
  TRANSFER: { label: "SETTLE-UP", cls: "bg-stone-100 text-stone-700 ring-stone-300" },
  REFUND: { label: "REFUND", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
};

export function TypePill({ type }: { type: TxType }) {
  const { t } = useT();
  const p = { ...PILL[type], label: t(PILL[type].label) };
  return (
    <span className={cx("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-inset", p.cls)}>
      {p.label}
    </span>
  );
}

/** Money amount. Without `currency`, a base-currency amount shown in the viewer's display currency. */
export function Money({ amount, currency, className, signed }: { amount: number; currency?: string; className?: string; signed?: boolean }) {
  const d = useDisplay();
  const s = signed && amount > 0.004 ? "+" : "";
  return <span className={cx("tabular", className)}>{s + (currency ? formatMoney(amount, currency) : d.fmt(amount))}</span>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-surface ring-1 ring-line", className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-brand text-white hover:brightness-110 disabled:opacity-50",
    secondary: "bg-surface text-ink ring-1 ring-line hover:bg-stone-50 disabled:opacity-50",
    ghost: "text-ink-2 hover:bg-stone-100 disabled:opacity-50",
    danger: "bg-surface text-neg ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50",
  }[variant];
  return (
    <button
      type="button"
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition", styles, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Input styling without a width — combine with an explicit width class. */
export const inputBase =
  "rounded-xl border border-line bg-white px-3 py-2.5 text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-teal-100";
export const inputCls = `w-full ${inputBase}`;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const closeLabel = useT().t("Close");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-bg shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-2 hover:bg-stone-200" aria-label={closeLabel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div className="rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">{message}</div>
    </div>
  );
}

export function formatDay(iso: string, locale = "en-GB") {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const AVATAR_TONES = [
  "bg-sky-100 text-sky-800",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
];

/** Traveller avatar: uploaded photo, or coloured initials. */
export function Avatar({
  person,
  size = 32,
  className,
}: {
  person: Pick<Participant, "id" | "name" | "avatar_media_id"> | undefined | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };
  if (!person) return <span className={cx("inline-block shrink-0 rounded-full bg-stone-200", className)} style={style} />;
  if (person.avatar_media_id) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/media/${person.avatar_media_id}`}
        alt={person.name}
        width={size}
        height={size}
        className={cx("inline-block shrink-0 rounded-full object-cover ring-2 ring-surface", className)}
        style={style}
        loading="lazy"
      />
    );
  }
  const tone = AVATAR_TONES[[...person.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const initials = person.name.trim().split(/\s+/).map((w) => [...w][0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cx("inline-grid shrink-0 place-items-center rounded-full font-semibold ring-2 ring-surface", tone, className)} style={style} aria-hidden>
      {initials || "?"}
    </span>
  );
}

/**
 * Avatars for a family/group inside a fixed square, so they never spill under the text next
 * to them: 1 face, a diagonal pair, or a 2×2 grid (with "+N" when there are more than 4).
 */
export function AvatarCluster({
  people,
  size = 48,
}: {
  people: Pick<Participant, "id" | "name" | "avatar_media_id">[];
  size?: number;
}) {
  const box = { width: size, height: size };
  if (people.length <= 1) {
    return (
      <span className="relative grid shrink-0 place-items-center" style={box}>
        <Avatar person={people[0]} size={size - 4} />
      </span>
    );
  }
  if (people.length === 2) {
    const s = Math.round(size * 0.62);
    return (
      <span className="relative shrink-0" style={box}>
        <Avatar person={people[0]} size={s} className="absolute left-0 top-0" />
        <Avatar person={people[1]} size={s} className="absolute bottom-0 right-0" />
      </span>
    );
  }
  const s = Math.floor((size - 2) / 2);
  const shown = people.length > 4 ? people.slice(0, 3) : people.slice(0, 4);
  const extra = people.length - shown.length;
  return (
    <span className="grid shrink-0 grid-cols-2 place-items-center gap-0.5" style={box}>
      {shown.map((p, i) => (
        // with 3 people, the third sits centred under the first two
        <Avatar key={p.id} person={p} size={s} className={people.length === 3 && i === 2 ? "col-span-2" : undefined} />
      ))}
      {extra > 0 && (
        <span
          className="inline-grid shrink-0 place-items-center rounded-full bg-stone-200 font-semibold text-ink-2 ring-2 ring-surface"
          style={{ width: s, height: s, fontSize: Math.max(9, s * 0.4) }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

export const dayKey = (iso: string) => iso.slice(0, 10);
