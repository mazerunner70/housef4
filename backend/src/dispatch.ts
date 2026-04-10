import { getHealthPayload } from './handlers/health';
import type { InternalRequest, InternalResponse } from './types';

function isHealthPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'health' && apiIdx + 2 === segments.length
  );
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

    if (method === 'GET' && isHealthPath(req.path)) {
      return jsonResponse(200, getHealthPayload());
    }

    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { error: 'Internal Server Error' });
  }
}
