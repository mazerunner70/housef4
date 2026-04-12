import type { ImportSourceFormatKey } from './canonical';

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/**
 * Detect import format from filename, `Content-Type`, and first bytes (sniff).
 */
export function detectImportFormat(
  filename: string | undefined,
  mimeType: string | undefined,
  buf: Buffer,
): ImportSourceFormatKey | 'unknown' {
  const head = buf.subarray(0, Math.min(buf.length, 8192)).toString('latin1');
  const name = (filename ?? '').toLowerCase();
  const mt = (mimeType ?? '').toLowerCase();

  if (/OFXHEADER|\<OFX\>/i.test(head)) {
    return name.endsWith('.qfx') || mt.includes('qfx') ? 'qfx' : 'ofx';
  }
  if (/^\s*!Type:/im.test(head) || (/^\s*\^/m.test(head) && /(^|\n)D[\d/.]/m.test(head))) {
    return 'qif';
  }

  const ext = extOf(filename ?? '');
  if (ext === '.csv' || mt.includes('csv')) {
    return 'csv';
  }
  if (ext === '.ofx' || (mt.includes('ofx') && !mt.includes('qfx'))) {
    return 'ofx';
  }
  if (ext === '.qfx' || mt.includes('qfx')) {
    return 'qfx';
  }
  if (ext === '.qif' || mt.includes('qif')) {
    return 'qif';
  }
  if (mt === 'text/plain' && (head.includes(',') || head.includes(';'))) {
    return 'csv';
  }

  return 'unknown';
}
