import { normalizeApiPath } from './pathNormalize';
import { getHealthPayload } from './handlers/health';
import { getMePayload } from './handlers/me';
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
  try {
    const method = req.method.toUpperCase();
    const path = normalizeApiPath(req.path);

    if ((method === 'GET' || method === 'HEAD') && isHealthPath(path)) {
      return jsonResponse(200, getHealthPayload());
    }

    if (requiresAuthenticatedApiUser(path)) {
      const uid = req.userId;
      if (!uid) {
        return jsonResponse(401, { error: 'Unauthorized' });
      }

      if (method === 'GET' && isMePath(path)) {
        return jsonResponse(200, getMePayload(uid));
      }

      return jsonResponse(404, { error: 'Not Found' });
    }

    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { error: 'Internal Server Error' });
  }
}
