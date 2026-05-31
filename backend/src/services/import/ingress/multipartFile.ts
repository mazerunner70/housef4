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
  /** Raw `negate_amounts` field: `true`/`false`/`auto`/empty — see `parseNegateAmountsField` in import pipeline. */
  negateAmounts: string;
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

type MultipartFormSpec = {
  /** Form field name for the single accepted file part. */
  fileField: string;
  maxFileBytes: number;
  /** Text fields to collect; all other fields are ignored. */
  textFields?: readonly string[];
};

type ParsedMultipartForm = {
  fields: Record<string, string>;
  file: ExtractedUpload | null;
};

function getMultipartContentType(
  headers: Record<string, string | undefined>,
): string | null {
  const ct =
    headers['content-type'] ??
    headers['Content-Type'] ??
    headers['CONTENT-TYPE'];
  if (!ct?.toLowerCase().includes('multipart/form-data')) {
    return null;
  }
  return ct;
}

/** Discard a non-target file part so busboy can finish parsing the form. */
function drainFilePart(stream: NodeJS.ReadableStream): void {
  stream.on('limit', () => {
    stream.resume();
  });
  stream.resume();
}

/**
 * Buffer one accepted file part and reject when busboy truncates at `maxFileBytes`.
 */
function captureFilePart(
  stream: NodeJS.ReadableStream,
  info: { filename: string; mimeType?: string },
  fieldName: string,
  maxFileBytes: number,
  onComplete: (upload: ExtractedUpload) => void,
  onTooLarge: () => void,
): void {
  const chunks: Buffer[] = [];
  let truncated = false;

  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  stream.on('limit', () => {
    truncated = true;
    stream.resume();
  });
  stream.on('end', () => {
    const wasTruncated =
      truncated || Boolean((stream as { truncated?: boolean }).truncated);
    if (wasTruncated) {
      onTooLarge();
      return;
    }
    onComplete({
      filename: info.filename,
      buffer: Buffer.concat(chunks),
      mimeType: info.mimeType,
    });
  });
}

/**
 * Low-level `multipart/form-data` parse: one file field plus optional named text fields.
 * Returns `null` when the request is not multipart.
 */
async function parseMultipartForm(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
  spec: MultipartFormSpec,
): Promise<ParsedMultipartForm | null> {
  const contentType = getMultipartContentType(headers);
  if (!contentType) {
    return null;
  }

  const { fileField, maxFileBytes, textFields = [] } = spec;
  const trackedFields = new Set(textFields);

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: maxFileBytes },
    });

    const fields: Record<string, string> = {};
    let file: ExtractedUpload | null = null;
    let acceptedFileTooLarge = false;

    bb.on('field', (name, value) => {
      if (trackedFields.has(name)) {
        fields[name] = value;
      }
    });

    bb.on('file', (name, stream, info) => {
      if (name !== fileField) {
        drainFilePart(stream);
        return;
      }
      captureFilePart(
        stream,
        info,
        fileField,
        maxFileBytes,
        (upload) => {
          file = upload;
        },
        () => {
          acceptedFileTooLarge = true;
          reject(new MultipartFileTooLargeError(fileField, maxFileBytes));
        },
      );
    });

    bb.on('finish', () => {
      if (acceptedFileTooLarge) {
        return;
      }
      resolve({ fields, file });
    });
    bb.on('error', reject);
    Readable.from(bodyBuffer).pipe(bb);
  });
}

const IMPORT_TEXT_FIELDS = [
  'account_id',
  'new_account_name',
  'negate_amounts',
] as const;

function importFieldsFromForm(
  fields: Record<string, string>,
): ImportMultipartFields {
  return {
    accountId: fields.account_id ?? '',
    newAccountName: fields.new_account_name ?? '',
    negateAmounts: fields.negate_amounts ?? '',
  };
}

/**
 * Reads the `file` field and import account fields from `multipart/form-data`.
 */
export async function extractImportMultipart(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
  options?: MultipartExtractOptions,
): Promise<ExtractedImportUpload | null> {
  const parsed = await parseMultipartForm(headers, bodyBuffer, {
    fileField: 'file',
    maxFileBytes: options?.maxFileBytes ?? IMPORT_MULTIPART_MAX_FILE_BYTES,
    textFields: IMPORT_TEXT_FIELDS,
  });
  if (!parsed?.file) {
    return null;
  }
  return {
    file: parsed.file,
    ...importFieldsFromForm(parsed.fields),
  };
}

/**
 * `multipart/form-data` for `POST /api/backup/restore`: single part `backup` (JSON file body).
 */
export async function extractBackupMultipart(
  headers: Record<string, string | undefined>,
  bodyBuffer: Buffer,
  options?: MultipartExtractOptions,
): Promise<ExtractedUpload | null> {
  const parsed = await parseMultipartForm(headers, bodyBuffer, {
    fileField: 'backup',
    maxFileBytes: options?.maxFileBytes ?? BACKUP_MULTIPART_MAX_FILE_BYTES,
  });
  return parsed?.file ?? null;
}
