/**
 * Transport-agnostic request/response shapes used by `dispatch` and adapters.
 */

export interface InternalRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
  /** Set by auth resolver in later steps; optional for public routes. */
  userId?: string;
}

export interface InternalResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}
