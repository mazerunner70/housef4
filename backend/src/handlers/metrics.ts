import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';

export async function getMetricsPayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  try {
    const payload = await getFinanceRepository().getMetrics(userId);
    log.info('metrics.loaded', {
      durationMs: Date.now() - t0,
      userIdLength: userId.length,
      monthly_income: payload.monthly_cashflow.income,
      monthly_expenses: payload.monthly_cashflow.expenses,
      monthly_net: payload.monthly_cashflow.net,
      net_worth: payload.net_worth,
      spending_categories: payload.spending_by_category.length,
      cashflow_history_months: payload.cashflow_history?.length ?? 0,
    });
    return payload;
  } catch (err) {
    log.error('metrics.failed', {
      durationMs: Date.now() - t0,
      userIdLength: userId.length,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
