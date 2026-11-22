"use client";
import { ArrowRight, Check, ChevronDown, Copy, Share2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { computeLedger, formatWhatsAppSummary, KITTY_ID, OUTSIDE_ID, splitWithinFamily, type Ledger, type SettlementEntity } from "@/lib/settlement";
import type { TripBundle } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { useDisplay } from "./DisplayCurrency";
import type { TxPrefill } from "./TransactionModal";
import { AvatarCluster, Button, Card, cx, Money, SectionTitle } from "./ui";

/** Opens the transaction form pre-filled to record one line of the settlement plan. */
export type RecordSettlement = (type: "CASH_PAYOUT" | "CASH_DEPOSIT" | "TRANSFER", prefill: TxPrefill) => void;

type SettleMode = "family" | "person";
const MODE_KEY = "tms:settle-mode";

export default function BalancesTab({
  bundle,
  ledger: familyLedger,
  onCopied,
  unlocked,
  onRecord,
}: {
  bundle: TripBundle;
  ledger: Ledger;
  onCopied: () => void;
  unlocked: boolean;
  onRecord: RecordSettlement;
}) {
  const cur = bundle.trip.base_currency;
  const [copied, setCopied] = useState(false);
  const hasFamilies = familyLedger.entities.some((e) => e.kind === "group");
  const [mode, setModeState] = useState<SettleMode>("family");
  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "person") setModeState("person");
    } catch {}
  }, []);
  const setMode = (m: SettleMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  const personLedger = useMemo(() => computeLedger(bundle, { individual: true }), [bundle]);
  const byPerson = mode === "person" || !hasFamilies;
  const ledger = byPerson ? personLedger : familyLedger;
  const d = useDisplay();
  const { t } = useT();
  const kittyName = ledger.treasurerName ? t("Cash Kitty ({name})", { name: ledger.treasurerName }) : t("Cash Kitty");
  const partyName = (id: string, name: string) => (id === KITTY_ID ? kittyName : name);

  /** Cash moves to/from one person: for a family, use the member most owed (paid) or who owes most (deposit). */
  const memberFor = (entityId: string, wantsOwed: boolean) => {
    const ent = ledger.entities.find((e) => e.id === entityId);
    const ids = ent?.member_ids ?? [entityId];
    return [...ids].sort((a, b) => (ledger.balances[b]?.net ?? 0) - (ledger.balances[a]?.net ?? 0))[wantsOwed ? 0 : ids.length - 1];
  };
  const record = (x: (typeof ledger.transfers)[number]) => {
    if (x.from_id === KITTY_ID)
      onRecord("CASH_PAYOUT", { amount: x.amount, personId: memberFor(x.to_id, true), title: t("Settle-up from kitty") });
    else if (x.to_id === KITTY_ID)
      onRecord("CASH_DEPOSIT", { amount: x.amount, personId: memberFor(x.from_id, false), title: t("Settle-up into kitty"), singleDeposit: true });
    else
      onRecord("TRANSFER", {
        amount: x.amount,
        personId: memberFor(x.from_id, false),
        receiverId: memberFor(x.to_id, true),
        title: t("Settle-up payment"),
      });
  };
  const summary = formatWhatsAppSummary(bundle.trip.name, cur, ledger, {
    fmt: d.fmt,
    t,
    partyName,
    note: d.converted
      ? t("Amounts in {code} at 1 {base} = {rate} {code} (recorded in {base})", { code: d.code, base: d.base, rate: d.rate.toPrecision(4) })
      : undefined,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = summary;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    onCopied();
    setTimeout(() => setCopied(false), 2000);
  };

  const sorted = [...ledger.entities].sort((a, b) => b.net - a.net);
  return (
    <div>
      {hasFamilies && (
        <div className="mb-1 grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label={t("Settle up by")}>
          {(
            [
              ["family", t("By family")],
              ["person", t("By person")],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cx("rounded-lg py-2 text-sm font-semibold", mode === m ? "bg-surface shadow-sm" : "text-ink-2")}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <SectionTitle>{byPerson ? t("Travellers") : t("Families & travellers")}</SectionTitle>
      {sorted.length === 0 && <Card className="p-6 text-center text-sm text-ink-2">{t("No travellers yet.")}</Card>}
      <div className="space-y-2">
        {sorted.map((e) => (
          <EntityCard key={e.id} entity={e} bundle={bundle} ledger={ledger} />
        ))}
        {Math.abs(ledger.pool.balance) >= 0.01 && (
          <Card className="flex items-center gap-3 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-brand">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{t("Cash kitty")}</p>
              <p className="text-xs text-ink-3">
                {ledger.pool.balance > 0 ? t("Unspent cash to return") : t("Kitty is overdrawn")}
                {ledger.treasurerName && ` · ${t("held by {name}", { name: ledger.treasurerName })}`}
              </p>
            </div>
            <Money amount={ledger.pool.balance} className="text-sm font-semibold" />
          </Card>
        )}
      </div>

      <SectionTitle>{t("Settlement plan")}</SectionTitle>
      <Card className="overflow-hidden">
        {ledger.transfers.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-6 text-sm text-pos">
            <Check className="h-4 w-4" /> {t("Everyone is square")}
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {ledger.transfers.map((x, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-semibold text-ink-2">{i + 1}</span>
                <span className={cx("min-w-0 flex-1", x.from_id === KITTY_ID && "italic")}>
                  <span className="font-semibold">{partyName(x.from_id, x.from_name)}</span>
                  <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-ink-3" />
                  <span className="font-semibold">{partyName(x.to_id, x.to_name)}</span>
                </span>
                <Money amount={x.amount} className="font-bold" />
                {unlocked && (
                  <button
                    onClick={() => record(x)}
                    className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200"
                    aria-label={t("Record payment {from} → {to}", { from: partyName(x.from_id, x.from_name), to: partyName(x.to_id, x.to_name) })}
                  >
                    {t("Record")}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="flex gap-2 border-t border-line p-3">
          <Button className="flex-1" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("Copied") : t("Copy Summary for WhatsApp")}
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(summary)}`}
            target="_blank"
            rel="noreferrer"
            className="grid place-items-center rounded-xl px-3 ring-1 ring-line"
            aria-label={t("Open in WhatsApp")}
          >
            <Share2 className="h-4 w-4 text-ink-2" />
          </a>
        </div>
      </Card>
      <p className="mt-2 px-1 text-xs text-ink-3">
        {byPerson
          ? t("Payments are minimised by pairing the biggest debtor with the biggest creditor. Everyone settles on their own.")
          : t("Payments are minimised by pairing the biggest debtor with the biggest creditor. Family members are settled as one unit; open a family above to see who pays or keeps what inside the family.")}
      </p>
    </div>
  );
}

function EntityCard({
  entity: e,
  bundle,
  ledger,
}: {
  entity: SettlementEntity;
  bundle: TripBundle;
  ledger: Ledger;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const square = Math.abs(e.net) < 0.01;
  const members = e.member_ids.map((id) => ({ p: bundle.participants.find((x) => x.id === id)!, b: ledger.balances[id] }));
  // Only show the "From kitty" column when someone in this group has actually received kitty cash.
  const showReceived = members.some((m) => m.b.received > 0);
  const showSettled = members.some((m) => Math.abs(m.b.settled) > 0.004);
  const inside = e.kind === "group" ? splitWithinFamily(members.map((m) => ({ id: m.p.id, name: m.p.name, net: m.b.net }))) : [];

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        <AvatarCluster people={members.map((m) => m.p)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{e.name}</p>
          <p className="truncate text-xs text-ink-3">{e.kind === "group" ? members.map((m) => m.p.name).join(", ") : t("Solo traveller")}</p>
        </div>
        <div className="text-right">
          <Money amount={e.net} signed className={cx("text-sm font-bold", square ? "text-ink-3" : e.net > 0 ? "text-pos" : "text-neg")} />
          <p className="text-[11px] text-ink-3">{square ? t("settled") : e.net > 0 ? t("is owed") : t("owes")}</p>
        </div>
        <ChevronDown className={cx("h-4 w-4 text-ink-3 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line bg-stone-50 px-3 py-2">
          <table className="w-full text-xs">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 text-left font-medium">{t("Person")}</th>
                <th className="py-1 text-right font-medium">{t("Cash in")}</th>
                <th className="py-1 text-right font-medium">{t("Card paid")}</th>
                <th className="py-1 text-right font-medium">{t("Share")}</th>
                {showReceived && <th className="py-1 text-right font-medium">{t("From kitty")}</th>}
                {showSettled && <th className="py-1 text-right font-medium">{t("Settled")}</th>}
                <th className="py-1 text-right font-medium">{t("Net")}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {members.map(({ p, b }) => (
                <tr key={p.id} className="border-t border-line/70">
                  <td className="py-1.5 font-medium">
                    {p.name}
                    {p.is_treasurer && <span className="ml-1 text-[10px] text-brand">★</span>}
                  </td>
                  <td className="text-right">
                    <Money amount={b.deposits} />
                  </td>
                  <td className="text-right">
                    <Money amount={b.card_paid} />
                  </td>
                  <td className="text-right">
                    <Money amount={-b.shares} />
                  </td>
                  {showReceived && (
                    <td className="text-right">
                      <Money amount={-b.received} />
                    </td>
                  )}
                  {showSettled && (
                    <td className="text-right">
                      <Money amount={b.settled} signed />
                    </td>
                  )}
                  <td className={cx("text-right font-semibold", b.net > 0.004 ? "text-pos" : b.net < -0.004 ? "text-neg" : "")}>
                    <Money amount={b.net} signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        {inside.length > 0 && <InsideFamily family={e} transfers={inside} />}
        </div>
      )}
    </Card>
  );
}

/** Plain-language split of a family's settlement between its members. */
function InsideFamily({ family, transfers }: { family: SettlementEntity; transfers: ReturnType<typeof splitWithinFamily> }) {
  const { t } = useT();
  const d = useDisplay();
  const pays = transfers.filter((x) => x.to_id === OUTSIDE_ID);
  const keeps = transfers.filter((x) => x.from_id === OUTSIDE_ID);
  const internal = transfers.filter((x) => x.from_id !== OUTSIDE_ID && x.to_id !== OUTSIDE_ID);
  const square = Math.abs(family.net) < 0.005;
  return (
    <div className="mt-3 rounded-xl bg-surface p-2.5 ring-1 ring-line">
      <p className="mb-1 text-xs font-semibold text-ink-2">{t("Inside the family")}</p>
      <ul className="space-y-1 text-xs">
        {!square && family.net < 0 && (
          <li className="text-ink-3">{t("The family pays {amount} in the settlement plan:", { amount: d.fmt(-family.net) })}</li>
        )}
        {pays.map((x, i) => (
          <li key={`p${i}`} className="pl-2">
            • {t("{name} pays {amount} of it", { name: x.from_name, amount: d.fmt(x.amount) })}
          </li>
        ))}
        {!square && family.net > 0 && (
          <li className="text-ink-3">{t("The family receives {amount} in the settlement plan:", { amount: d.fmt(family.net) })}</li>
        )}
        {keeps.map((x, i) => (
          <li key={`k${i}`} className="pl-2">
            • {t("{name} keeps {amount} of it", { name: x.to_name, amount: d.fmt(x.amount) })}
          </li>
        ))}
        {internal.length > 0 && <li className="pt-1 text-ink-3">{t("Then, between yourselves:")}</li>}
        {internal.map((x, i) => (
          <li key={`i${i}`} className="pl-2">
            • {t("{from} pays {to} {amount}", { from: x.from_name, to: x.to_name, amount: d.fmt(x.amount) })}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-ink-3">{t("After this, everyone in the family is square.")}</p>
    </div>
  );
}
