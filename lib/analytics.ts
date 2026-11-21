import { fromCents, toCents } from "./settlement";
import { EXPENSE_TYPES, type BudgetItem, type Transaction } from "./types";

/** Real spending only — deposits, payouts and settle-ups just move cash around. */
export const isExpense = (t: Transaction) => EXPENSE_TYPES.includes(t.type);
/** Spending and refunds (refunds count as negative spending). */
const affectsSpend = (t: Transaction) => isExpense(t) || t.type === "REFUND";
/** Signed spend in cents: expenses positive, refunds negative. */
const spendCents = (t: Transaction) => (t.type === "REFUND" ? -1 : 1) * toCents(t.amount_base);

export function categoryTotals(transactions: Transaction[]) {
  const m = new Map<string, number>();
  for (const t of transactions.filter(affectsSpend)) m.set(t.category, (m.get(t.category) ?? 0) + spendCents(t));
  return [...m.entries()]
    .filter(([, c]) => c !== 0)
    .map(([category, c]) => ({ category, amount: fromCents(c) }))
    .sort((a, b) => b.amount - a.amount);
}

/** Daily spend and running total for every calendar day from first to last expense. */
export function dailySeries(transactions: Transaction[]) {
  const exp = transactions.filter(affectsSpend);
  if (exp.length === 0) return [];
  const m = new Map<string, number>();
  for (const t of exp) {
    const d = t.occurred_at.slice(0, 10);
    m.set(d, (m.get(d) ?? 0) + spendCents(t));
  }
  const days = [...m.keys()].sort();
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
  const out: { date: string; daily: number; cumulative: number }[] = [];
  let run = 0;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    const c = m.get(key) ?? 0;
    run += c;
    out.push({ date: key, daily: fromCents(c), cumulative: fromCents(run) });
  }
  return out;
}

export function keyMetrics(transactions: Transaction[], participantCount: number) {
  const exp = transactions.filter(affectsSpend);
  const total = exp.reduce((a, t) => a + spendCents(t), 0);
  // Cash = kitty spending, less cash refunds paid back into the kitty.
  const isCash = (t: Transaction) => t.type === "CASH_EXPENSE" || (t.type === "REFUND" && !t.paid_by_participant_id);
  const cash = exp.filter(isCash).reduce((a, t) => a + spendCents(t), 0);
  const days = dailySeries(transactions).length;
  return {
    total: fromCents(total),
    days,
    avgDaily: days ? fromCents(Math.round(total / days)) : 0,
    perPerson: participantCount ? fromCents(Math.round(total / participantCount)) : 0,
    cash: fromCents(cash),
    card: fromCents(total - cash),
    cashShare: total ? cash / total : 0,
  };
}

export function budgetComparison(budgets: BudgetItem[], transactions: Transaction[]) {
  const actual = new Map(categoryTotals(transactions).map((c) => [c.category, c.amount]));
  const rows = budgets.map((b) => {
    const spent = actual.get(b.category) ?? 0;
    return { ...b, actual: spent, ratio: b.planned_amount_base > 0 ? spent / b.planned_amount_base : spent > 0 ? Infinity : 0 };
  });
  const planned = new Set(budgets.map((b) => b.category));
  const unbudgeted = [...actual.entries()].filter(([c]) => !planned.has(c)).map(([category, amount]) => ({ category, amount }));
  return { rows, unbudgeted };
}
