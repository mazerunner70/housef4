import type { ParsedImportRow } from './canonical';

/** Parse QIF transaction records (line tags; records often end with `^`). */
export function parseQif(content: string): ParsedImportRow[] {
  const rows: ParsedImportRow[] = [];
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
    const amount = Number(String(amountStr).replace(/^\+/, ''));
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
    const tag = t[0]!.toUpperCase();
    const rest = t.slice(1).trim();
    if (tag === 'D') dateStr = rest;
    else if (tag === 'T') amountStr = rest;
    else if (tag === 'P') payee = rest;
    else if (tag === 'M') memo = rest;
  }
  flush();
  return rows;
}

function qifDateToUtcMs(s: string): number {
  const t = s.trim();
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})[/'](\d{2,4})$/);
  if (mdy) {
    let mm = parseInt(mdy[1]!, 10);
    let dd = parseInt(mdy[2]!, 10);
    let yy = parseInt(mdy[3]!, 10);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    return Date.UTC(yy, mm - 1, dd);
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return Date.UTC(
      parseInt(iso[1]!, 10),
      parseInt(iso[2]!, 10) - 1,
      parseInt(iso[3]!, 10),
    );
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? Date.now() : d;
}
