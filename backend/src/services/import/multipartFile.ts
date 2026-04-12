import busboy from 'busboy';
import { Readable } from 'node:stream';

export interface ExtractedUpload {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

/**
 * Reads the `file` field from `multipart/form-data` (API contract: single part named `file`).
 */
export async function extractMultipartFile(
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
      limits: { files: 1, fileSize: 50 * 1024 * 1024 },
    });
    let found: ExtractedUpload | null = null;

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
        found = {
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => resolve(found));
    bb.on('error', reject);
    Readable.from(bodyBuffer).pipe(bb);
  });
}
