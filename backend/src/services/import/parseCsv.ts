import { parse } from 'csv-parse/sync';

import { createLogger } from '../../logger';
import type { ParsedImportRow } from './canonical';

const log = createLogger({ component: 'import.parseCsv' });

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
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
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return Date.UTC(
      parseInt(iso[1]!, 10),
      parseInt(iso[2]!, 10) - 1,
      parseInt(iso[3]!, 10),
    );
  }
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) {
    let mm = parseInt(mdy[1]!, 10);
    let dd = parseInt(mdy[2]!, 10);
    let yy = parseInt(mdy[3]!, 10);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    return Date.UTC(yy, mm - 1, dd);
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

function parseMoney(s: string): number | undefined {
  const t = s.replace(/[£$€,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

export function parseBankCsv(text: string): ParsedImportRow[] {
  const bomStripped =
    text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let records: Record<string, string>[];
  try {
    records = parse(bomStripped, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];
  } catch {
    return [];
  }
  if (records.length === 0) return [];

  const headers = Object.keys(records[0]!);
  const cols = pickColumns(headers);
  if (!cols) return [];

  const rows: ParsedImportRow[] = [];
  for (const rec of records) {
    const vals = headers.map((h) => rec[h] ?? '');
    const raw_merchant = (vals[cols.descIdx] ?? '').trim();
    if (!raw_merchant) continue;

    let amount: number | undefined;
    if (cols.amountIdx >= 0 && vals[cols.amountIdx]) {
      amount = parseMoney(vals[cols.amountIdx]!);
    }
    if (amount === undefined && cols.debitIdx !== undefined && cols.creditIdx !== undefined) {
      const debit = parseMoney(vals[cols.debitIdx] ?? '') ?? 0;
      const credit = parseMoney(vals[cols.creditIdx] ?? '') ?? 0;
      amount = credit - debit;
    }
    if (amount === undefined || Number.isNaN(amount)) continue;

    const dateRaw = vals[cols.dateIdx] ?? '';
    const date = parseDateCell(dateRaw);
    if (date === null) {
      log.warn('csv import: rejected row — unparseable date cell', {
        dateString: dateRaw,
      });
      continue;
    }
    rows.push({ date, amount, raw_merchant });
  }
  return rows;
}
