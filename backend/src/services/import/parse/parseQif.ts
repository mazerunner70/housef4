import { createLogger } from '../../../logger';
import type { ParserOutputRow } from './canonical';

const log = createLogger({ component: 'import.parseQif' });

/** Parse QIF transaction records (line tags; records often end with `^`). */
export function parseQif(content: string): ParserOutputRow[] {
  const rows: ParserOutputRow[] = [];
  let dateStr: string | undefined;
  let amountStr: string | undefined;
  let payee: string | undefined;
  let memo: string | undefined;

  const flush = () => {
    if (!dateStr || amountStr === undefined) {
      dateStr = undefined;
      amountStr = undefined;
      payee = undefined;
      memo = undefined;
      return;
    }
    const date = qifDateToUtcMs(dateStr);
    if (date === null) {
      log.warn('qif import: rejected record — unparseable date', {
        dateString: dateStr,
      });
      dateStr = undefined;
      amountStr = undefined;
      payee = undefined;
      memo = undefined;
      return;
    }
    const sAmt = String(amountStr);
    const amount = Number(sAmt.startsWith('+') ? sAmt.slice(1) : sAmt);
    if (Number.isNaN(amount)) {
      dateStr = undefined;
      amountStr = undefined;
      payee = undefined;
      memo = undefined;
      return;
    }
    const raw_merchant = (payee || memo || 'Unknown').trim();
    if (raw_merchant) {
      rows.push({ date, amount, raw_merchant });
    }
    dateStr = undefined;
    amountStr = undefined;
    payee = undefined;
    memo = undefined;
  };

  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '^') {
      flush();
      continue;
    }
    if (t.length < 2) continue;
    const tag = t.charAt(0).toUpperCase();
    const rest = t.slice(1).trim();
    if (tag === 'D') dateStr = rest;
    else if (tag === 'T') amountStr = rest;
    else if (tag === 'P') payee = rest;
    else if (tag === 'M') memo = rest;
  }
  flush();
  return rows;
}

function qifDateToUtcMs(s: string): number | null {
  const t = s.trim();
  const mdy = /^(\d{1,2})\/(\d{1,2})[/'](\d{2,4})$/.exec(t);
  if (mdy) {
    let mm = Number.parseInt(mdy[1] ?? '0', 10);
    let dd = Number.parseInt(mdy[2] ?? '0', 10);
    let yy = Number.parseInt(mdy[3] ?? '0', 10);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    return Date.UTC(yy, mm - 1, dd);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) {
    return Date.UTC(
      Number.parseInt(iso[1] ?? '0', 10),
      Number.parseInt(iso[2] ?? '0', 10) - 1,
      Number.parseInt(iso[3] ?? '0', 10),
    );
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}
