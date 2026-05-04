import { randomUUID } from 'node:crypto';

import { getFinanceRepository } from '@housef4/db';

import { HttpError } from '../httpError';
import { enrichImportRows } from '../services/import/enrichImportRows';
import {
  extractImportMultipart,
  MultipartFileTooLargeError,
} from '../services/import/multipartFile';
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

  let extracted;
  try {
    extracted = await extractImportMultipart(req.headers, buf);
  } catch (e) {
    if (e instanceof MultipartFileTooLargeError) {
      throw new HttpError(413, e.message, {
        error: 'Import file exceeds maximum size',
        max_bytes: e.maxBytes,
        field: e.fieldName,
      });
    }
    throw e;
  }
  if (!extracted?.file.buffer.length) {
    throw new HttpError(
      400,
      'Expected multipart/form-data with a non-empty part named "file"',
    );
  }

  const repo = getFinanceRepository();
  const newName = extracted.newAccountName.trim();
  const existingId = extracted.accountId.trim();
  let accountId: string;
  if (newName.length > 0) {
    const created = await repo.createAccount(userId, newName);
    accountId = created.id;
  } else if (existingId.length > 0) {
    const acc = await repo.getAccount(userId, existingId);
    if (!acc) {
      throw new HttpError(400, 'Unknown account_id');
    }
    accountId = acc.id;
  } else {
    throw new HttpError(
      400,
      'Provide new_account_name or a valid account_id for this import',
    );
  }

  const importStartedAt = Date.now();
  const {
    rows,
    format: detectedFormat,
    currency: importCurrency,
  } = parseImportBuffer(
    extracted.file.buffer,
    extracted.file.filename,
    extracted.file.mimeType,
  );

  const importFileId = randomUUID();
  const enriched = await enrichImportRows(userId, rows, repo);
  await repo.patchExistingTransactionsAfterImport(
    userId,
    enriched.existingPatches,
  );
  const result = await repo.ingestImportBatch(
    userId,
    enriched.toInsert,
    importFileId,
    importCurrency,
  );
  await repo.retireClusterAggregates(userId, enriched.retiredClusterIds);

  const displayName = extracted.file.filename?.trim() || 'import';
  const importCompletedAt = Date.now();
  const ingest = {
    ...result,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
  };
  await repo.recordTransactionFile(userId, {
    id: importFileId,
    account_id: accountId,
    source: {
      name: displayName,
      size_bytes: extracted.file.buffer.length,
      ...(extracted.file.mimeType && { content_type: extracted.file.mimeType }),
    },
    format: {
      ...(detectedFormat === 'unknown' ? {} : { source_format: detectedFormat }),
      ...(importCurrency && { currency: importCurrency }),
    },
    timing: {
      started_at: importStartedAt,
      completed_at: importCompletedAt,
    },
    result: ingest,
  });

  log.info('import.complete', {
    rowCount: result.rowCount,
    format: detectedFormat,
    fileBytes: extracted.file.buffer.length,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
    retiredClusterCount: enriched.retiredClusterIds.length,
  });

  await repo.refreshStoredDashboardMetrics(userId);

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
