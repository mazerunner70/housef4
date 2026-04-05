/** Single-table key helpers: PK = USER#<id>, SK = TXN#... | CLUSTER#... | PROFILE */

export const USER_PREFIX = 'USER#';
export const TXN_PREFIX = 'TXN#';
export const CLUSTER_PREFIX = 'CLUSTER#';
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

/** GSI1: all transactions for a user under one cluster (tag-rule updates). */
export function clusterTxnGsi1Pk(userId: string, clusterId: string): string {
  return `${USER_PREFIX}${userId}#${CLUSTER_PREFIX}${clusterId}`;
}

export function clusterTxnGsi1Sk(txnId: string): string {
  return txnSk(txnId);
}
