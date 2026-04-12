import type { ParsedImportRow } from './canonical';

function getTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  return m?.[1]?.trim();
}

/** Parse OFX / QFX SGML-style `STMTTRN` blocks. */
export function parseOfxLike(content: string): ParsedImportRow[] {
  const rows: ParsedImportRow[] = [];
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

    const name = getTag(block, 'NAME');
    const memo = getTag(block, 'MEMO');
    const raw_merchant = (name || memo || 'Unknown').trim();
    if (!raw_merchant) continue;

    rows.push({ date, amount, raw_merchant });
  }
  return rows;
}

function ofxDateToUtcMs(s: string): number {
  const t = s.trim();
  const y = parseInt(t.slice(0, 4), 10);
  const mo = parseInt(t.slice(4, 6), 10) - 1;
  const d = parseInt(t.slice(6, 8), 10);
  if (t.length >= 14) {
    const hh = parseInt(t.slice(8, 10), 10);
    const mm = parseInt(t.slice(10, 12), 10);
    const ss = parseInt(t.slice(12, 14), 10);
    return Date.UTC(y, mo, d, hh, mm, ss);
  }
  return Date.UTC(y, mo, d);
}
