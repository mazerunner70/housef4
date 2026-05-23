import { randomUUID } from 'node:crypto';

/**
 * §4.2 stage **5** output: batch-scoped ids minted after parse and canonical amount policy.
 * `transactionIds[i]` aligns with `ParsedImportRow[i]` for the rest of the pipeline.
 */
export type BatchArtefactIds = Readonly<{
  importFileId: string;
  transactionIds: readonly string[];
}>;

function mintTransactionId(): string {
  return `txn_${randomUUID().replaceAll('-', '')}`;
}

/**
 * Allocates `import_file_id` (TRANSACTION_FILE / GSI2 provenance) and one
 * `transaction_id` per parsed row. Index alignment is guaranteed by construction.
 */
export function allocateBatchArtefactIds(rowCount: number): BatchArtefactIds {
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    throw new Error(
      'allocateBatchArtefactIds: rowCount must be a non-negative integer',
    );
  }

  return {
    importFileId: randomUUID(),
    transactionIds: Array.from({ length: rowCount }, mintTransactionId),
  };
}
