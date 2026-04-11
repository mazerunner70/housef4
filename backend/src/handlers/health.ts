import { readHealthCheckDetail } from '@housef4/db';

import { getLog } from '../requestLogContext';

export interface HealthDiagnosticPayload {
  code: string;
  hint: string;
}

export interface HealthPayload {
  status: string;
  /** DynamoDB `text` on PK=health-check, SK=BUILD, or `unknown` if missing / no table / error. */
  build: string;
  /** Why `build` is unknown, or code `OK` when read succeeded. */
  diagnostic: HealthDiagnosticPayload;
}

export async function getHealthPayload(): Promise<HealthPayload> {
  const log = getLog();
  let detail: { code: string; text?: string; hint: string };
  try {
    detail = await readHealthCheckDetail();
  } catch (err) {
    log.error('health.dynamodb.exception', { error: String(err) });
    return {
      status: 'error',
      build: 'unknown',
      diagnostic: {
        code: 'EXCEPTION',
        hint: 'Unexpected error calling readHealthCheckDetail',
      },
    };
  }
  const healthFields = {
    diagnosticCode: detail.code,
    buildResolved: Boolean(detail.text),
  };
  if (detail.code === 'OK') {
    log.info('health.dynamodb', healthFields);
  } else if (detail.code === 'DYNAMODB_ERROR') {
    log.error('health.dynamodb', healthFields);
  } else {
    log.warn('health.dynamodb', healthFields);
  }
  return {
    status: 'ok',
    build: detail.text ?? 'unknown',
    diagnostic: {
      code: detail.code,
      hint: detail.hint,
    },
  };
}
