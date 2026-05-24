import { basename } from 'node:path';

const MAX_FILENAME_LEN = 120;

/** Deterministic object key: `imports/<user_id>/<import_file_id>/<safe_name>`. */
export function buildImportBlobObjectKey(
  userId: string,
  importFileId: string,
  originalName: string,
): string {
  const safe = sanitizeImportBlobFilename(originalName);
  return `imports/${userId}/${importFileId}/${safe}`;
}

/** Basename only; strip traversal/control chars; cap length. */
export function sanitizeImportBlobFilename(originalName: string): string {
  let name = basename(String(originalName ?? '').trim());
  name = name.replace(/[\0-\x1f\x7f]/g, '').replace(/\.\./g, '');
  if (!name || name === '.' || name === '..') {
    return 'upload.bin';
  }
  if (name.length > MAX_FILENAME_LEN) {
    const extMatch = /\.([^.]+)$/.exec(name);
    const ext = extMatch ? extMatch[0] : '';
    const baseMax = MAX_FILENAME_LEN - ext.length;
    name = name.slice(0, Math.max(1, baseMax)) + ext;
  }
  return name;
}
