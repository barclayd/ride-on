/**
 * A framework-level error carrying an HTTP status + machine-readable code.
 * Caught centrally by the Hono `onError` handler in index.ts and rendered
 * as `{ error: { code, message } }`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
