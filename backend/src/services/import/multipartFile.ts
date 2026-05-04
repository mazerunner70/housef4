import busboy from 'busboy';
import { Readable } from 'node:stream';

/** Default max upload size for `POST /api/imports` `file` part (see `extractImportMultipart`). */
export const IMPORT_MULTIPART_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Default max upload size for `POST /api/backup/restore` `backup` part (see `extractBackupMultipart`). */
export const BACKUP_MULTIPART_MAX_FILE_BYTES = 80 * 1024 * 1024;

/**
 * Busboy hit `limits.fileSize` for the accepted file part — do not treat the buffer as complete data.
 */
export class MultipartFileTooLargeError extends Error {
  constructor(
    readonly fieldName: string,
    readonly maxBytes: number,
  ) {
    super(
      `Multipart part "${fieldName}" exceeds maximum size (${maxBytes} bytes)`,
    );
    this.name = 'MultipartFileTooLargeError';
  }
}

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

export type MultipartExtractOptions = {
  /**
   * Override `limits.fileSize` for the accepted file part (defaults: import 50 MiB, backup 80 MiB).
   * Intended for tests; production should omit.
   */
  maxFileBytes?: number;
};

/**
 * Reads the `file` field and import account fields from `multipart/form-data`.
 */
export async function extractImportMultipart(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
  options?: MultipartExtractOptions,
): Promise<ExtractedImportUpload | null> {
  const ct =
    headers['content-type'] ??
    headers['Content-Type'] ??
    headers['CONTENT-TYPE'];
  if (!ct?.toLowerCase().includes('multipart/form-data')) {
    return null;
  }

  const maxFileBytes = options?.maxFileBytes ?? IMPORT_MULTIPART_MAX_FILE_BYTES;

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': ct },
      limits: { files: 1, fileSize: maxFileBytes },
    });
    let fileFound: ExtractedUpload | null = null;
    let acceptedFileTruncated = false;
    let accountId = '';
    let newAccountName = '';

    bb.on('field', (name, val) => {
      if (name === 'account_id') accountId = val;
      if (name === 'new_account_name') newAccountName = val;
    });

    bb.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.on('limit', () => {
          file.resume();
        });
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => {
        chunks.push(d);
      });
      file.on('limit', () => {
        acceptedFileTruncated = true;
        file.resume();
      });
      file.on('end', () => {
        const truncated =
          acceptedFileTruncated ||
          Boolean((file as { truncated?: boolean }).truncated);
        if (truncated) {
          reject(new MultipartFileTooLargeError('file', maxFileBytes));
          return;
        }
        fileFound = {
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => {
      if (acceptedFileTruncated) {
        return;
      }
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
  options?: MultipartExtractOptions,
): Promise<ExtractedUpload | null> {
  const ct =
    headers['content-type'] ??
    headers['Content-Type'] ??
    headers['CONTENT-TYPE'];
  if (!ct?.toLowerCase().includes('multipart/form-data')) {
    return null;
  }

  const maxFileBytes = options?.maxFileBytes ?? BACKUP_MULTIPART_MAX_FILE_BYTES;

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': ct },
      limits: { files: 1, fileSize: maxFileBytes },
    });
    let fileFound: ExtractedUpload | null = null;
    let acceptedFileTruncated = false;

    bb.on('file', (name, file, info) => {
      if (name !== 'backup') {
        file.on('limit', () => {
          file.resume();
        });
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => {
        chunks.push(d);
      });
      file.on('limit', () => {
        acceptedFileTruncated = true;
        file.resume();
      });
      file.on('end', () => {
        const truncated =
          acceptedFileTruncated ||
          Boolean((file as { truncated?: boolean }).truncated);
        if (truncated) {
          reject(new MultipartFileTooLargeError('backup', maxFileBytes));
          return;
        }
        fileFound = {
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => {
      if (acceptedFileTruncated) {
        return;
      }
      resolve(fileFound);
    });
    bb.on('error', reject);
    Readable.from(bodyBuffer).pipe(bb);
  });
}
