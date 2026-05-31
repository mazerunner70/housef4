import isEmpty from 'lodash/isEmpty';
import mapValues from 'lodash/mapValues';

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

export function methodMayHaveBody(method: string): boolean {
  return !METHODS_WITHOUT_BODY.has(method.toUpperCase());
}

export function normalizeHeaderValues(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return mapValues(headers, (v) => (Array.isArray(v) ? v.join(', ') : v));
}

export function queryFromUrl(url: URL): Record<string, string | undefined> | undefined {
  const query = Object.fromEntries(url.searchParams);
  return isEmpty(query) ? undefined : query;
}

export function serializeResponsePayload(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

export function bodyFieldsFromBuffer(bodyBuffer: Buffer): {
  rawBody: string;
  bodyBuffer?: Buffer;
} {
  if (!bodyBuffer.length) {
    return { rawBody: '', bodyBuffer: undefined };
  }
  return {
    rawBody: bodyBuffer.toString('utf8'),
    bodyBuffer,
  };
}
