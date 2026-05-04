import busboy from 'busboy';
import { Readable } from 'node:stream';

export interface ExtractedUpload {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

/**
 * `multipart/form-data` for `POST /api/imports`: one part `file` plus optional
 * `account_id` (existing) or `new_account_name` (create before ingest).
 */
export type ImportMultipartFields = {
  accountId: string;
  newAccountName: string;
};

export type ExtractedImportUpload = {
  file: ExtractedUpload;
} & ImportMultipartFields;

/**
 * Reads the `file` field and import account fields from `multipart/form-data`.
 */
export async function extractImportMultipart(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
): Promise<ExtractedImportUpload | null> {
  const ct =
    headers['content-type'] ??
    headers['Content-Type'] ??
    headers['CONTENT-TYPE'];
  if (!ct?.toLowerCase().includes('multipart/form-data')) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': ct },
      limits: { files: 1, fileSize: 50 * 1024 * 1024 },
    });
    let fileFound: ExtractedUpload | null = null;
    let accountId = '';
    let newAccountName = '';

    bb.on('field', (name, val) => {
      if (name === 'account_id') accountId = val;
      if (name === 'new_account_name') newAccountName = val;
    });

    bb.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => {
        chunks.push(d);
      });
      file.on('limit', () => {
        file.resume();
      });
      file.on('end', () => {
        fileFound = {
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => {
      if (!fileFound) {
        resolve(null);
        return;
      }
      resolve({
        file: fileFound,
        accountId,
        newAccountName,
      });
    });
    bb.on('error', reject);
    Readable.from(bodyBuffer).pipe(bb);
  });
}

/**
 * `multipart/form-data` for `POST /api/backup/restore`: single part `backup` (JSON file body).
 */
export async function extractBackupMultipart(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
): Promise<ExtractedUpload | null> {
  const ct =
    headers['content-type'] ??
    headers['Content-Type'] ??
    headers['CONTENT-TYPE'];
  if (!ct?.toLowerCase().includes('multipart/form-data')) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': ct },
      limits: { files: 1, fileSize: 80 * 1024 * 1024 },
    });
    let fileFound: ExtractedUpload | null = null;

    bb.on('file', (name, file, info) => {
      if (name !== 'backup') {
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => {
        chunks.push(d);
      });
      file.on('limit', () => {
        file.resume();
      });
      file.on('end', () => {
        fileFound = {
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => {
      resolve(fileFound);
    });
    bb.on('error', reject);
    Readable.from(bodyBuffer).pipe(bb);
  });
}
