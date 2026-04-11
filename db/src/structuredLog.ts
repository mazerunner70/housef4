import { inspect } from 'node:util';

export type DbLogLevel = 'debug' | 'info' | 'warn' | 'error';

function stringifyLogLine(line: Record<string, unknown>): string {
  try {
    return JSON.stringify(line);
  } catch (firstErr) {
    const firstMsg =
      firstErr instanceof Error ? firstErr.message : String(firstErr);
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(line, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
    } catch {
      try {
        return inspect(line, { depth: null, breakLength: Infinity });
      } catch {
        return `<unserializable object>: ${firstMsg}`;
      }
    }
  }
}

/** JSON lines for `@housef4/db` (no dependency on the API logger). */
export function dbLog(
  level: DbLogLevel,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line = {
    ...fields,
    level,
    msg,
    time: new Date().toISOString(),
    service: '@housef4/db',
  };
  const s = stringifyLogLine(line);
  if (level === 'error') {
    console.error(s);
  } else {
    console.log(s);
  }
}
