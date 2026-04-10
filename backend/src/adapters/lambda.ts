import type {
  APIGatewayEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { loadConfig } from '../config';
import { dispatch } from '../dispatch';
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

function getRawBody(event: APIGatewayEvent): string {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function toInternalRequest(event: APIGatewayEvent): InternalRequest {
  return {
    method: event.httpMethod ?? 'GET',
    path: event.path ?? '/',
    headers: lambdaHeaders(event),
    rawBody: getRawBody(event),
    userId: getAuthenticatedUserId(event),
  };
}

export async function lambdaHandler(
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const cfg = loadConfig();
  console.log(
    `Request started: ${event.httpMethod} ${event.path} - RequestId: ${context.awsRequestId} - APP_ENV: ${cfg.appEnv}`,
  );

  try {
    const internal = toInternalRequest(event);
    const res = await dispatch(internal);
    return jsonProxyResult(res.statusCode, res.body, res.headers);
  } catch (err) {
    console.error(err);
    return jsonProxyResult(500, { error: 'Internal Server Error' });
  }
}
