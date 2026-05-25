import { parse } from 'csv-parse/sync';

import { createLogger } from '../../../logger';
import { compact, flow, map } from '../utils/lodashImport';
import type { ParserOutputRow } from './canonical';

const log = createLogger({ component: 'import.parseCsv' });

function normHeader(h: string): string {
  return h.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function scoreDateHeader(h: string): number {
  const n = normHeader(h);
  if (/\bdate\b/.test(n)) return 10;
  if (n.includes('posted') || n.includes('transaction date')) return 8;
  if (n.includes('time')) return 3;
  return 0;
}

function scoreAmountHeader(h: string): number {
  const n = normHeader(h);
  if (/\bamount\b/.test(n)) return 10;
  if (n.includes('value')) return 5;
  if (/\b(debit|credit)\b/.test(n)) return 8;
  return 0;
}

function scoreDescHeader(h: string): number {
  const n = normHeader(h);
  if (/\b(description|details|memo|narrative)\b/.test(n)) return 10;
  if (/\b(payee|merchant|name|counter)\b/.test(n)) return 9;
  return 0;
}

function pickColumns(headers: string[]): {
  dateIdx: number;
  amountIdx: number;
  descIdx: number;
  debitIdx?: number;
  creditIdx?: number;
} | null {
  let bestDate = -1;
  let bestDateScore = 0;
  let bestAmt = -1;
  let bestAmtScore = 0;
  let bestDesc = -1;
  let bestDescScore = 0;
  let debitIdx: number | undefined;
  let creditIdx: number | undefined;

  headers.forEach((h, i) => {
    const ds = scoreDateHeader(h);
    if (ds > bestDateScore) {
      bestDateScore = ds;
      bestDate = i;
    }
    const as = scoreAmountHeader(h);
    if (as > bestAmtScore) {
      bestAmtScore = as;
      bestAmt = i;
    }
    const bs = scoreDescHeader(h);
    if (bs > bestDescScore) {
      bestDescScore = bs;
      bestDesc = i;
    }
    const n = normHeader(h);
    if (/\bdebit\b/.test(n)) debitIdx = i;
    if (/\bcredit\b/.test(n)) creditIdx = i;
  });

  if (bestDate < 0 || bestDesc < 0) return null;
  if (bestAmt < 0 && (debitIdx === undefined || creditIdx === undefined)) {
    return null;
  }
  return {
    dateIdx: bestDate,
    amountIdx: bestAmt,
    descIdx: bestDesc,
    debitIdx,
    creditIdx,
  };
}

function parseDateCell(s: string): number | null {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) {
    return Date.UTC(
      Number.parseInt(iso[1] ?? '0', 10),
      Number.parseInt(iso[2] ?? '0', 10) - 1,
      Number.parseInt(iso[3] ?? '0', 10),
    );
  }
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (mdy) {
    let mm = Number.parseInt(mdy[1] ?? '0', 10);
    let dd = Number.parseInt(mdy[2] ?? '0', 10);
    let yy = Number.parseInt(mdy[3] ?? '0', 10);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    return Date.UTC(yy, mm - 1, dd);
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

function parseMoney(s: string): number | undefined {
  const t = s.replaceAll(/[£$€,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

function resolveCsvRowAmount(
  vals: string[],
  cols: NonNullable<ReturnType<typeof pickColumns>>,
): number | undefined {
  let amount: number | undefined;
  if (cols.amountIdx >= 0 && vals[cols.amountIdx]) {
    amount = parseMoney(vals[cols.amountIdx]);
  }
  if (
    amount === undefined &&
    cols.debitIdx !== undefined &&
    cols.creditIdx !== undefined
  ) {
    const debit = parseMoney(vals[cols.debitIdx] ?? '');
    const credit = parseMoney(vals[cols.creditIdx] ?? '');
    if (debit === undefined && credit === undefined) {
      return undefined;
    }
    amount = (credit ?? 0) - (debit ?? 0);
  }
  if (amount === undefined || Number.isNaN(amount)) return undefined;
  return amount;
}

type CsvColumnLayout = NonNullable<ReturnType<typeof pickColumns>>;

function parseCsvRecords(text: string): Record<string, string>[] {
  const bomStripped =
    text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return parse(bomStripped, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];
  } catch {
    return [];
  }
}

export function parseCsvRecord(
  rec: Record<string, string>,
  headers: string[],
  cols: CsvColumnLayout,
): ParserOutputRow | null {
  const vals = headers.map((h) => rec[h] ?? '');
  const raw_merchant = (vals[cols.descIdx] ?? '').trim();
  if (!raw_merchant) return null;

  const amount = resolveCsvRowAmount(vals, cols);
  if (amount === undefined) return null;

  const dateRaw = vals[cols.dateIdx] ?? '';
  const date = parseDateCell(dateRaw);
  if (date === null) {
    log.warn('csv import: rejected row — unparseable date cell', {
      dateString: dateRaw,
    });
    return null;
  }
  return { date, amount, raw_merchant };
}

const mapCsvRecords = (
  records: Record<string, string>[],
  headers: string[],
  cols: CsvColumnLayout,
): Array<ParserOutputRow | null> =>
  map(records, (rec) => parseCsvRecord(rec, headers, cols));

export function parseBankCsv(text: string): ParserOutputRow[] {
  const records = parseCsvRecords(text);
  if (records.length === 0) return [];

  const first = records[0];
  if (!first) return [];
  const headers = Object.keys(first);
  const cols = pickColumns(headers);
  if (!cols) return [];

  return flow(
    (recs: Record<string, string>[]) => mapCsvRecords(recs, headers, cols),
    compact,
  )(records);
}
