import { z } from 'zod';
import { conditionsSchema } from '../recommendations/conditions.ts';
import { windStretchesSchema } from '../recommendations/wind-stretches.ts';

const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
/** Client-supplied display context, never an authenticated recommendation or activity.
 * Metadata travels with weather so credits survive provider changes and deletion. */
export const ridePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1).default(1),
    departureAt: instant,
    finishAt: instant,
    conditions: conditionsSchema,
    windStretches: windStretchesSchema.optional(),
    pickRank: z.number().int().positive().nullable(),
    generatedAt: instant,
    algorithmVersion: z.string().min(1).max(100),
    weather: z.strictObject({
      attribution: z
        .array(
          z.strictObject({
            text: z.string().min(1).max(1000),
            url: httpsUrl,
            logo: z
              .strictObject({ lightUrl: httpsUrl, darkUrl: httpsUrl })
              .optional(),
            notice: z.string().max(2000).optional(),
          }),
        )
        .min(1)
        .max(10),
    }),
  })
  .refine(
    (p) => p.departureAt < p.finishAt,
    'Plan departure must precede its finish.',
  )
  .refine(
    (p) => p.generatedAt <= p.departureAt,
    'Plan generation must not follow its departure.',
  )
  .refine((p) => {
    const stretches = p.windStretches;
    if (!stretches?.length) return true;
    const first = stretches[0],
      last = stretches.at(-1);
    if (
      !first ||
      !last ||
      first.startAt !== p.departureAt ||
      last.endAt !== p.finishAt
    )
      return false;
    const duration = Date.parse(p.finishAt) - Date.parse(p.departureAt);
    return (
      Math.abs(last.toM - p.conditions.distanceKm * 1000) <= 5.000001 &&
      stretches.every(
        (s) =>
          Math.abs(
            Date.parse(s.startAt) -
              (Date.parse(p.departureAt) + (duration * s.fromM) / last.toM),
          ) <= 1,
      ) &&
      (p.conditions.gustExposure === undefined ||
        Math.max(...stretches.map((s) => s.maximumAdverseGustKph)) ===
          p.conditions.gustExposure.maximumAdverseKph)
    );
  }, 'Wind stretches must match the plan duration, distance and adverse gust maximum.');
