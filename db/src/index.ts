export * from './types';
export * from './keys';
export type { FinanceRepository } from './dynamoFinanceRepository';
export { DynamoFinanceRepository } from './dynamoFinanceRepository';
export { getDocumentClient, requireTableName } from './dynamoClient';

import type { FinanceRepository } from './dynamoFinanceRepository';
import { DynamoFinanceRepository } from './dynamoFinanceRepository';

let financeRepo: FinanceRepository | undefined;

export function getFinanceRepository(): FinanceRepository {
  financeRepo ??= new DynamoFinanceRepository();
  return financeRepo;
}
