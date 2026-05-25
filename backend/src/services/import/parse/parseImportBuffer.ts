import { find } from '../utils/lodashImport';
import type { ImportSourceFormatKey, ParsedImportRow } from './canonical';
import { withCanonicalAmount } from './canonical';
import { detectImportFormat } from './detectFormat';
import { parseBankCsv } from './parseCsv';
import { extractOfxDefaultCurrency, parseOfxLike } from './parseOfx';
import { parseQif } from './parseQif';

type ParseImportResult = {
  rows: ParsedImportRow[];
  format: ImportSourceFormatKey | 'unknown';
  /** When detectable (e.g. OFX `CURDEF`), ISO 4217 code for the import batch. */
  currency?: string;
};

type ParseStrategy = {
  format: ImportSourceFormatKey;
  parse: () => ParsedImportRow[];
  currency?: string;
};

function firstNonemptyParse(strategies: ParseStrategy[]): ParseImportResult {
  let matched: ParseStrategy | undefined;
  let rows: ParsedImportRow[] = [];

  find(strategies, (strategy) => {
    const parsed = strategy.parse();
    if (parsed.length > 0) {
      matched = strategy;
      rows = parsed;
      return true;
    }
    return false;
  });

  if (!matched) {
    return { rows: [], format: 'unknown' };
  }

  return {
    rows,
    format: matched.format,
    ...(matched.currency !== undefined && { currency: matched.currency }),
  };
}

export function parseImportBuffer(
  buf: Buffer,
  filename: string | undefined,
  mimeType: string | undefined,
): ParseImportResult {
  const detected = detectImportFormat(filename, mimeType, buf);
  const text = buf.toString('utf8');

  const tryCsv = (): ParsedImportRow[] =>
    withCanonicalAmount(parseBankCsv(text));
  const tryOfx = (): ParsedImportRow[] =>
    withCanonicalAmount(parseOfxLike(text));
  const tryQif = (): ParsedImportRow[] =>
    withCanonicalAmount(parseQif(text));

  if (detected === 'ofx' || detected === 'qfx') {
    return {
      rows: tryOfx(),
      format: detected,
      currency: extractOfxDefaultCurrency(text),
    };
  }
  if (detected === 'qif') {
    return { rows: tryQif(), format: 'qif' };
  }
  if (detected === 'csv') {
    return { rows: tryCsv(), format: 'csv' };
  }

  return firstNonemptyParse([
    { format: 'csv', parse: tryCsv },
    {
      format: 'ofx',
      parse: tryOfx,
      currency: extractOfxDefaultCurrency(text),
    },
    { format: 'qif', parse: tryQif },
  ]);
}
