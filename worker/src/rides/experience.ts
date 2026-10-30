import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import {
  defaultSettings,
  preferencesSchema,
} from '../recommendations/input.ts';

export const feedbackFactors = [
  'sunshine',
  'temperature',
  'wind',
  'rain',
  'surface',
  'hills',
  'distance',
  'traffic',
  'company',
  'tiredness',
  'mechanical',
] as const;
export const feedbackSchema = z.strictObject({
  enjoyment: z.number().int().min(1).max(5).nullable(),
  weatherComfort: z.number().int().min(1).max(5).nullable(),
  reasons: z
    .array(
      z.strictObject({
        factor: z.enum(feedbackFactors),
        impact: z.enum(['positive', 'negative']),
      }),
    )
    .max(2)
    .refine(
      (r) => new Set(r.map((v) => v.factor)).size === r.length,
      'Choose each reason once.',
    ),
  includeInLearning: z.boolean(),
});
export const timingSchema = z.strictObject({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(1).max(1440),
  precision: z.enum(['confirmed', 'approximate']),
  routeFollowed: z.enum(['yes', 'partly', 'different', 'unknown']),
});
export const experienceInputSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  expectedRideVersion: z.number().int().positive(),
  timing: timingSchema.nullable(),
  feedback: feedbackSchema.nullable(),
});
export const experienceSchema = z.object({
  preferenceSnapshot: preferencesSchema.default(defaultSettings.preferences),
  timing: timingSchema
    .extend({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime() })
    .nullable(),
  feedback: feedbackSchema.nullable(),
  firstSubmittedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Experience = z.infer<typeof experienceSchema>;
export const resolveExperience = (
  input: z.infer<typeof experienceInputSchema>,
  ride: { ridden_on: string; time_zone: string },
  now: Date,
  previous: Experience | null,
  preferences = defaultSettings.preferences,
): Experience => {
  let timing: Experience['timing'] = null;
  if (input.timing) {
    try {
      const start = Temporal.PlainDateTime.from(
        `${ride.ridden_on}T${input.timing.startTime}`,
      )
        .toZonedDateTime(ride.time_zone, { disambiguation: 'reject' })
        .toInstant();
      const finish = start.add({ minutes: input.timing.durationMinutes });
      if (finish.epochMilliseconds > now.getTime()) throw new Error('future');
      timing = {
        ...input.timing,
        startedAt: new Date(start.epochMilliseconds).toISOString(),
        finishedAt: new Date(finish.epochMilliseconds).toISOString(),
      };
    } catch {
      throw new AppError(
        400,
        'INVALID_RIDE_TIMING',
        'Choose an unambiguous local start time and a duration that finishes in the past.',
      );
    }
  }
  return {
    preferenceSnapshot: previous?.preferenceSnapshot ?? preferences,
    timing,
    feedback: input.feedback,
    firstSubmittedAt: previous?.firstSubmittedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
};
