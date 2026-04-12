export * from './types';
export * from './keys';
export type { FinanceRepository } from './dynamoFinanceRepository';
export { DynamoFinanceRepository } from './dynamoFinanceRepository';
export { getDocumentClient, requireTableName } from './dynamoClient';
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

import type { FinanceRepository } from './dynamoFinanceRepository';
import { DynamoFinanceRepository } from './dynamoFinanceRepository';

let financeRepo: FinanceRepository | undefined;

export function getFinanceRepository(): FinanceRepository {
  financeRepo ??= new DynamoFinanceRepository();
  return financeRepo;
}
