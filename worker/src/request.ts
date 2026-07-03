import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from './errors.ts';

/**
 * Reject non-JSON bodies, malformed JSON, and schema mismatches up front so
 * every POST handler receives a fully-typed body instead of `unknown`.
 */
export const readJsonBody = async <Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<z.output<Schema>> => {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json',
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.');
    const message = issue
      ? `${path ? `"${path}" ` : ''}${issue.message}`
      : 'Request body failed validation';
    throw new AppError(400, 'BAD_REQUEST', message);
  }

  return result.data;
};
