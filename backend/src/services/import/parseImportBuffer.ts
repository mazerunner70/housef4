import type { ImportSourceFormatKey, ParsedImportRow } from './canonical';
import { detectImportFormat } from './detectFormat';
import { parseBankCsv } from './parseCsv';
import { extractOfxDefaultCurrency, parseOfxLike } from './parseOfx';
import { parseQif } from './parseQif';

export function parseImportBuffer(
  buf: Buffer,
  filename: string | undefined,
  mimeType: string | undefined,
): {
  rows: ParsedImportRow[];
  format: ImportSourceFormatKey | 'unknown';
  /** When detectable (e.g. OFX `CURDEF`), ISO 4217 code for the import batch. */
  currency?: string;
} {
  const detected = detectImportFormat(filename, mimeType, buf);
  const text = buf.toString('utf8');

  const tryCsv = (): ParsedImportRow[] => parseBankCsv(text);
  const tryOfx = (): ParsedImportRow[] => parseOfxLike(text);
  const tryQif = (): ParsedImportRow[] => parseQif(text);

  if (detected === 'ofx') {
    return {
      rows: tryOfx(),
      format: 'ofx',
      currency: extractOfxDefaultCurrency(text),
    };
  }
  if (detected === 'qfx') {
    return {
      rows: tryOfx(),
      format: 'qfx',
      currency: extractOfxDefaultCurrency(text),
    };
  }
  if (detected === 'qif') {
    return { rows: tryQif(), format: 'qif' };
  }
  if (detected === 'csv') {
    return { rows: tryCsv(), format: 'csv' };
  }

  const csv = tryCsv();
  if (csv.length > 0) {
    return { rows: csv, format: 'csv' };
  }
  const ofx = tryOfx();
  if (ofx.length > 0) {
    return {
      rows: ofx,
      format: 'ofx',
      currency: extractOfxDefaultCurrency(text),
    };
  }
  const qif = tryQif();
  if (qif.length > 0) {
    return { rows: qif, format: 'qif' };
  }
  return { rows: [], format: 'unknown' };
}
