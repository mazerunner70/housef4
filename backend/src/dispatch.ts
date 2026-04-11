import { getHealthPayload } from './handlers/health';
import { getMePayload } from './handlers/me';
import { getMetricsPayload } from './handlers/metrics';
import { normalizeApiPath } from './pathNormalize';
import { getLog } from './requestLogContext';
import type { InternalRequest, InternalResponse } from './types';

function isHealthPath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'health' && apiIdx + 2 === segments.length
  );
}

function isMePath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return segments[apiIdx + 1] === 'me' && apiIdx + 2 === segments.length;
}

function isMetricsPath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'metrics' && apiIdx + 2 === segments.length
  );
}

/** True for `/api/...` routes that are not public (health). Matches API Gateway JWT on `ANY /api/{proxy+}`. */
function requiresAuthenticatedApiUser(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  if (!pathname.startsWith('/api/')) return false;
  return !isHealthPath(normalizedPath);
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): InternalResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  };
}

/**
 * Single application router. Lambda and local HTTP both call this with a normalized request.
 */
export async function dispatch(req: InternalRequest): Promise<InternalResponse> {
  const log = getLog();
  try {
    const method = req.method.toUpperCase();
    const path = normalizeApiPath(req.path);
    log.debug('dispatch.route', { method, path });

    if ((method === 'GET' || method === 'HEAD') && isHealthPath(path)) {
      const body = await getHealthPayload();
      log.info('dispatch.response', { route: 'health', statusCode: 200 });
      return jsonResponse(200, body);
    }

    if (requiresAuthenticatedApiUser(path)) {
      const uid = req.userId;
      if (!uid) {
        log.info('dispatch.unauthorized', { method, path });
        return jsonResponse(401, { error: 'Unauthorized' });
      }

      if (method === 'GET' && isMePath(path)) {
        log.info('dispatch.response', { route: 'me', statusCode: 200 });
        return jsonResponse(200, getMePayload(uid));
      }

      if (method === 'GET' && isMetricsPath(path)) {
        const body = await getMetricsPayload(uid);
        log.info('dispatch.response', { route: 'metrics', statusCode: 200 });
        return jsonResponse(200, body);
      }

      log.info('dispatch.notFound', { method, path, authenticated: true });
      return jsonResponse(404, { error: 'Not Found' });
    }

    log.info('dispatch.notFound', { method, path, authenticated: false });
    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    log.error('dispatch.error', {
      err: err instanceof Error ? err.message : String(err),
      errName: err instanceof Error ? err.name : undefined,
    });
    return jsonResponse(500, { error: 'Internal Server Error' });
  }
}
