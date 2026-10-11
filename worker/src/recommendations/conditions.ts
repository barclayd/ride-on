import { z } from 'zod';

const fraction = z.number().min(0).max(1);
const nonnegative = z.number().nonnegative();
/** Provider-neutral, version-one summary used by recommendations and saved plans.
 * Do not rename historical fields when adding a new forecast adapter. */
export const conditionsSchema = z.strictObject({
  skyConditionDistanceFractions: z
    .record(
      // Keep v1 persisted plans readable if the live vocabulary later expands.
      z.enum([
        'sunny',
        'sunnyIntervals',
        'cloudy',
        'overcast',
        'obscured',
        'precipitation',
        'clearNight',
        'partlyCloudyNight',
      ]),
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
