import { beforeAll, describe, expect, it } from "vitest";

// Force the in-memory store so this never touches a real database.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colLetter, buildTripWorkbook } from "@/lib/exportXlsx";
import { computeTripTotals } from "@/lib/personTotals";
import { createPrepaid, getTripBundle, loadDemoTrip } from "@/lib/repo";
import { computeLedger } from "@/lib/settlement";
import type { TripBundle } from "@/lib/types";

let b: TripBundle;
beforeAll(async () => {
  const trip = await loadDemoTrip();
  const first = await getTripBundle(trip.id);
  const [p1, p2, p3] = first.participants;
  await createPrepaid({ trip_id: trip.id, title: "Flights", category: "Flights", currency: "HKD", exchange_rate_to_base: 19.37, status: "paid", shares: [{ participant_id: p1.id, amount: 4200 }, { participant_id: p2.id, amount: 4200.5 }] });
  await createPrepaid({ trip_id: trip.id, title: "Hotel night 2", category: "Accommodation", currency: "JPY", status: "due", shares: [{ participant_id: p1.id, amount: 18000 }, { participant_id: p3.id, amount: 18000 }] });
  await createPrepaid({ trip_id: trip.id, title: "Logged already", category: "Accommodation", currency: "JPY", status: "recorded", shares: [{ participant_id: p2.id, amount: 999 }] });
  b = await getTripBundle(trip.id);
});

describe("colLetter", () => {
  it("converts column numbers", () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(colLetter)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });
});

const soffice = ["/usr/bin/soffice", "/usr/bin/libreoffice"].find(existsSync);

describe.skipIf(!soffice)("Excel export formulas match the app (recalculated by LibreOffice)", () => {
  let sheets: Record<string, (string | number | null)[][]>;
  beforeAll(async () => {
    const wb = buildTripWorkbook(ExcelJS, { bundle: b });
    // Strip cached results so the comparison really tests the formulas.
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => {
      const v = c.value as { formula?: string } | null;
      if (v && typeof v === "object" && "formula" in v) c.value = { formula: v.formula } as ExcelJS.CellFormulaValue;
    })));
    const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
    const src = join(dir, "in.xlsx");
    writeFileSync(src, Buffer.from(await wb.xlsx.writeBuffer()));
    execFileSync(soffice!, ["--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), src], { stdio: "ignore", timeout: 120_000 });
    // Read the recalculated values with openpyxl (ExcelJS doesn't read LibreOffice's cached results reliably).
    const py = `import json,sys,openpyxl\nwb=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({ws.title:[list(r) for r in ws.iter_rows(values_only=True)] for ws in wb}, default=str))`;
    sheets = JSON.parse(execFileSync("python3", ["-I", "-c", py, join(dir, "out", "in.xlsx")], { maxBuffer: 64 * 1024 * 1024 }).toString());
  }, 180_000);

  const val = (sheet: string, addr: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(addr)!;
    const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    return Number(sheets[sheet][Number(m[2]) - 1]?.[col - 1] ?? 0);
  };

  it("per-person balances and kitty", () => {
    const ledger = computeLedger(b);
    b.participants.forEach((p, i) => {
      const r = i + 2;
      const bal = ledger.balances[p.id];
      expect(val("Balances", `C${r}`)).toBeCloseTo(bal.deposits, 2);
      expect(val("Balances", `D${r}`)).toBeCloseTo(bal.card_paid, 2);
      expect(val("Balances", `E${r}`)).toBeCloseTo(bal.shares, 2);
      expect(val("Balances", `F${r}`)).toBeCloseTo(bal.received, 2);
      expect(val("Balances", `G${r}`)).toBeCloseTo(bal.settled, 2);
      expect(val("Balances", `H${r}`)).toBeCloseTo(bal.net, 2);
    });
    const k0 = b.participants.length + 3;
    expect(val("Balances", `B${k0 + 4}`)).toBeCloseTo(ledger.pool.balance, 2);
    expect(val("Balances", `B${k0 + 5}`)).toBe(0);
  });

  it("families", () => {
    const ledger = computeLedger(b);
    ledger.entities.forEach((e, i) => expect(val("Families", `C${i + 2}`)).toBeCloseTo(e.net, 2));
    expect(val("Families", `C${ledger.entities.length + 3}`)).toBe(0);
  });

  it("transaction checks are all zero", () => {
    b.transactions.forEach((_, i) => expect(val("Transactions", `J${i + 2}`)).toBe(0));
  });

  it("per-person totals include prepaid costs", () => {
    const totals = computeTripTotals(b);
    const headers = sheets.PersonTotals[0].map((h) => String(h ?? ""));
    const col = (label: string) => colLetter(headers.findIndex((h) => h.startsWith(label)) + 1);
    totals.people.forEach((pt, i) => {
      const r = i + 2;
      expect(val("PersonTotals", `${col("Spent in the app")}${r}`)).toBeCloseTo(pt.tripSpend, 2);
      expect(val("PersonTotals", `${col("Paid before the trip")}${r}`)).toBeCloseTo(pt.prepaidPaid, 2);
      expect(val("PersonTotals", `${col("Still to pay")}${r}`)).toBeCloseTo(pt.prepaidDue, 2);
      expect(val("PersonTotals", `${col("Trip total")}${r}`)).toBeCloseTo(pt.total, 2);
      expect(val("PersonTotals", `${col("Prepaid (HKD)")}${r}`)).toBeCloseTo(pt.prepaidByCurrency.HKD ? pt.prepaidByCurrency.HKD.paid : 0, 2);
    });
  });
});
