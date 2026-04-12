/**
 * Structured HTTP errors for `dispatch` — mapped to JSON without logging as 500.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly body: unknown = { error: message },
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
