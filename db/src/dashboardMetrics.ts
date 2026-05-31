import { add, money, toMajor, type Money } from '@housef4/money';

import { dbLog } from './structuredLog';
import type { TransactionRecord } from './types';
import type { DashboardMetricsStored } from './dashboardMetricsSchema';

export {
  dashboardMetricsStoredSchema,
  parseStoredDashboardMetrics,
  StoredDashboardMetricsParseError,
  type DashboardMetricsStored,
} from './dashboardMetricsSchema';

const METRICS_DISPLAY_SCALE = 2;

function amountToMetricMajor(amount: Money, currency: string): number {
  return toMajor(amount, currency);
}

function filterTransactionsByCurrency(
  txns: TransactionRecord[],
  currency: string,
  currencyForFile: (fileId: string) => string | undefined,
): TransactionRecord[] {
  const code = currency.trim().toUpperCase();
  return txns.filter(
    (t) => currencyForFile(t.transaction_file_id)?.trim().toUpperCase() === code,
  );
}

function utcMonthStartMs(year: number, month0: number): number {
  return Date.UTC(year, month0, 1, 0, 0, 0, 0);
}

function utcMonthEndMs(year: number, month0: number): number {
  return Date.UTC(year, month0 + 1, 0, 23, 59, 59, 999);
}

function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): [number, number] {
  const total = year * 12 + month0 + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  return [y, m];
}

function monthLabelUtc(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 15)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function utcYearMonthFromMs(ms: number): [number, number] {
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth()];
}

/** Inclusive UTC month range as `[year, month0]` tuples from start through end. */
function eachUtcMonthInclusive(
  startY: number,
  startM: number,
  endY: number,
  endM: number,
): [number, number][] {
  const endIdx = endY * 12 + endM;
  const out: [number, number][] = [];
  let y = startY;
  let m = startM;
  for (;;) {
    out.push([y, m]);
    const idx = y * 12 + m;
    if (idx >= endIdx) break;
    [y, m] = shiftMonth(y, m, 1);
  }
  return out;
}

function aggregateForRange(
  txns: TransactionRecord[],
  start: number,
  end: number,
  currency: string,
): {
  incomeAmount: Money;
  expensesAmount: Money;
  categoryTotalsAmount: Map<string, Money>;
} {
  let incomeAmount = money(0);
  let expensesAmount = money(0);
  const categoryTotalsAmount = new Map<string, Money>();
  for (const t of txns) {
    if (t.date < start || t.date > end) continue;
    const amt = t.canonicalAmount;
    if (amt.units > 0) {
      incomeAmount = add(incomeAmount, amt, currency);
    } else if (amt.units < 0) {
      const outflow = money(-amt.units);
      expensesAmount = add(expensesAmount, outflow, currency);
      const cat = t.category || 'Uncategorized';
      const prev = categoryTotalsAmount.get(cat) ?? money(0);
      categoryTotalsAmount.set(cat, add(prev, outflow, currency));
    }
  }
  return { incomeAmount, expensesAmount, categoryTotalsAmount };
}

/** True when every month in the snapshot has no inflow/outflow (e.g. stale cache from pre-anchor bug). */
export function metricsSnapshotLooksAllZero(s: DashboardMetricsStored): boolean {
  const m = s.monthly_cashflow;
  if (m.income !== 0 || m.expenses !== 0 || m.net !== 0) return false;
  for (const h of s.cashflow_history) {
    if (h.income !== 0 || h.expenses !== 0) return false;
  }
  return true;
}

type CashflowRow = {
  label: string;
  month_start_ms: number;
  income: number;
  expenses: number;
};

function netWorthChangePctFromHistory(
  cashflow_history: CashflowRow[],
): number | undefined {
  if (cashflow_history.length < 2) return undefined;
  const prev = cashflow_history.at(-2);
  const cur = cashflow_history.at(-1);
  if (!prev || !cur) return undefined;
  const prevNet = prev.income - prev.expenses;
  const curNet = cur.income - cur.expenses;
  if (prevNet === 0 && curNet === 0) return undefined;
  const denom = Math.max(Math.abs(prevNet), 1e-6);
  return (curNet - prevNet) / denom;
}

function scanTransactionsForDiagnostics(
  txns: TransactionRecord[],
  currency: string,
): {
  txnMinDate: number;
  txnMaxDate: number;
  countPositive: number;
  countNegative: number;
  countZero: number;
  sumPositiveAmounts: number;
  sumNegativeAmounts: number;
} {
  let txnMinDate = Number.POSITIVE_INFINITY;
  let txnMaxDate = Number.NEGATIVE_INFINITY;
  let countPositive = 0;
  let countNegative = 0;
  let countZero = 0;
  let sumPositiveAmounts = 0;
  let sumNegativeAmounts = 0;
  for (const t of txns) {
    if (t.date < txnMinDate) txnMinDate = t.date;
    if (t.date > txnMaxDate) txnMaxDate = t.date;
    if (t.canonicalAmount.units > 0) {
      countPositive += 1;
      sumPositiveAmounts += amountToMetricMajor(t.canonicalAmount, currency);
    } else if (t.canonicalAmount.units < 0) {
      countNegative += 1;
      sumNegativeAmounts += amountToMetricMajor(t.canonicalAmount, currency);
    } else {
      countZero += 1;
    }
  }
  if (txns.length === 0) {
    txnMinDate = Number.NaN;
    txnMaxDate = Number.NaN;
  }
  return {
    txnMinDate,
    txnMaxDate,
    countPositive,
    countNegative,
    countZero,
    sumPositiveAmounts,
    sumNegativeAmounts,
  };
}

