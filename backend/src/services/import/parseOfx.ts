import { createLogger } from '../../logger';
import type { ParserOutputRow } from './canonical';

const log = createLogger({ component: 'import.parseOfx' });

function getTag(block: string, tag: string): string | undefined {
  const re = new RegExp(String.raw`<${tag}>([^<\r\n]*)`, 'i');
  const m = re.exec(block);
  return m?.[1]?.trim();
}

/** Parse OFX / QFX SGML-style `STMTTRN` blocks. */
export function parseOfxLike(content: string): ParserOutputRow[] {
  const rows: ParserOutputRow[] = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const block = m[1] ?? '';
    const amtStr = getTag(block, 'TRNAMT');
    if (amtStr === undefined) continue;
    const amount = Number(amtStr);
    if (Number.isNaN(amount)) continue;

    const dtRaw =
      getTag(block, 'DTPOSTED') ??
      getTag(block, 'DTUSER') ??
      getTag(block, 'DTAVAIL');
    if (!dtRaw) continue;
    const date = ofxDateToUtcMs(dtRaw);
    if (date === null) {
      log.warn('ofx import: rejected STMTTRN — unparseable date', {
        dateString: dtRaw,
      });
      continue;
    }

    const name = getTag(block, 'NAME');
    const memo = getTag(block, 'MEMO');
    const raw_merchant = (name || memo || 'Unknown').trim();
    if (!raw_merchant) continue;

    rows.push({ date, amount, raw_merchant });
  }
  return rows;
}

/**
 * OFX / QFX often includes `<CURDEF>USD</CURDEF>` (account default) or per-row `<CURRENCY>…`.
 * Returns a 3-letter code when a single unambiguous value is found.
 */
export function extractOfxDefaultCurrency(content: string): string | undefined {
  const curdefRe = /<CURDEF>([A-Z]{3})</i;
  const fromCurdef = curdefRe.exec(content);
  if (fromCurdef?.[1]) return fromCurdef[1].toUpperCase();
  const curRe = /<CURRENCY>([A-Z]{3})</i;
  const fromCur = curRe.exec(content);
  if (fromCur?.[1]) return fromCur[1].toUpperCase();
  return undefined;
}

function ofxDateToUtcMs(s: string): number | null {
  const t = s.trim();
  if (t.length < 8) return null;
  const y = Number.parseInt(t.slice(0, 4), 10);
  const mo = Number.parseInt(t.slice(4, 6), 10) - 1;
  const d = Number.parseInt(t.slice(6, 8), 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  if (t.length >= 14) {
    const hh = Number.parseInt(t.slice(8, 10), 10);
    const mm = Number.parseInt(t.slice(10, 12), 10);
    const ss = Number.parseInt(t.slice(12, 14), 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) return null;
    const ms = Date.UTC(y, mo, d, hh, mm, ss);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.UTC(y, mo, d);
  return Number.isNaN(ms) ? null : ms;
}
