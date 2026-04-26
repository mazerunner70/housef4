/**
 * Transport-agnostic request/response shapes used by `dispatch` and adapters.
 */

export interface InternalRequest {
  method: string;
  path: string;
  /** Parsed from the URL query string (e.g. API Gateway `queryStringParameters`). */
  query?: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  /** UTF-8 text; use {@link bodyBuffer} for multipart or binary-safe reads. */
  rawBody: string;
  /**
   * Raw body bytes when the adapter supplies them (local HTTP, Lambda).
   * Required for `multipart/form-data` imports so binary uploads are not corrupted.
   */
  bodyBuffer?: Buffer;
  /** Set by auth resolver in later steps; optional for public routes. */
  userId?: string;
}

export interface InternalResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}
