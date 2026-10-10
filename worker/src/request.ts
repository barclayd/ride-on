import type { Context } from 'hono';
import type { z } from 'zod';
import { readBoundedBody } from './body.ts';
import { AppError } from './errors.ts';

export const validateInput = <Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown,
): z.output<Schema> => {
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
    raw = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        await readBoundedBody(c.req.raw, 64_000),
      ),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }

  return validateInput(schema, raw);
};
