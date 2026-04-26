import { randomUUID } from 'node:crypto';

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

  const importStartedAt = Date.now();
  const { rows, format: detectedFormat } = parseImportBuffer(
    extracted.buffer,
    extracted.filename,
    extracted.mimeType,
  );

  const importFileId = randomUUID();
  const repo = getFinanceRepository();
  const enriched = await enrichImportRows(userId, rows, repo);
  await repo.patchExistingTransactionsAfterImport(
    userId,
    enriched.existingPatches,
  );
  const result = await repo.ingestImportBatch(
    userId,
    enriched.toInsert,
    importFileId,
  );
  await repo.retireClusterAggregates(userId, enriched.retiredClusterIds);

  const displayName = extracted.filename?.trim() || 'import';
  const importCompletedAt = Date.now();
  const ingest = {
    ...result,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
  };
  await repo.recordTransactionFile(userId, {
    id: importFileId,
    source: {
      name: displayName,
      size_bytes: extracted.buffer.length,
      ...(extracted.mimeType && { content_type: extracted.mimeType }),
    },
    format:
      detectedFormat !== 'unknown' ? { source_format: detectedFormat } : {},
    timing: {
      started_at: importStartedAt,
      completed_at: importCompletedAt,
    },
    result: ingest,
  });

  log.info('import.complete', {
    rowCount: result.rowCount,
    format: detectedFormat,
    fileBytes: extracted.buffer.length,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
    retiredClusterCount: enriched.retiredClusterIds.length,
  });

  const base: Record<string, unknown> = {
    rowCount: result.rowCount,
    knownMerchants: result.knownMerchants,
    unknownMerchants: result.unknownMerchants,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
    importFileId,
  };
  if (detectedFormat !== 'unknown') {
    base.sourceFormat = detectedFormat;
  }
  return base;
}
