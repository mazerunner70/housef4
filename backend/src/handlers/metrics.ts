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
