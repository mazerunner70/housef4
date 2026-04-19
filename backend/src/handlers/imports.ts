import { getFinanceRepository } from '@housef4/db';

import { HttpError } from '../httpError';
import { enrichImportRows } from '../services/import/enrichImportRows';
import { extractMultipartFile } from '../services/import/multipartFile';
import { parseImportBuffer } from '../services/import/parseImportBuffer';
import { getLog } from '../requestLogContext';
import type { InternalRequest } from '../types';

export async function postImportPayload(
  userId: string,
  req: InternalRequest,
): Promise<Record<string, unknown>> {
  const log = getLog();
  const buf = req.bodyBuffer;
  if (!buf?.length) {
    throw new HttpError(400, 'Request body is empty');
  }

  const extracted = await extractMultipartFile(req.headers, buf);
  if (!extracted?.buffer.length) {
    throw new HttpError(
      400,
      'Expected multipart/form-data with a non-empty part named "file"',
    );
  }

  const { rows, format } = parseImportBuffer(
    extracted.buffer,
    extracted.filename,
    extracted.mimeType,
  );

  const repo = getFinanceRepository();
  const enriched = await enrichImportRows(userId, rows, repo);
  await repo.patchExistingTransactionsAfterImport(
    userId,
    enriched.existingPatches,
  );
  const result = await repo.ingestImportBatch(userId, enriched.toInsert);

  log.info('import.complete', {
    rowCount: result.rowCount,
    format,
    fileBytes: extracted.buffer.length,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
  });

  const base: Record<string, unknown> = {
    rowCount: result.rowCount,
    knownMerchants: result.knownMerchants,
    unknownMerchants: result.unknownMerchants,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
    transactionIds: enriched.toInsert.map((r) => r.id),
  };
  if (format !== 'unknown') {
    base.sourceFormat = format;
  }
  return base;
}
