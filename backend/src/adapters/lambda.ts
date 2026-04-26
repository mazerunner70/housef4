import type {
  APIGatewayEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { loadConfig } from '../config';
import { dispatch } from '../dispatch';
import { getLog, runWithRequestLogAsync } from '../requestLogContext';
import type { InternalRequest } from '../types';

function jsonProxyResult(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * Resolves Cognito subject (`sub`) from API Gateway request context.
 * Used in later steps for protected routes.
 */
function getAuthenticatedUserId(event: APIGatewayEvent): string | undefined {
  const authorizer = event.requestContext?.authorizer as
    | { claims?: { sub?: string }; jwt?: { claims?: { sub?: string } } }
    | undefined;
  if (!authorizer) return undefined;
  const sub = authorizer.jwt?.claims?.sub ?? authorizer.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
}

function lambdaHeaders(
  event: APIGatewayEvent,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const h = event.headers;
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function getBodyBytes(event: APIGatewayEvent): Buffer {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64');
  }
  return Buffer.from(event.body, 'utf8');
}

function toInternalRequest(event: APIGatewayEvent): InternalRequest {
  const bodyBuffer = getBodyBytes(event);
  const qp = event.queryStringParameters;
  return {
    method: event.httpMethod ?? 'GET',
    path: event.path ?? '/',
    query: qp ? { ...qp } : undefined,
    headers: lambdaHeaders(event),
    rawBody: bodyBuffer.length ? bodyBuffer.toString('utf8') : '',
    bodyBuffer: bodyBuffer.length ? bodyBuffer : undefined,
    userId: getAuthenticatedUserId(event),
  };
}

export async function lambdaHandler(
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  return runWithRequestLogAsync(context.awsRequestId, async () => {
    const cfg = loadConfig();
    const log = getLog();
    log.info('lambda.request.start', {
      method: event.httpMethod,
      path: event.path,
      appEnv: cfg.appEnv,
      awsRequestId: context.awsRequestId,
    });

    try {
      const internal = toInternalRequest(event);
      const res = await dispatch(internal);
      log.info('lambda.request.end', { statusCode: res.statusCode });
      return jsonProxyResult(res.statusCode, res.body, res.headers);
    } catch (err) {
      log.error('lambda.request.error', {
        err: err instanceof Error ? err.message : String(err),
        errName: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return jsonProxyResult(500, { error: 'Internal Server Error' });
    }
  });
}
