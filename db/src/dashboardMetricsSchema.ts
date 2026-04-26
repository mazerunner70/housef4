import { coerce, type output, type ZodError, z } from 'zod';

function stringFromMetricWire(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  if (typeof v === 'symbol') return v.toString();
  return '';
}

/** `coerce.*` = legacy API; use until `z.number({ coerce: true })` is in public typings. */
const finiteCoerced = coerce.number();

/** Parses labels produced by `monthLabelUtc` (en-US, short month, UTC) — used when `month_start_ms` is missing. */
function monthStartMsFromEnUsShortUtcLabel(label: string): number {
  const t = label.trim();
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(t);
  if (!m) return Number.NaN;
  const short = m[1].slice(0, 1).toUpperCase() + m[1].slice(1).toLowerCase();
  const monthIx = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].indexOf(short);
  if (monthIx < 0) return Number.NaN;
  const year = Number(m[2]);
  if (!Number.isFinite(year)) return Number.NaN;
  return Date.UTC(year, monthIx, 1, 0, 0, 0, 0);
}

const cashflowRowSchema = z
  .object({
    label: z.unknown(),
    month_start_ms: z.unknown(),
    income: z.unknown(),
    expenses: z.unknown(),
  })
  .superRefine((row, ctx) => {
    const inc = Number(row.income);
    const exp = Number(row.expenses);
    if (!Number.isFinite(inc)) {
      ctx.addIssue({
        code: 'custom',
        message: 'income must be a finite number',
        path: ['income'],
      });
    }
    if (!Number.isFinite(exp)) {
      ctx.addIssue({
        code: 'custom',
        message: 'expenses must be a finite number',
        path: ['expenses'],
      });
    }
    const label = stringFromMetricWire(row.label);
    const msm = Number(row.month_start_ms);
    const monthStartMs = Number.isFinite(msm) ? msm : monthStartMsFromEnUsShortUtcLabel(label);
    if (!Number.isFinite(monthStartMs)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'month_start_ms (or label for decoding) must be a finite number',
        path: ['month_start_ms'],
      });
    }
  })
  .transform((row) => {
    const label = stringFromMetricWire(row.label);
    const inc = Number(row.income);
    const exp = Number(row.expenses);
    const msm = Number(row.month_start_ms);
    const month_start_ms = Number.isFinite(msm) ? msm : monthStartMsFromEnUsShortUtcLabel(label);
    return { label, month_start_ms, income: inc, expenses: exp };
  });

const monthlyCashflowSchema = z.object({
  income: finiteCoerced,
  expenses: finiteCoerced,
  net: finiteCoerced,
});

const spendingByCategoryRowSchema = z.object({
  category: z.unknown().transform(stringFromMetricWire),
  amount: finiteCoerced,
});

const netWorthChangePctSchema = z
  .union([z.null(), finiteCoerced, z.undefined()])
  .transform((v) => v ?? undefined);

/**
 * Single source of truth: persisted / wire shape for the subset of a METRICS item
 * that is derived dashboard aggregates (Dynamo may add PK, SK, etc. — we `.loose()` those).
 */
export const dashboardMetricsStoredSchema = z
  .object({
    transaction_count: z.unknown().transform((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }),
    monthly_cashflow: monthlyCashflowSchema,
    spending_by_category: z.array(spendingByCategoryRowSchema),
    cashflow_history: z.array(cashflowRowSchema).min(1),
    cashflow_period_label: z.string(),
    net_worth_change_pct: netWorthChangePctSchema.optional(),
  })
  .loose();

export type DashboardMetricsStored = output<typeof dashboardMetricsStoredSchema>;

export class StoredDashboardMetricsParseError extends Error {
  override readonly name = 'StoredDashboardMetricsParseError';
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
  }
}

function zodErrorToPath(err: ZodError): { path: string; message: string } {
  const i = err.issues[0];
  if (!i) {
    return { path: '(root)', message: err.message };
  }
  const p = i.path.length > 0 ? i.path.map(String).join('.') : '(root)';
  const message = 'message' in i && i.message ? String(i.message) : 'Validation failed';
  return { path: p, message };
}

export function parseStoredDashboardMetrics(raw: unknown): DashboardMetricsStored {
  const r = dashboardMetricsStoredSchema.safeParse(raw);
  if (r.success) return r.data;
  const { path, message } = zodErrorToPath(r.error);
  throw new StoredDashboardMetricsParseError(
    `Invalid METRICS payload at ${path}: ${message}`,
    path,
  );
}
