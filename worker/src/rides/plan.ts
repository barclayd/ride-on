import { z } from 'zod';
import { conditionsSchema } from '../recommendations/conditions.ts';

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
  );
