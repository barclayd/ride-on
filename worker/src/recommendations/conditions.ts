import { z } from 'zod';
import { skyConditions } from '../weather/conditions.ts';

const fraction = z.number().min(0).max(1);
const nonnegative = z.number().nonnegative();
/** Provider-neutral, version-one summary used by recommendations and saved plans.
 * Do not rename historical fields when adding a new forecast adapter. */
export const conditionsSchema = z.strictObject({
  skyConditionDistanceFractions: z
    .record(
      z.enum(
        Object.keys(skyConditions) as [
          keyof typeof skyConditions,
          ...(keyof typeof skyConditions)[],
        ],
      ),
      fraction,
    )
    .nullable(),
  averageWindSpeedKph: nonnegative,
  averageHeadwindKph: nonnegative,
  averageTailwindKph: nonnegative,
  averageCrosswindKph: nonnegative,
  cloudCoverFraction: z
    .strictObject({ mean: fraction, maximum: fraction })
    .refine((v) => v.mean <= v.maximum)
    .nullable(),
  distanceKm: nonnegative,
  temperatureC: z
    .strictObject({ minimum: z.number(), maximum: z.number() })
    .refine((v) => v.minimum <= v.maximum),
  maximumHeadwindKph: nonnegative,
  maximumCrosswindKph: nonnegative,
  maximumGustKph: nonnegative,
  maximumPrecipitationProbability: fraction,
  maximumPrecipitationRateMmH: nonnegative,
  assistedDistanceFraction: fraction,
});
export type Conditions = z.infer<typeof conditionsSchema>;
