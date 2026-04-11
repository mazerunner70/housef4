import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from './dynamoClient';
import { dbLog } from './structuredLog';

/** Row read by GET /api/health for environment branding (single-table PK/SK). */
export const HEALTH_CHECK_PK = 'health-check';
export const HEALTH_CHECK_SK = 'BUILD';

const TEXT_ATTR = 'text';

export type HealthCheckDiagnosticCode =
  | 'OK'
  | 'NO_TABLE_ENV'
  | 'ITEM_NOT_FOUND'
  | 'TEXT_EMPTY'
  | 'DYNAMODB_ERROR';

export interface HealthCheckReadDetail {
  text: string | undefined;
  code: HealthCheckDiagnosticCode;
  /** Operator-facing hint (no secrets); empty when OK. */
  hint: string;
}

function truncateHint(s: string, max = 280): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Reads `text` from PK=health-check, SK=BUILD with explicit diagnostics for `/api/health`.
 */
export async function readHealthCheckDetail(): Promise<HealthCheckReadDetail> {
  const tableName = process.env.DYNAMODB_TABLE_NAME?.trim();
  if (!tableName) {
    dbLog('warn', 'healthCheck.noTableEnv', {});
    return {
      text: undefined,
      code: 'NO_TABLE_ENV',
      hint: truncateHint(
        'DYNAMODB_TABLE_NAME is unset. For Lambda, set it via Terraform (aws_lambda_function environment). Redeploy the function after apply.',
      ),
    };
  }

  try {
    const res = await getDocumentClient().send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: HEALTH_CHECK_PK,
          SK: HEALTH_CHECK_SK,
        },
      }),
    );

    if (!res.Item) {
      dbLog('warn', 'healthCheck.itemNotFound', {
        tableName,
        pk: HEALTH_CHECK_PK,
        sk: HEALTH_CHECK_SK,
      });
      return {
        text: undefined,
        code: 'ITEM_NOT_FOUND',
        hint: truncateHint(
          `No DynamoDB item at PK="${HEALTH_CHECK_PK}" SK="${HEALTH_CHECK_SK}" in table "${tableName}". AWS: run terraform apply so aws_dynamodb_table_item.health_check is created. Local: run ./scripts/ddb-local-bootstrap.sh.`,
        ),
      };
    }

    const raw = res.Item[TEXT_ATTR];
    if (typeof raw !== 'string' || raw.length === 0) {
      dbLog('warn', 'healthCheck.textEmpty', { tableName });
      return {
        text: undefined,
        code: 'TEXT_EMPTY',
        hint: truncateHint(
          `Item exists but attribute "${TEXT_ATTR}" is missing or not a non-empty string.`,
        ),
      };
    }

    dbLog('info', 'healthCheck.ok', {
      tableName,
      textLength: raw.length,
    });
    return { text: raw, code: 'OK', hint: '' };
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    const msg = e instanceof Error ? e.message : String(e);
    dbLog('error', 'healthCheck.getItemFailed', {
      tableName,
      errName: name,
      errMessage: truncateHint(msg, 200),
    });
    return {
      text: undefined,
      code: 'DYNAMODB_ERROR',
      hint: truncateHint(
        `${name}: ${msg}. Check Lambda IAM (dynamodb:GetItem on the table), region, and table name.`,
      ),
    };
  }
}

/**
 * @deprecated Prefer {@link readHealthCheckDetail} for diagnostics.
 */
export async function readHealthCheckText(): Promise<string | undefined> {
  const d = await readHealthCheckDetail();
  return d.text;
}
