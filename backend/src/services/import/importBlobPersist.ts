/**
 * Raw upload blob Put + `TRANSACTION_FILE` record with orphan policy (§8).
 * See `import_file_blob_storage.md`.
 */

import type { FinanceRepository, ImportBlobRef, TransactionFileInput } from '@housef4/db';

import { emitImportBlobWriteFailedMetric } from '../../observability/importBlobMetrics';
import { getLog } from '../../requestLogContext';
import { loadImportBlobConfig } from './importBlobConfig';
import type { ImportBlobStore } from './importBlobTypes';
import type { ExtractedImportUpload } from './multipartFile';

export type AttachImportBlobAndRecordFileParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  store: ImportBlobStore | null;
  extracted: ExtractedImportUpload;
  contentSha256: string;
  importFileId: string;
  accountId: string;
  transactionFileInput: TransactionFileInput;
}>;

async function tryPutImportBlob(
  store: ImportBlobStore,
  params: AttachImportBlobAndRecordFileParams,
): Promise<ImportBlobRef | undefined> {
  const { extracted, userId, importFileId, accountId, contentSha256 } = params;
  const displayName = extracted.file.filename?.trim() || 'import';
  const result = await store.put({
    userId,
    importFileId,
    accountId,
    originalName: displayName,
    contentType: extracted.file.mimeType,
    contentSha256,
    body: extracted.file.buffer,
  });
  const ref = result.ref;
  if (ref.stored_bytes !== extracted.file.buffer.length) {
    await store.delete(ref).catch(() => undefined);
    throw new Error('import blob stored_bytes mismatch');
  }
  return ref;
}

async function recordTransactionFileOnce(
  repo: FinanceRepository,
  userId: string,
  input: TransactionFileInput,
): Promise<void> {
  await repo.recordTransactionFile(userId, input);
}

/**
 * After ingest/staging promote: optional blob Put (non-fatal on failure), then
 * `recordTransactionFile`. On Dynamo failure after a successful blob Put, delete
 * the object and retry metadata-only once.
 */
export async function attachImportBlobAndRecordFile(
  params: AttachImportBlobAndRecordFileParams,
): Promise<void> {
  const { userId, repo, store, transactionFileInput } = params;
  const log = getLog();
  let blobRef: ImportBlobRef | undefined;

  if (store) {
    try {
      blobRef = await tryPutImportBlob(store, params);
    } catch (e) {
      const config = loadImportBlobConfig();
      const backend = config.backend;
      log.warn('import.blob_write_failed', {
        importFileId: params.importFileId,
        userId,
        backend,
        errorName: e instanceof Error ? e.name : 'Error',
        ...(e instanceof Error && e.message ? { message: e.message } : {}),
      });
      await emitImportBlobWriteFailedMetric({
        importFileId: params.importFileId,
        backend,
      });
    }
  }

  const withBlob: TransactionFileInput = blobRef
    ? { ...transactionFileInput, blob: blobRef }
    : transactionFileInput;

  try {
    await recordTransactionFileOnce(repo, userId, withBlob);
    return;
  } catch (firstErr) {
    if (!blobRef || !store) throw firstErr;

    await store.delete(blobRef).catch((deleteErr) => {
      log.warn('import.blob_compensating_delete_failed', {
        importFileId: params.importFileId,
        userId,
        errorName: deleteErr instanceof Error ? deleteErr.name : 'Error',
      });
    });

    try {
      await recordTransactionFileOnce(repo, userId, transactionFileInput);
    } catch (retryErr) {
      throw retryErr;
    }
  }
}
