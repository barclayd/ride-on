import { z } from 'zod';
import { readBoundedBody } from '../body.ts';
import { AppError } from '../errors.ts';
import type { Env } from '../types.ts';

export const configured = (env: Env) =>
  String(env.STRAVA_ENABLED) === 'true' && !!env.STRAVA_STITCH;
export const athleteSchema = z.object({
  athleteId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  scopes: z.array(z.string().max(80)).max(12),
  grantId: z.uuid(),
});
export const historySchema = z.object({
  rides: z
    .array(
      z.object({
        id: z.string().regex(/^[1-9][0-9]{0,15}$/),
        name: z.string().max(1000),
        sportType: z.enum([
          'Ride',
          'MountainBikeRide',
          'GravelRide',
          'VirtualRide',
          'EBikeRide',
          'EMountainBikeRide',
          'Handcycle',
          'Velomobile',
        ]),
        startedAt: z.iso.datetime(),
        distanceKm: z.number().finite().nonnegative(),
        movingSeconds: z.number().int().nonnegative(),
        elapsedSeconds: z.number().int().nonnegative(),
        elevationGainM: z.number().finite().nonnegative(),
        url: z
          .string()
          .regex(/^https:\/\/www\.strava\.com\/activities\/[1-9][0-9]*$/),
      }),
    )
    .max(30),
  nextPage: z.number().int().min(2).max(9999).nullable(),
  fetchedAt: z.iso.datetime(),
});
export const bridge = async <T>(
  env: Env,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> => {
  if (!configured(env))
    throw new AppError(
      503,
      'STRAVA_NOT_CONFIGURED',
      'Strava is not available yet.',
    );
  const unavailable = () =>
    new AppError(
      502,
      'STRAVA_UNAVAILABLE',
      'Strava could not load your connection. Please try again.',
    );
  let response: Response;
  try {
    response = await env.STRAVA_STITCH.fetch(
      `https://strava-stitch.internal${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
        redirect: 'manual',
      },
    );
  } catch {
    throw unavailable();
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 409)
      throw new AppError(
        409,
        'STRAVA_REAUTHORISATION_REQUIRED',
        'Reconnect Strava to view your rides.',
      );
    if (response.status === 403)
      throw new AppError(
        403,
        'STRAVA_PERMISSION_REQUIRED',
        'Allow activity access when connecting Strava.',
      );
    if (response.status === 429)
      throw new AppError(
        429,
        'STRAVA_RATE_LIMITED',
        'Strava’s request limit has been reached. Please try again later.',
        { 'Retry-After': '900' },
      );
    throw unavailable();
  }
  try {
    const bytes = await readBoundedBody(
      new Request('https://internal', { method: 'POST', body: response.body }),
      128_000,
    );
    return schema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      ),
    );
  } catch {
    throw unavailable();
  }
};