export function computeDashboardMetrics(
  txns: TransactionRecord[],
  clockNowMs: number,
  currency: string,
  currencyForFile: (fileId: string) => string | undefined,
): DashboardMetricsStored {
  const scoped = filterTransactionsByCurrency(txns, currency, currencyForFile);
  const scan = scanTransactionsForDiagnostics(scoped, currency);
  const [todayY, todayM] = utcYearMonthFromMs(clockNowMs);

  let spanStartY = todayY;
  let spanStartM = todayM;
  if (scoped.length > 0 && Number.isFinite(scan.txnMinDate)) {
    const [ey, em] = utcYearMonthFromMs(scan.txnMinDate);
    spanStartY = ey;
    spanStartM = em;
  }
  const startIdx = spanStartY * 12 + spanStartM;
  const endIdx = todayY * 12 + todayM;
  if (startIdx > endIdx) {
    spanStartY = todayY;
    spanStartM = todayM;
  }

  const cashflow_history: {
    label: string;
    month_start_ms: number;
    income: number;
    expenses: number;
  }[] = [];
  for (const [y, m] of eachUtcMonthInclusive(
    spanStartY,
    spanStartM,
    todayY,
    todayM,
  )) {
    const start = utcMonthStartMs(y, m);
    const end = utcMonthEndMs(y, m);
    const { incomeAmount, expensesAmount } = aggregateForRange(
      scoped,
      start,
      end,
      currency,
    );
    cashflow_history.push({
      label: monthLabelUtc(y, m),
      month_start_ms: start,
      income: amountToMetricMajor(incomeAmount, currency),
      expenses: amountToMetricMajor(expensesAmount, currency),
    });
  }

  const cy = todayY;
  const cm = todayM;
  const curStart = utcMonthStartMs(cy, cm);
  const curEnd = utcMonthEndMs(cy, cm);
  const {
    incomeAmount: curIncomeAmount,
    expensesAmount: curExpensesAmount,
    categoryTotalsAmount,
  } = aggregateForRange(scoped, curStart, curEnd, currency);

  const spending_by_category = [...categoryTotalsAmount.entries()]
    .map(([category, categoryAmount]) => ({
      category,
      amount: amountToMetricMajor(categoryAmount, currency),
    }))
    .sort((a, b) => b.amount - a.amount);

  const curIncome = amountToMetricMajor(curIncomeAmount, currency);
  const curExpenses = amountToMetricMajor(curExpensesAmount, currency);
  const net = curIncome - curExpenses;

  const firstLabel = cashflow_history[0]?.label ?? '';
  const lastLabel = cashflow_history.at(-1)?.label ?? '';
  const cashflow_period_label =
    firstLabel && lastLabel && firstLabel !== lastLabel
      ? `${firstLabel} – ${lastLabel}`
      : firstLabel || 'Cash flow';

  const net_worth_change_pct = netWorthChangePctFromHistory(cashflow_history);

  const out: DashboardMetricsStored = {
    transaction_count: scoped.length,
    monthly_cashflow: {
      income: curIncome,
      expenses: curExpenses,
      net,
    },
    spending_by_category,
    cashflow_history,
    cashflow_period_label,
  };
  if (net_worth_change_pct !== undefined) {
    out.net_worth_change_pct = net_worth_change_pct;
  }

  const hist = out.cashflow_history.map((h) => ({
    label: h.label,
    income: h.income,
    expenses: h.expenses,
    net: h.income - h.expenses,
  }));
  const cashflowHistoryLog =
    hist.length <= 18
      ? hist
      : {
          totalMonths: hist.length,
          head: hist.slice(0, 6),
          tail: hist.slice(-6),
        };

  dbLog('info', 'dashboardMetrics.compute', {
    clockNowMs,
    clockNowIso: new Date(clockNowMs).toISOString(),
    spanUtc: {
      startYear: spanStartY,
      startMonth0: spanStartM,
      endYear: todayY,
      endMonth0: todayM,
    },
    historyMonthCount: out.cashflow_history.length,
    summaryUtc: { year: cy, month0: cm },
    currentMonthUtcBounds: { startMs: curStart, endMs: curEnd },
    txnCount: txns.length,
    txnDateRangeMs:
      txns.length > 0
        ? {
            min: scan.txnMinDate,
            max: scan.txnMaxDate,
            minIso: new Date(scan.txnMinDate).toISOString(),
            maxIso: new Date(scan.txnMaxDate).toISOString(),
          }
        : null,
    amountSigns: {
      countPositive: scan.countPositive,
      countNegative: scan.countNegative,
      countZero: scan.countZero,
      sumPositiveAmounts: scan.sumPositiveAmounts,
      sumNegativeAmounts: scan.sumNegativeAmounts,
    },
    monthly_cashflow: out.monthly_cashflow,
    spendingByCategoryCount: out.spending_by_category.length,
    spendingTop5: out.spending_by_category.slice(0, 5),
    cashflowHistory: cashflowHistoryLog,
    net_worth_change_pct: out.net_worth_change_pct ?? null,
  });

  return out;
}
