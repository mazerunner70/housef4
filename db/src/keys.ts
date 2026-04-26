/**
 * Single-table key helpers: PK = USER#<id>, SK = TXN#... | CLUSTER#... | PROFILE.
 * See `docs/03_detailed_design/database/data_model.md` for the full key and GSI1 layout.
 */

export const USER_PREFIX = 'USER#';
export const TXN_PREFIX = 'TXN#';
export const CLUSTER_PREFIX = 'CLUSTER#';
/** User import history entries: `SK` = `FILE#<file_id>`. */
export const FILE_PREFIX = 'FILE#';
/** One financial account the user labels (e.g. checking). `SK` = `ACCOUNT#<account_id>`. */
export const ACCOUNT_PREFIX = 'ACCOUNT#';
export const PROFILE_SK = 'PROFILE';

export function userPk(userId: string): string {
  return `${USER_PREFIX}${userId}`;
}

export function txnSk(txnId: string): string {
  return `${TXN_PREFIX}${txnId}`;
}

export function clusterSk(clusterId: string): string {
  return `${CLUSTER_PREFIX}${clusterId}`;
}

export function fileSk(fileId: string): string {
  return `${FILE_PREFIX}${fileId}`;
}

export function accountSk(accountId: string): string {
  return `${ACCOUNT_PREFIX}${accountId}`;
}

/** GSI1: all transactions for a user under one cluster (tag-rule updates). */
export function clusterTxnGsi1Pk(userId: string, clusterId: string): string {
  return `${USER_PREFIX}${userId}#${CLUSTER_PREFIX}${clusterId}`;
}

export function clusterTxnGsi1Sk(txnId: string): string {
  return txnSk(txnId);
}

/** GSI2: transactions created in a single import (see `fileSk` / transaction file id). */
export function fileTxnGsi2Pk(userId: string, fileId: string): string {
  return `${USER_PREFIX}${userId}#${FILE_PREFIX}${fileId}`;
}

export function fileTxnGsi2Sk(txnId: string): string {
  return txnSk(txnId);
}
