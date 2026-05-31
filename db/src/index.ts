export * from './types';
export * from './keys';
export * from './userPartition';
export type { FinanceRepository } from './dynamoFinanceRepository';
export { DynamoFinanceRepository } from './dynamoFinanceRepository';
export {
  BackupRestoreClientError,
  RestoreAbortStagingCleanupError,
  RESTORE_ABORT_STAGING_CLEANUP_CODE,
  runRestoreAbortWorkflow,
  runRestoreBackupWorkflow,
  validateBackupSnapshotForRestore,
} from './backupRestore';
export type { RunRestoreBackupWorkflowOptions } from './backupRestore';
export {
  ImportAbortStagingCleanupError,
  IMPORT_ABORT_STAGING_CLEANUP_CODE,
  runImportAbortWorkflow,
  runImportStagingWorkflow,
} from './importStaging';
export type { RunImportStagingWorkflowInput } from './importStaging';
export {
  materializeImportPlanToItems,
  validateMaterializedImportStaging,
} from './importMaterialize';
export type { MaterializeImportPlanInput } from './importMaterialize';
export {
  buildClusterAggregateItem,
  clusterMembersFromTransactionItems,
  liveClusterIdsFromImportPlan,
  authoritativeAssignedCategory,
  computeClusterPendingReview,
} from './clusterAggregates';
export type {
  BuildClusterAggregateOptions,
  ClusterAggregateMember,
} from './clusterAggregates';
export {
  normalizeIso4217Currency,
  normalizeTransactionFileCurrencyChoice,
} from './importCurrency';
export { getDocumentClient, getImportStagingTableName, requireImportStagingTableName, requireRestoreStagingTableName, requireTableName } from './dynamoClient';
export {
  HEALTH_CHECK_PK,
  HEALTH_CHECK_SK,
  readHealthCheckDetail,
  readHealthCheckText,
} from './healthCheck';
export type {
  HealthCheckDiagnosticCode,
  HealthCheckReadDetail,
} from './healthCheck';
export {
  escapeCsvCell,
  formatTransactionsAsCsv,
} from './transactionCsvExport';
export type {
  FormatTransactionsAsCsvInput,
  TransactionCsvColumn,
} from './transactionCsvExport';
export {
  computeAutoTransferPairings,
  computeAutoTransferPairingsSortedPools,
  TRANSFER_PAIRING_DAY_MS,
  utcCalendarDaysApart,
  utcDayOrdinal,
} from './transferPairing';
export type {
  PairingConfidence,
  TransferPairingAssignment,
  TransferPairingLeg,
  TransferPairingOptions,
  TransferPairingResult,
} from './transferPairing';

import type { FinanceRepository } from './dynamoFinanceRepository';
import { DynamoFinanceRepository } from './dynamoFinanceRepository';

let financeRepo: FinanceRepository | undefined;

export function getFinanceRepository(): FinanceRepository {
  financeRepo ??= new DynamoFinanceRepository();
  return financeRepo;
}
