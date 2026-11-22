/**
 * Excel workbook export. The money logic is written as live Excel formulas (SUMIFS /
 * SUMPRODUCT), so the file keeps working offline: add or fix rows on the Transactions or
 * Prepaid sheets and every balance, family total and per-person total updates by itself.
 *
 * Pure apart from the ExcelJS module that is passed in (loaded lazily in the browser).
 */
import type ExcelJSType from "exceljs";
import { computeTripTotals, prepaidShareBase } from "./personTotals";
import { telE164 } from "./phone";
import { computeLedger, currencyDecimals, KITTY_ID, type Ledger } from "./settlement";
import { CATEGORIES, TX_TYPES, type GuideItem, type TripBundle, type TripGuide } from "./types";

type ExcelJS = typeof ExcelJSType;
type T = (key: string, vars?: Record<string, string | number>) => string;

/** Rows the formulas cover, so rows typed in later are included too. */
export const XLSX_ROWS = { transactions: 2000, prepaid: 200 };

export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const KIND_LABELS: Record<string, string> = {
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

const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
/** Double quotes inside a formula string literal. */
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } } as const;
const INPUT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } } as const;
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F2" } } as const;

function header(ws: ExcelJSType.Worksheet, labels: string[], widths?: number[]) {
  const row = ws.getRow(1);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  widths?.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

export interface WorkbookInput {
  bundle: TripBundle;
  guide?: TripGuide | null;
  t?: T;
}

export function buildTripWorkbook(Excel: ExcelJS, { bundle, guide, t = (k, v) => interp(k, v) }: WorkbookInput): ExcelJSType.Workbook {
  const wb = new Excel.Workbook();
  wb.creator = "Travel Hub";
  wb.created = new Date();
  // Excel recalculates everything on open; cached results are included for phone previews.
  wb.calcProperties.fullCalcOnLoad = true;

  const base = bundle.trip.base_currency;
  const dec = currencyDecimals(base);
  const moneyFmt = dec === 0 ? "#,##0" : "#,##0.00";
  const people = [...bundle.participants];
  const groupName = new Map(bundle.mini_groups.map((g) => [g.id, g.name]));
  const settlesAs = (pid: string) => {
    const p = people.find((x) => x.id === pid)!;
    return (p.mini_group_id && groupName.get(p.mini_group_id)) || p.name;
  };
  const familyLedger = computeLedger(bundle);
  const personLedger = computeLedger(bundle, { individual: true });
  const totals = computeTripTotals(bundle);
  const prepaid = bundle.prepaid_items ?? [];
  const prepaidCurrencies = [...new Set(prepaid.map((p) => p.currency))].sort();
  const categories = [...new Set<string>([...CATEGORIES, ...bundle.transactions.map((x) => x.category), ...prepaid.map((x) => x.category)])];

  const readme = wb.addWorksheet("ReadMe");
  const wsPeople = wb.addWorksheet("People");
  const wsTx = wb.addWorksheet("Transactions");
  const wsBal = wb.addWorksheet("Balances");
  const wsFam = wb.addWorksheet("Families");
  const wsPlan = wb.addWorksheet("Settlement");
  const wsPre = wb.addWorksheet("Prepaid");
  const wsTot = wb.addWorksheet("PersonTotals");
  const wsBud = wb.addWorksheet("Budget");
  const wsIt = guide ? wb.addWorksheet("Itinerary") : null;
  const wsLists = wb.addWorksheet("Lists", { state: "hidden" });

  // ---------------------------------------------------------------- Lists (for drop-downs)
  TX_TYPES.forEach((x, i) => (wsLists.getCell(i + 1, 1).value = x));
  categories.forEach((x, i) => (wsLists.getCell(i + 1, 2).value = x));
  ["paid", "due", "recorded"].forEach((x, i) => (wsLists.getCell(i + 1, 3).value = x));
  const typeList = `Lists!$A$1:$A$${TX_TYPES.length}`;
  const catList = `Lists!$B$1:$B$${categories.length}`;
  const statusList = "Lists!$C$1:$C$3";

  // ---------------------------------------------------------------- People
  header(wsPeople, [t("Name"), t("Family"), t("Settles as"), t("Treasurer")], [18, 20, 20, 10]);
  people.forEach((p, i) => {
    const r = wsPeople.getRow(i + 2);
    r.getCell(1).value = p.name;
    r.getCell(2).value = p.mini_group_id ? groupName.get(p.mini_group_id) ?? "" : "";
    r.getCell(3).value = { formula: `IF(B${i + 2}="",A${i + 2},B${i + 2})`, result: settlesAs(p.id) };
    r.getCell(4).value = p.is_treasurer ? "Yes" : "";
  });
  const nameList = `People!$A$2:$A$${people.length + 1}`;

  // ---------------------------------------------------------------- Transactions
  const TX_MAX = Math.max(XLSX_ROWS.transactions, bundle.transactions.length + 500);
  const FIRST_SHARE = 11; // column K
  const shareCol = (i: number) => colLetter(FIRST_SHARE + i);
  const lastShare = shareCol(Math.max(0, people.length - 1));
  header(
    wsTx,
    [
      t("Date"),
      t("Type"),
      t("Description"),
      t("Category"),
      t("Amount"),
      t("Currency"),
      t("Exchange rate"),
      `${t("Amount")} (${base})`,
      t("Paid by"),
      t("Check (0 = OK)"),
      ...people.map((p) => `${t("Share")}: ${p.name}`),
    ],
    [11, 15, 30, 15, 11, 9, 10, 13, 14, 10, ...people.map(() => 12)],
  );
  const name = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const txs = [...bundle.transactions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const rng = (col: string) => `Transactions!$${col}$2:$${col}$${TX_MAX}`;
  for (let r = 2; r <= TX_MAX; r++) {
    const tx = txs[r - 2];
    const row = wsTx.getRow(r);
    if (tx) {
      row.getCell(1).value = tx.occurred_at.slice(0, 10);
      row.getCell(2).value = tx.type;
      row.getCell(3).value = tx.title;
      row.getCell(4).value = tx.type === "CASH_DEPOSIT" || tx.type === "CASH_PAYOUT" || tx.type === "TRANSFER" ? "" : tx.category;
      row.getCell(5).value = tx.amount_local;
      row.getCell(6).value = tx.currency;
      row.getCell(7).value = tx.exchange_rate_to_base;
      row.getCell(9).value = tx.paid_by_participant_id ? name[tx.paid_by_participant_id] ?? "" : "";
      const shares = Object.fromEntries(tx.splits.map((s) => [s.participant_id, s.share_amount_base]));
      people.forEach((p, i) => {
        if (shares[p.id] !== undefined) row.getCell(FIRST_SHARE + i).value = shares[p.id];
      });
    }
    // Amount in the trip currency, rounded like the app (e.g. whole yen).
    row.getCell(8).value = { formula: `IF(E${r}="","",ROUND(E${r}*IF(G${r}="",1,G${r}),${dec}))`, result: tx ? tx.amount_base : "" } as ExcelJSType.CellFormulaValue;
    row.getCell(8).numFmt = moneyFmt;
    row.getCell(10).value = {
      formula: `IF(OR(B${r}="CASH_EXPENSE",B${r}="CARD_EXPENSE",B${r}="REFUND",B${r}="TRANSFER"),ROUND(SUM(${colLetter(FIRST_SHARE)}${r}:${lastShare}${r})-H${r},2),"")`,
      result: tx && ["CASH_EXPENSE", "CARD_EXPENSE", "REFUND", "TRANSFER"].includes(tx.type) ? 0 : "",
    } as ExcelJSType.CellFormulaValue;
    if (r <= txs.length + 50) for (const c of [1, 2, 3, 4, 5, 6, 7, 9]) row.getCell(c).fill = INPUT_FILL;
  }
  for (let i = 0; i < people.length; i++) wsTx.getColumn(FIRST_SHARE + i).numFmt = moneyFmt;
  wsTx.getColumn(5).numFmt = "#,##0.##";
  addValidation(wsTx, `B2:B${TX_MAX}`, typeList);
  addValidation(wsTx, `D2:D${TX_MAX}`, catList);
  addValidation(wsTx, `I2:I${TX_MAX}`, nameList);
  wsTx.autoFilter = { from: "A1", to: `${lastShare}1` };

  // ---------------------------------------------------------------- Balances
  header(
    wsBal,
    [t("Person"), t("Settles as"), t("Cash in"), t("Card paid"), t("Share"), t("From kitty"), t("Settled"), t("Net"), t("Status")],
    [16, 18, 12, 12, 12, 12, 12, 13, 12],
  );
  const B = rng("B");
  const H = rng("H");
  const I = rng("I");
  people.forEach((p, i) => {
    const r = i + 2;
    const S = rng(shareCol(i));
    const b = familyLedger.balances[p.id];
    const row = wsBal.getRow(r);
    row.getCell(1).value = { formula: `People!A${r}`, result: p.name };
    row.getCell(2).value = { formula: `People!C${r}`, result: settlesAs(p.id) };
    row.getCell(3).value = { formula: `SUMIFS(${H},${B},"CASH_DEPOSIT",${I},A${r})`, result: b.deposits };
    row.getCell(4).value = { formula: `SUMIFS(${H},${B},"CARD_EXPENSE",${I},A${r})-SUMIFS(${H},${B},"REFUND",${I},A${r})`, result: b.card_paid };
    row.getCell(5).value = {
      formula: `SUMIFS(${S},${B},"CASH_EXPENSE")+SUMIFS(${S},${B},"CARD_EXPENSE")-SUMIFS(${S},${B},"REFUND")`,
      result: b.shares,
    };
    row.getCell(6).value = { formula: `SUMIFS(${H},${B},"CASH_PAYOUT",${I},A${r})`, result: b.received };
    row.getCell(7).value = { formula: `SUMIFS(${H},${B},"TRANSFER",${I},A${r})-SUMIFS(${S},${B},"TRANSFER")`, result: b.settled };
    row.getCell(8).value = { formula: `C${r}+D${r}-E${r}-F${r}+G${r}`, result: b.net };
    row.getCell(9).value = {
      formula: `IF(ABS(H${r})<0.005,${q(t("settled"))},IF(H${r}>0,${q(t("is owed"))},${q(t("owes"))}))`,
      result: Math.abs(b.net) < 0.005 ? t("settled") : b.net > 0 ? t("is owed") : t("owes"),
    };
    for (let c = 3; c <= 8; c++) row.getCell(c).numFmt = moneyFmt;
  });
  const lastP = people.length + 1;
  const k0 = lastP + 2; // kitty block
  const pool = familyLedger.pool;
  const kitty: [string, string, number][] = [
    [t("Kitty: deposits"), `SUMIFS(${H},${B},"CASH_DEPOSIT")`, pool.deposits],
    [t("Kitty: cash expenses"), `SUMIFS(${H},${B},"CASH_EXPENSE")`, pool.expenses],
    [t("Kitty: payouts"), `SUMIFS(${H},${B},"CASH_PAYOUT")`, pool.payouts],
    [t("Kitty: cash refunds"), `SUMIFS(${H},${B},"REFUND",${I},"")`, pool.refunds],
    [t("Cash that should be in the kitty"), `B${k0}-B${k0 + 1}-B${k0 + 2}+B${k0 + 3}`, pool.balance],
    [t("Check: sum of everyone's net − kitty (0 = OK)"), `ROUND(SUM(H2:H${lastP})-B${k0 + 4},2)`, 0],
  ];
  kitty.forEach(([label, f, v], i) => {
    const row = wsBal.getRow(k0 + i);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: i >= 4 };
    row.getCell(2).value = { formula: f, result: v };
    row.getCell(2).numFmt = moneyFmt;
    row.getCell(1).fill = TOTAL_FILL;
    row.getCell(2).fill = TOTAL_FILL;
  });

  // ---------------------------------------------------------------- Families
  header(wsFam, [t("Family / traveller"), t("Members"), t("Net"), t("Status")], [22, 40, 14, 12]);
  const units = familyLedger.entities;
  units.forEach((e, i) => {
    const r = i + 2;
    const row = wsFam.getRow(r);
    row.getCell(1).value = e.name;
    row.getCell(2).value = e.member_ids.map((id) => name[id]).join(", ");
    row.getCell(3).value = { formula: `SUMIFS(Balances!$H$2:$H$${lastP},Balances!$B$2:$B$${lastP},A${r})`, result: e.net };
    row.getCell(3).numFmt = moneyFmt;
    row.getCell(4).value = {
      formula: `IF(ABS(C${r})<0.005,${q(t("settled"))},IF(C${r}>0,${q(t("is owed"))},${q(t("owes"))}))`,
      result: Math.abs(e.net) < 0.005 ? t("settled") : e.net > 0 ? t("is owed") : t("owes"),
    };
  });
  const kr = units.length + 2;
  wsFam.getRow(kr).getCell(1).value = t("Cash Kitty");
  wsFam.getRow(kr).getCell(2).value = t("Unspent cash to return");
  wsFam.getRow(kr).getCell(3).value = { formula: `-Balances!B${k0 + 4}`, result: -pool.balance };
  wsFam.getRow(kr).getCell(3).numFmt = moneyFmt;
  wsFam.getRow(kr + 1).getCell(1).value = t("Check (0 = OK)");
  wsFam.getRow(kr + 1).getCell(3).value = { formula: `ROUND(SUM(C2:C${kr}),2)`, result: 0 };

  // ---------------------------------------------------------------- Settlement (static)
  wsPlan.getColumn(1).width = 6;
  [2, 3].forEach((c) => (wsPlan.getColumn(c).width = 26));
  wsPlan.getColumn(4).width = 14;
  let pr = 1;
  const kittyName = familyLedger.treasurerName ? `${t("Cash Kitty")} (${familyLedger.treasurerName})` : t("Cash Kitty");
  const writePlan = (title: string, ledger: Ledger) => {
    wsPlan.getCell(pr, 1).value = title;
    wsPlan.getCell(pr, 1).font = { bold: true, size: 13 };
    pr++;
    wsPlan.getCell(pr, 1).value = t("Worked out by the app when this file was saved. If you change transactions, use the Balances / Families sheets.");
    wsPlan.getCell(pr, 1).font = { italic: true, color: { argb: "FF6B7280" } };
    pr++;
    ["#", t("From"), t("To"), `${t("Amount")} (${base})`].forEach((h, i) => {
      const c = wsPlan.getCell(pr, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = HEADER_FILL;
    });
    pr++;
    if (ledger.transfers.length === 0) wsPlan.getCell(pr++, 2).value = t("Everyone is square");
    ledger.transfers.forEach((x, i) => {
      wsPlan.getCell(pr, 1).value = i + 1;
      wsPlan.getCell(pr, 2).value = x.from_id === KITTY_ID ? kittyName : x.from_name;
      wsPlan.getCell(pr, 3).value = x.to_id === KITTY_ID ? kittyName : x.to_name;
      wsPlan.getCell(pr, 4).value = x.amount;
      wsPlan.getCell(pr, 4).numFmt = moneyFmt;
      pr++;
    });
    pr++;
  };
  if (bundle.mini_groups.length) writePlan(t("Settlement plan — by family"), familyLedger);
  writePlan(t("Settlement plan — by person"), personLedger);

  // ---------------------------------------------------------------- Prepaid
  const PRE_MAX = Math.max(XLSX_ROWS.prepaid, prepaid.length + 50);
  const PRE_FIRST = 10; // column J
  const preCol = (i: number) => colLetter(PRE_FIRST + i);
  const preLast = preCol(Math.max(0, people.length - 1));
  header(
    wsPre,
    [
      t("Description"),
      t("Category"),
      t("Date"),
      t("Currency"),
      `${t("Exchange rate")} (→${base})`,
      t("Status (paid / due / recorded)"),
      t("Note"),
      t("Total"),
      `${t("Total")} (${base})`,
      ...people.map((p) => p.name),
    ],
    [30, 14, 11, 9, 12, 14, 30, 12, 13, ...people.map(() => 11)],
  );
  for (let r = 2; r <= PRE_MAX; r++) {
    const it = prepaid[r - 2];
    const row = wsPre.getRow(r);
    if (it) {
      row.getCell(1).value = it.title;
      row.getCell(2).value = it.category;
      row.getCell(3).value = it.date ?? "";
      row.getCell(4).value = it.currency;
      row.getCell(5).value = it.exchange_rate_to_base;
      row.getCell(6).value = it.status;
      row.getCell(7).value = it.note ?? "";
      const sh = Object.fromEntries(it.shares.map((s) => [s.participant_id, s.amount]));
      people.forEach((p, i) => {
        if (sh[p.id]) row.getCell(PRE_FIRST + i).value = sh[p.id];
      });
    }
    const tot = it ? it.shares.reduce((a, s) => a + s.amount, 0) : 0;
    const totBase = it ? it.shares.reduce((a, s) => a + prepaidShareBase(s.amount, it.exchange_rate_to_base, base), 0) : 0;
    row.getCell(8).value = { formula: `IF(A${r}="","",SUM(${preCol(0)}${r}:${preLast}${r}))`, result: it ? tot : "" } as ExcelJSType.CellFormulaValue;
    row.getCell(9).value = {
      formula: `IF(A${r}="","",SUMPRODUCT(ROUND(${preCol(0)}${r}:${preLast}${r}*IF(E${r}="",1,E${r}),${dec})))`,
      result: it ? totBase : "",
    } as ExcelJSType.CellFormulaValue;
    row.getCell(8).numFmt = "#,##0.##";
    row.getCell(9).numFmt = moneyFmt;
    if (r <= prepaid.length + 20) for (let c = 1; c <= 7; c++) row.getCell(c).fill = INPUT_FILL;
  }
  addValidation(wsPre, `B2:B${PRE_MAX}`, catList);
  addValidation(wsPre, `F2:F${PRE_MAX}`, statusList);
  const P = (col: string) => `Prepaid!$${col}$2:$${col}$${PRE_MAX}`;

  // ---------------------------------------------------------------- PersonTotals
  const totHeaders = [
    t("Person"),
    t("Settles as"),
    ...categories.map((c) => t(c)),
    t("Spent in the app"),
    `${t("Paid before the trip")} (${base})`,
    `${t("Still to pay")} (${base})`,
    `${t("Trip total")} (${base})`,
    ...prepaidCurrencies.map((c) => `${t("Prepaid")} (${c})`),
  ];
  header(wsTot, totHeaders, [16, 18, ...categories.map(() => 12), 13, 14, 13, 14, ...prepaidCurrencies.map(() => 13)]);
  const catStart = 3;
  const spendCol = catStart + categories.length;
  const D = rng("D");
  totals.people.forEach((pt, i) => {
    const r = i + 2;
    const pi = people.findIndex((p) => p.id === pt.participant_id);
    const S = rng(shareCol(pi));
    const Pc = P(preCol(pi));
    const row = wsTot.getRow(r);
    row.getCell(1).value = { formula: `People!A${pi + 2}`, result: pt.name };
    row.getCell(2).value = { formula: `People!C${pi + 2}`, result: settlesAs(pt.participant_id) };
    categories.forEach((c, ci) => {
      row.getCell(catStart + ci).value = {
        formula: `SUMIFS(${S},${B},"CASH_EXPENSE",${D},${q(c)})+SUMIFS(${S},${B},"CARD_EXPENSE",${D},${q(c)})-SUMIFS(${S},${B},"REFUND",${D},${q(c)})`,
        result: pt.byCategory[c] ?? 0,
      };
    });
    const sc = colLetter(spendCol);
    row.getCell(spendCol).value = { formula: `SUM(${colLetter(catStart)}${r}:${colLetter(spendCol - 1)}${r})`, result: pt.tripSpend };
    row.getCell(spendCol + 1).value = { formula: `SUMPRODUCT(ROUND(${Pc}*${P("E")},${dec})*(${P("F")}="paid"))`, result: pt.prepaidPaid };
    row.getCell(spendCol + 2).value = { formula: `SUMPRODUCT(ROUND(${Pc}*${P("E")},${dec})*(${P("F")}="due"))`, result: pt.prepaidDue };
    row.getCell(spendCol + 3).value = { formula: `${sc}${r}+${colLetter(spendCol + 1)}${r}+${colLetter(spendCol + 2)}${r}`, result: pt.total };
    prepaidCurrencies.forEach((c, ci) => {
      const v = pt.prepaidByCurrency[c];
      row.getCell(spendCol + 4 + ci).value = {
        formula: `SUMIFS(${Pc},${P("D")},${q(c)},${P("F")},"<>recorded")`,
        result: v ? v.paid + v.due : 0,
      };
    });
    for (let c = catStart; c <= spendCol + 3; c++) row.getCell(c).numFmt = moneyFmt;
    row.getCell(spendCol + 3).font = { bold: true };
  });
  const tr = totals.people.length + 2;
  wsTot.getRow(tr).getCell(1).value = t("Total");
  for (let c = catStart; c <= spendCol + 3 + prepaidCurrencies.length; c++) {
    const L = colLetter(c);
    const cell = wsTot.getRow(tr).getCell(c);
    cell.value = { formula: `SUM(${L}2:${L}${tr - 1})` };
    cell.numFmt = c <= spendCol + 3 ? moneyFmt : "#,##0.##";
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
  }
  wsTot.getRow(tr).getCell(1).fill = TOTAL_FILL;
  // Family subtotals
  const fr0 = tr + 2;
  wsTot.getRow(fr0).getCell(1).value = t("By family");
  wsTot.getRow(fr0).getCell(1).font = { bold: true };
  const T = colLetter(spendCol + 3);
  totals.groups.forEach((g, i) => {
    const r = fr0 + 1 + i;
    wsTot.getRow(r).getCell(1).value = g.name;
    wsTot.getRow(r).getCell(2).value = { formula: `SUMIFS($${T}$2:$${T}$${tr - 1},$B$2:$B$${tr - 1},A${r})`, result: g.total };
    wsTot.getRow(r).getCell(2).numFmt = moneyFmt;
  });

  // ---------------------------------------------------------------- Budget
  header(wsBud, [t("Category"), t("Planned"), t("Actual"), t("Left"), t("Notes")], [18, 13, 13, 13, 30]);
  const planned = new Map(bundle.budget_items.map((b) => [b.category, b]));
  categories.forEach((c, i) => {
    const r = i + 2;
    const row = wsBud.getRow(r);
    row.getCell(1).value = c;
    row.getCell(2).value = planned.get(c)?.planned_amount_base ?? null;
    row.getCell(2).fill = INPUT_FILL;
    row.getCell(3).value = {
      formula: `SUMIFS(${H},${B},"CASH_EXPENSE",${D},A${r})+SUMIFS(${H},${B},"CARD_EXPENSE",${D},A${r})-SUMIFS(${H},${B},"REFUND",${D},A${r})`,
    };
    row.getCell(4).value = { formula: `IF(B${r}="","",B${r}-C${r})` };
    row.getCell(5).value = planned.get(c)?.notes ?? "";
    for (const k of [2, 3, 4]) row.getCell(k).numFmt = moneyFmt;
  });

  // ---------------------------------------------------------------- Itinerary (static)
  if (wsIt && guide) {
    header(wsIt, [t("Day"), t("Date"), t("Time"), t("Type"), t("Title"), t("Details"), t("Who"), t("Address"), t("Phone"), t("Links"), t("Notes")], [5, 11, 13, 9, 40, 30, 18, 36, 15, 30, 40]);
    let r = 2;
    const put = (day: number | string, date: string, it: GuideItem, prefix = "") => {
      const row = wsIt.getRow(r++);
      row.getCell(1).value = day;
      row.getCell(2).value = date;
      row.getCell(3).value = it.time ?? "";
      row.getCell(4).value = t(KIND_LABELS[it.kind] ?? it.kind);
      row.getCell(5).value = prefix + it.title;
      row.getCell(6).value = [it.detail, it.duration, it.cost ? `¥${it.cost.toLocaleString("en")} pp` : ""].filter(Boolean).join(" · ");
      row.getCell(7).value = it.who ?? "";
      if (it.address || it.map) row.getCell(8).value = { text: it.address ?? it.map!, hyperlink: mapsUrl(it.map && it.address ? `${it.map} ${it.address}` : it.address ?? it.map!) };
      if (it.phone) row.getCell(9).value = { text: it.phone, hyperlink: `tel:${telE164(it.phone)}` };
      row.getCell(10).value = (it.links ?? []).map((l) => `${l.label}: ${l.url}`).join("\n");
      row.getCell(11).value = [...(it.alert ? [`⚠ ${it.alert}`] : []), ...(it.notes ?? []), ...(it.private ?? [])].join("\n");
      row.alignment = { wrapText: true, vertical: "top" };
      for (const o of it.options ?? []) put("", "", o, `${t("or")}: `);
    };
    for (const day of guide.days) {
      const row = wsIt.getRow(r++);
      row.getCell(1).value = day.day;
      row.getCell(2).value = day.date;
      row.getCell(5).value = day.title;
      row.font = { bold: true };
      row.eachCell((c) => (c.fill = TOTAL_FILL));
      for (const it of day.items) put(day.day, day.date, it);
    }
    r++;
    wsIt.getRow(r++).getCell(5).value = t("Hotels");
    for (const s of guide.stays) {
      const row = wsIt.getRow(r++);
      row.getCell(2).value = s.nights.join(", ");
      row.getCell(4).value = t("Hotel");
      row.getCell(5).value = s.name + (s.who ? ` (${s.who})` : "");
      row.getCell(6).value = [s.checkIn && `Check-in ${s.checkIn}`, s.checkOut && `Check-out ${s.checkOut}`].filter(Boolean).join(" · ");
      if (s.address || s.map) row.getCell(8).value = { text: s.address ?? s.map!, hyperlink: mapsUrl(s.map && s.address ? `${s.map} ${s.address}` : s.address ?? s.map!) };
      if (s.phone) row.getCell(9).value = { text: s.phone, hyperlink: `tel:${telE164(s.phone)}` };
      row.getCell(10).value = (s.links ?? []).map((l) => `${l.label}: ${l.url}`).join("\n");
      row.getCell(11).value = [...(s.rooms ?? []), ...(s.notes ?? []), ...(s.private ?? [])].join("\n");
      row.alignment = { wrapText: true, vertical: "top" };
    }
  }

  // ---------------------------------------------------------------- ReadMe
  readme.getColumn(1).width = 110;
  const lines: [string, boolean?][] = [
    [`${bundle.trip.name} — Travel Hub`, true],
    [t("Saved {date}. Amounts in {base} unless a column says otherwise.", { date: new Date().toISOString().slice(0, 10), base })],
    [""],
    [t("How this file works"), true],
    [t("Yellow cells are data you can type in. Every other number is an Excel formula, so the file keeps working offline:")],
    [t("• Add a row on Transactions (date, type, description, amount, who paid, and each person's share) and Balances, Families and PersonTotals update.")],
    [t("• The Check columns should show 0. If not, the shares on that row don't add up to the amount.")],
    [t("• Prepaid holds hotels/flights paid outside the app. Status: paid = settled already, due = still to pay, recorded = also logged as an expense (not counted twice).")],
    [t("• Settlement is a snapshot from the app (the fewest payments). Balances and Families always show who owes what.")],
    [""],
    [t("Transaction types"), true],
    [t("CASH_DEPOSIT — cash given to the Treasurer (Paid by = who gave it; no shares)")],
    [t("CASH_EXPENSE — paid from the kitty (Paid by empty; shares = who it was for)")],
    [t("CARD_EXPENSE — someone paid with their own card/cash (Paid by = payer; shares = who it was for)")],
    [t("CASH_PAYOUT — kitty cash handed to someone (Paid by = who received it; no shares)")],
    [t("TRANSFER — one person paid another directly (Paid by = payer; the receiver's share = full amount)")],
    [t("REFUND — money back from a shop (Paid by = who got it, or empty if it went into the kitty; shares = what each person gets back)")],
    [""],
    [t("Net: positive = is owed money, negative = owes money. Sum of everyone's net = cash left in the kitty.")],
  ];
  lines.forEach(([text, bold], i) => {
    const c = readme.getCell(i + 1, 1);
    c.value = text;
    c.font = { bold: !!bold, size: i === 0 ? 14 : 11 };
    c.alignment = { wrapText: true };
  });

  return wb;
}

/** Drop-down list on a range (ExcelJS supports ranges at runtime but not in its types). */
function addValidation(ws: ExcelJSType.Worksheet, range: string, listRef: string) {
  (ws as unknown as { dataValidations: { add: (r: string, v: ExcelJSType.DataValidation) => void } }).dataValidations.add(range, {
    type: "list",
    allowBlank: true,
    formulae: [listRef],
    showErrorMessage: false,
  });
}


function interp(k: string, vars?: Record<string, string | number>) {
  return Object.entries(vars ?? {}).reduce((acc, [n, v]) => acc.replaceAll(`{${n}}`, String(v)), k);
}

export async function downloadTripWorkbook(input: WorkbookInput, filename: string) {
  const Excel = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = buildTripWorkbook(Excel as ExcelJS, input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
