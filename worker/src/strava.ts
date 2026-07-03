import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { readJsonBody } from './request.ts';
import type { Bindings, Env } from './types.ts';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_TIMEOUT_MS = 15_000;

const sanitizeStravaError = (payload: unknown): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof (payload as { message: unknown }).message === 'string'
  ) {
    return (payload as { message: string }).message;
  }
  return 'Strava token request failed';
};

const exchangeWithStrava = async (
  env: Env,
  params: Record<string, string>,
): Promise<unknown> => {
  const form = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    ...params,
  });

  let response: Response;
  try {
    response = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(STRAVA_TIMEOUT_MS),
    });
  } catch {
    // Never log the caught error here — it can echo back request details.
    throw new AppError(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Strava request failed or timed out',
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError(
      response.status as ContentfulStatusCode,
      'STRAVA_ERROR',
      sanitizeStravaError(payload),
    );
  }

  return payload;
};

const tokenBodySchema = z.object({ code: z.string().min(1) });
const refreshBodySchema = z.object({ refresh_token: z.string().min(1) });

export const tokenHandler = async (c: Context<Bindings>) => {
  const { code } = await readJsonBody(c, tokenBodySchema);

  const tokens = await exchangeWithStrava(c.env, {
    code,
    grant_type: 'authorization_code',
  });
  return c.json(tokens);
};

export const refreshHandler = async (c: Context<Bindings>) => {
  const { refresh_token } = await readJsonBody(c, refreshBodySchema);

  const tokens = await exchangeWithStrava(c.env, {
    refresh_token,
    grant_type: 'refresh_token',
  });
  return c.json(tokens);
};
