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

export type ImportBlobPutContext = Readonly<{
  userId: string;
  store: ImportBlobStore | null;
  extracted: ExtractedImportUpload;
  contentSha256: string;
  importFileId: string;
  accountId: string;
}>;

export type AttachImportBlobAndRecordFileParams = ImportBlobPutContext &
  Readonly<{
    repo: FinanceRepository;
    transactionFileInput: TransactionFileInput;
  }>;

export type AttachImportBlobViaPatchParams = ImportBlobPutContext &
  Readonly<{
    repo: FinanceRepository;
  }>;

async function tryPutImportBlob(
  store: ImportBlobStore,
  params: ImportBlobPutContext,
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

/** Blob Put when storage is enabled; non-fatal on failure (§8 V1). */
export async function putImportBlobIfEnabled(
  params: ImportBlobPutContext,
): Promise<ImportBlobRef | undefined> {
  const { store, userId, importFileId } = params;
  if (!store) return undefined;

  const log = getLog();
  try {
    return await tryPutImportBlob(store, params);
  } catch (e) {
    const config = loadImportBlobConfig();
    const backend = config.backend;
    log.warn('import.blob_write_failed', {
      importFileId,
      userId,
      backend,
      errorName: e instanceof Error ? e.name : 'Error',
      ...(e instanceof Error && e.message ? { message: e.message } : {}),
    });
    await emitImportBlobWriteFailedMetric({ importFileId, backend });
    return undefined;
  }
}

/**
 * Staging path (§8.7): patch `TRANSACTION_FILE.blob` while `IMPORT_LOCK` is still held.
 * Row already exists from promote; no full `recordTransactionFile`.
 */
export async function attachImportBlobViaPatch(
  params: AttachImportBlobViaPatchParams,
): Promise<void> {
  const { userId, repo, store, importFileId } = params;
  const log = getLog();
  const blobRef = await putImportBlobIfEnabled(params);
  if (!blobRef) return;

  try {
    await repo.patchTransactionFileBlob(userId, importFileId, blobRef);
  } catch (e) {
    if (store) {
      await store.delete(blobRef).catch((deleteErr) => {
        log.warn('import.blob_compensating_delete_failed', {
          importFileId,
          userId,
          errorName: deleteErr instanceof Error ? deleteErr.name : 'Error',
        });
      });
    }
    throw e;
  }
}

/**
 * In-place path (§8.6): optional blob Put (non-fatal on failure), then
 * `recordTransactionFile`. On Dynamo failure after a successful blob Put, delete
 * the object and retry metadata-only once.
 */
export async function attachImportBlobAndRecordFile(
  params: AttachImportBlobAndRecordFileParams,
): Promise<void> {
  const { userId, repo, store, transactionFileInput } = params;
  const log = getLog();
  const blobRef = await putImportBlobIfEnabled(params);

  const withBlob: TransactionFileInput = blobRef
    ? { ...transactionFileInput, blob: blobRef }
    : transactionFileInput;

  try {
    await repo.recordTransactionFile(userId, withBlob);
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

    await repo.recordTransactionFile(userId, transactionFileInput);
  }
}
