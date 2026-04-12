import { AsyncLocalStorage } from 'node:async_hooks';

import { createLogger, type Logger } from './logger';

type Store = { requestId: string };

const storage = new AsyncLocalStorage<Store>();

/**
 * Run async work with a `requestId` on all structured logs (Lambda request id or local UUID).
 */
export function runWithRequestLogAsync<T>(
  requestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ requestId }, fn);
}

export function getLog(): Logger {
  const ctx = storage.getStore();
  return createLogger(ctx ? { requestId: ctx.requestId } : {});
}
