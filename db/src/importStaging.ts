import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { batchWriteItemsParallel } from './backupRestore';
import { requireImportStagingTableName, requireTableName } from './dynamoClient';
import {
  materializeImportPlanToItems,
  validateMaterializedImportStaging,
} from './importMaterialize';
import { dbLog } from './structuredLog';
import type {
  ImportIngestResult,
  ImportPersistPlan,
  ImportTransactionInput,
  TransactionFileInput,
} from './types';
import {
  acquireImportLock,
  collectUserPartitionItems,
  deleteImportLockIfPresent,
  deleteUserPartition,
  queryUserPartitionPages,
  releaseImportLock,
} from './userPartition';

/** Discriminant for {@link ImportAbortStagingCleanupError}. */
export const IMPORT_ABORT_STAGING_CLEANUP_CODE =
  'IMPORT_ABORT_STAGING_CLEANUP' as const;

/** Staging partition cleanup failed after the primary lock step (`api_contract.md` import abort). */
export class ImportAbortStagingCleanupError extends Error {
  readonly code = IMPORT_ABORT_STAGING_CLEANUP_CODE;

  constructor(
    readonly import_lock_cleared: boolean,
    cause?: Error,
  ) {
    const message =
      cause?.message ||
      'Staging partition cleanup failed during import abort';
    super(message, cause ? { cause } : undefined);
    this.name = 'ImportAbortStagingCleanupError';
  }
}

function computeIngestResultFromRows(rows: ImportTransactionInput[]): ImportIngestResult {
  if (rows.length === 0) {
    return {
      rowCount: 0,
      knownMerchants: 0,
      unknownMerchants: 0,
      existingTransactionsUpdated: 0,
      newClustersTouched: 0,
    };
  }
  let knownMerchants = 0;
  let unknownMerchants = 0;
  for (const r of rows) {
    if (r.known_merchant) knownMerchants += 1;
    else unknownMerchants += 1;
  }
  return {
    rowCount: rows.length,
    knownMerchants,
    unknownMerchants,
    existingTransactionsUpdated: 0,
    newClustersTouched: new Set(rows.map((r) => r.cluster_id)).size,
  };
}

export interface RunImportStagingWorkflowInput {
  doc: DynamoDBDocumentClient;
  userId: string;
  importFileId: string;
  importStartedAt: number;
  plan: ImportPersistPlan;
  transactionFile: TransactionFileInput;
  fileCurrency?: string;
  refreshMetrics: () => Promise<void>;
  /** When true, orchestration already acquired `IMPORT_LOCK` (§8.7.2 step 1). */
  importLockAlreadyHeld?: boolean;
  /**
   * Optional hook after primary promote succeeds and staging is cleared, but before
   * metrics refresh and `IMPORT_LOCK` release (e.g. blob Put + patch `TRANSACTION_FILE.blob`).
   */
  afterPromote?: () => Promise<void>;
}

/**
 * Import abort: **`IMPORT_LOCK`** on primary first, then clear import-staging partition.
 */
export async function runImportAbortWorkflow(opts: {
  doc: DynamoDBDocumentClient;
  userId: string;
}): Promise<{ import_lock_cleared: boolean }> {
  const import_lock_cleared = await deleteImportLockIfPresent(
    opts.doc,
    opts.userId,
  );
  try {
    await deleteUserPartition({
      docClient: opts.doc,
      dataset: 'import_staging',
      userId: opts.userId,
    });
  } catch (e) {
    throw new ImportAbortStagingCleanupError(
      import_lock_cleared,
      e instanceof Error ? e : new Error(String(e)),
    );
  }
  return { import_lock_cleared };
}

/**
 * §8.7 now/next workflow: materialize to import staging → validate → promote to primary.
 */
export async function runImportStagingWorkflow(
  input: RunImportStagingWorkflowInput,
): Promise<ImportIngestResult> {
  const {
    doc,
    userId,
    importFileId,
    importStartedAt,
    plan,
    transactionFile,
    fileCurrency,
    refreshMetrics,
    importLockAlreadyHeld = false,
    afterPromote,
  } = input;

  const stagingTable = requireImportStagingTableName();
  const primaryTable = requireTableName();

  const primaryPartitionItems = await collectUserPartitionItems({
    docClient: doc,
    dataset: 'primary',
    userId,
    excludeRestoreLock: true,
  });

  const materialized = materializeImportPlanToItems({
    userId,
    importFileId,
    plan,
    transactionFile,
    primaryPartitionItems,
    fileCurrency,
  });
  validateMaterializedImportStaging(materialized, primaryPartitionItems, plan);

  if (!importLockAlreadyHeld) {
    await acquireImportLock(doc, userId, {
      import_file_id: importFileId,
      import_started_at: importStartedAt,
    });
  }

  let primaryDeleteStarted = false;
  try {
    await deleteUserPartition({
      docClient: doc,
      dataset: 'import_staging',
      userId,
    });
    await batchWriteItemsParallel(doc, stagingTable, materialized, 8);

    const stagingRows = await (async () => {
      const acc: Record<string, unknown>[] = [];
      for await (const page of queryUserPartitionPages({
        docClient: doc,
        dataset: 'import_staging',
        userId,
      })) {
        acc.push(...page);
      }
      return acc;
    })();
    validateMaterializedImportStaging(stagingRows, primaryPartitionItems, plan);

    primaryDeleteStarted = true;
    await deleteUserPartition({
      docClient: doc,
      dataset: 'primary',
      userId,
    });
    await batchWriteItemsParallel(doc, primaryTable, stagingRows, 8);

    await deleteUserPartition({
      docClient: doc,
      dataset: 'import_staging',
      userId,
    });

    if (afterPromote) {
      await afterPromote();
    }

    await refreshMetrics();
    await releaseImportLock(doc, userId);
  } catch (e) {
    dbLog('error', 'import.staging.failed', {
      userIdLen: userId.length,
      importFileId,
      primaryDeleteStarted,
      err: e instanceof Error ? e.message : String(e),
    });
    if (!primaryDeleteStarted) {
      try {
        await deleteUserPartition({
          docClient: doc,
          dataset: 'import_staging',
          userId,
        });
      } catch {
        /* best effort abort rollback */
      }
      try {
        await releaseImportLock(doc, userId);
      } catch {
        /* best effort */
      }
    }
    throw e;
  }

  const ingest = computeIngestResultFromRows(plan.toInsert);
  return {
    ...ingest,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: new Set(plan.toInsert.map((r) => r.cluster_id)).size,
  };
}
