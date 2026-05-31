/** Thrown when currency or amount input violates strict money rules. */
export class MoneyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MoneyError';
  }
}
