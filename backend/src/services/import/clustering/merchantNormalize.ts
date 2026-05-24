/**
 * TypeScript port of `clean_merchant_name` + `remove_dd_mmm_dates` from
 * `ml-training/notebooks/experimentation.ipynb` (same regex semantics).
 */

function collapseWhitespace(s: string): string {
  return s.trim().split(/\s+/).join(' ');
}

/** Step 1: uppercase, strip noise, normalize tokens (notebook `clean_merchant_name`). */
export function cleanMerchantName(name: string): string {
  if (typeof name !== 'string' || !name) return '';

  let s = name.toUpperCase();

  s = s.replace(/&(?:AMP;)?/g, ' AND ');

  s = s.replace(/[*#]\s?(?=[A-Za-z]*\d)[A-Z0-9]+/g, ' ');

  s = s.replace(/\d{2}\/\d{2}/g, ' ');

  s = s.replace(/\b(?:APPLEPAY|GB|UK)\b/g, ' ');

  s = s.replace(/\bI?ZETTLE[_*]*/g, ' ');

  s = s.replace(/\bPAYPAL\s*[*_]*/g, ' ');

  s = s.replace(/\b(?:APPLEPAY|SUMUP|SQUARE|GB|UK)\b/g, ' ');

  s = s.replace(/\b\d{3,}\b/g, ' ');

  s = s.replace(/\b(?=[A-Za-z]*\d)[A-Za-z0-9]{8,}\b/g, ' ');

  s = s.replace(/\b[A-Z0-9]*\d[A-Z0-9]*-[A-Z0-9]+\b/g, ' ');

  s = s.replace(/\b(?:LTD|LIMITED|INC|CORP|LLC|PLC)\b/g, ' ');

  s = s.replace(/\b(?:WWW\.|\.COM|\.CO\.UK)\b/g, ' ');

  s = s.replace(/\bPYMT\b/g, 'PAYMENT');
  s = s.replace(/\bS\/MKTS\b/g, 'SUPERMARKET');
  s = s.replace(/\bTXN\b/g, 'TRANSACTION');

  return collapseWhitespace(s);
}

/** Step 2: drop UK-style date fragments and bank suffix codes (`remove_dd_mmm_dates`). */
export function removeDdMmmDates(name: string): string {
  if (typeof name !== 'string' || !name) return '';

  let s = name;
  s = s.replace(
    /\b(?:ON\s+)?\d{1,2}\s(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/g,
    '',
  );
  s = s.replace(
    /\b(?:BCC|CLP|CPM|DDR|DD|FT|BC|CL|CP|DC|SST|UNP|ASD)\b/g,
    '',
  );

  return collapseWhitespace(s);
}

/** Full notebook pipeline: clean then strip dates / bank codes. */
export function cleanMerchantForClustering(raw: string): string {
  return removeDdMmmDates(cleanMerchantName(raw));
}
