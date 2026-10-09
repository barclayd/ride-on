import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors.ts';

const keysSchema = z
  .array(
    z.object({
      ownerId: z.string().min(1).max(100),
      token: z.string().min(32).max(256),
    }),
  )
  .min(1)
  .max(50);
const digest = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );

export const authenticate = async (
  header: string | undefined,
  configuredKeys: string,
): Promise<string> => {
  let keys: z.infer<typeof keysSchema>;
  try {
    keys = keysSchema.parse(JSON.parse(configuredKeys));
  } catch {
    throw new AppError(
      503,
      'AUTH_NOT_CONFIGURED',
      'API access is not configured.',
    );
  }
  const token = header?.match(/^Bearer ([^\s]{32,256})$/)?.[1];
  if (!token)
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'A valid bearer token is required.',
    );
  const supplied = await digest(token);
  let owner: string | undefined;
  for (const key of keys) {
    if (timingSafeEqual(supplied, await digest(key.token))) owner = key.ownerId;
  }
  if (!owner)
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'A valid bearer token is required.',
    );
  return owner;
};
