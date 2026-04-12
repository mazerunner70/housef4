/**
 * One JSON line per log entry for CloudWatch / local grep (see design doc §11).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SERVICE = 'housef4-api';

function emit(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown>,
  base: Record<string, unknown>,
): void {
  const line = {
    level,
    msg,
    time: new Date().toISOString(),
    service: SERVICE,
    ...base,
    ...fields,
  };
  const s = JSON.stringify(line);
  if (level === 'error') {
    console.error(s);
  } else {
    console.log(s);
  }
}

export function createLogger(base: Record<string, unknown> = {}) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) =>
      emit('debug', msg, fields ?? {}, base),
    info: (msg: string, fields?: Record<string, unknown>) =>
      emit('info', msg, fields ?? {}, base),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      emit('warn', msg, fields ?? {}, base),
    error: (msg: string, fields?: Record<string, unknown>) =>
      emit('error', msg, fields ?? {}, base),
  };
}

export type Logger = ReturnType<typeof createLogger>;
