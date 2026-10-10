import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

const temperatureFloor = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('fixed'),
    valueC: z.number().min(-50).max(60),
  }),
  z.strictObject({
    kind: z.literal('monthly'),
    valuesC: z.record(
      z.string().regex(/^(?:[1-9]|1[0-2])$/),
      z.number().min(-50).max(60),
    ),
    fallbackC: z.number().min(-50).max(60).nullable().default(null),
  }),
]);
const preferencesSchema = z
  .strictObject({
    temperature: z
      .strictObject({
        comfortMinC: z.number().min(-30).max(50).default(16),
        comfortMaxC: z.number().min(-30).max(50).default(24),
      })
      .default({ comfortMinC: 16, comfortMaxC: 24 }),
    wind: z
      .strictObject({
        comfortableHeadwindKph: z.number().min(0).max(100).default(10),
        comfortableCrosswindKph: z.number().min(0).max(100).default(15),
        comfortableGustKph: z.number().min(0).max(150).default(25),
        crosswindSensitivity: z.number().min(0).max(10).default(1),
      })
      .default({
        comfortableHeadwindKph: 10,
        comfortableCrosswindKph: 15,
        comfortableGustKph: 25,
        crosswindSensitivity: 1,
      }),
    sunshine: z
      .strictObject({
        sunnyIntervalsComfort: z.number().min(0).max(1).default(0.7),
      })
      .default({ sunnyIntervalsComfort: 0.7 }),
    weights: z
      .strictObject({
        temperature: z.number().min(0).max(1).default(0.3),
        wind: z.number().min(0).max(1).default(0.2),
        dryness: z.number().min(0).max(1).default(0.5),
        clearSkies: z.number().min(0).max(1).default(0),
        sunshine: z.number().min(0).max(1).default(0),
      })
      .default({
        temperature: 0.3,
        wind: 0.2,
        dryness: 0.5,
        clearSkies: 0,
        sunshine: 0,
      }),
    minimumStandards: z
      .strictObject({
        minimumTemperature: temperatureFloor.optional(),
        maximumGustKph: z.number().min(0).max(150).optional(),
        maximumPrecipitationProbability: z.number().min(0).max(1).optional(),
        maximumPrecipitationRateMmH: z.number().min(0).max(100).optional(),
      })
      .default({}),
  })
  .refine(
    (p) =>
      p.temperature.comfortMinC <= p.temperature.comfortMaxC &&
      Object.values(p.weights).reduce((sum, value) => sum + value, 0) > 0,
  );

export const recommendationSchema = z.strictObject({
  routeIds: z
    .array(z.uuid())
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length),
  date: z.iso.date(),
  timeZone: z
    .string()
    .max(100)
    .default('Europe/London')
    .refine((value) => {
      try {
        Temporal.Now.zonedDateTimeISO(value);
        return !/^[+-]/.test(value);
      } catch {
        return false;
      }
    }),
  riding: z
    .strictObject({
      averageSpeedKph: z.number().min(5).max(50).default(20),
      departureStepMinutes: z.number().int().min(15).max(120).default(30),
      window: z.literal('daylight').default('daylight'),
    })
    .default({
      averageSpeedKph: 20,
      departureStepMinutes: 30,
      window: 'daylight',
    }),
  preferences: preferencesSchema.default({
    temperature: { comfortMinC: 16, comfortMaxC: 24 },
    wind: {
      comfortableHeadwindKph: 10,
      comfortableCrosswindKph: 15,
      comfortableGustKph: 25,
      crosswindSensitivity: 1,
    },
    weights: {
      temperature: 0.3,
      wind: 0.2,
      dryness: 0.5,
      clearSkies: 0,
      sunshine: 0,
    },
    sunshine: { sunnyIntervalsComfort: 0.7 },
    minimumStandards: {},
  }),
  forecast: z
    .strictObject({
      representation: z
        .enum(['deterministic', 'ensemble-summary'])
        .default('deterministic'),
      freshnessBasis: z
        .enum(['model-run', 'retrieval-time'])
        .default('model-run'),
    })
    .default({ representation: 'deterministic', freshnessBasis: 'model-run' }),
  weather: z
    .discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('strict'),
        providerId: z.string().min(1).max(100),
      }),
      z.strictObject({
        mode: z.literal('ordered-fallback'),
        providerIds: z
          .tuple([z.string().min(1).max(100)])
          .rest(z.string().min(1).max(100))
          .refine((ids) => ids.length <= 5),
      }),
    ])
    .default({ mode: 'strict', providerId: 'met-office' }),
});
export type RecommendationInput = z.infer<typeof recommendationSchema>;
export type Preferences = RecommendationInput['preferences'];

export const resolveMinimumTemperature = (input: RecommendationInput) => {
  const policy = input.preferences.minimumStandards.minimumTemperature;
  if (!policy)
    return {
      valueC: null,
      configured: false,
      resolved: true,
      origin: 'unconfigured',
    };
  if (policy.kind === 'fixed')
    return {
      valueC: policy.valueC,
      configured: true,
      resolved: true,
      origin: 'fixed',
    };
  const month = Temporal.PlainDate.from(input.date).month;
  const monthValue = policy.valuesC[String(month)];
  const value = monthValue ?? policy.fallbackC;
  return {
    valueC: value,
    configured: true,
    resolved: value !== null,
    origin:
      monthValue !== undefined
        ? `month:${month}`
        : value !== null
          ? 'monthly-fallback'
          : `unresolved-month:${month}`,
  };
};
