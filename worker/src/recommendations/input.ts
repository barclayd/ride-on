import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { levelWeights, preferenceLevelsSchema } from './levels.ts';
import {
  defaultPlanning,
  planningDaysSchema,
  planningSchema,
  ridingWindowSchema,
} from './planning.ts';

export { ridingWindowSchema } from './planning.ts';

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
const temperature = z.strictObject({
  comfortMinC: z.number().min(-30).max(50),
  comfortMaxC: z.number().min(-30).max(50),
});
const wind = z.strictObject({
  comfortableHeadwindKph: z.number().min(0).max(100),
  comfortableCrosswindKph: z.number().min(0).max(100),
  comfortableGustKph: z.number().min(0).max(150),
  crosswindSensitivity: z.number().min(0).max(10),
});
const sunshine = z.strictObject({
  sunnyIntervalsComfort: z.number().min(0).max(1),
});
const climbing = z.strictObject({
  preference: z.enum(['flatter', 'neutral', 'hillier']),
});
const distance = z
  .strictObject({
    minKm: z.number().min(0).max(400),
    maxKm: z.number().positive().max(400),
  })
  .refine((range) => range.minKm <= range.maxKm, {
    message: 'Minimum preferred distance must not exceed the maximum.',
    path: ['minKm'],
  });
const weights = z.strictObject({
  temperature: z.number().min(0).max(1),
  wind: z.number().min(0).max(1),
  dryness: z.number().min(0).max(1),
  clearSkies: z.number().min(0).max(1),
  sunshine: z.number().min(0).max(1),
});
const minimumStandards = z.strictObject({
  minimumTemperature: temperatureFloor.optional(),
  maximumGustKph: z.number().min(0).max(150).optional(),
  maximumPrecipitationProbability: z.number().min(0).max(1).optional(),
  maximumPrecipitationRateMmH: z.number().min(0).max(100).optional(),
});
export const preferencesSchema = z
  .strictObject({
    temperature,
    wind,
    sunshine,
    climbing: climbing.default({ preference: 'neutral' }),
    distance: distance.nullable().default(null),
    weights,
    minimumStandards,
  })
  .refine((p) => p.temperature.comfortMinC <= p.temperature.comfortMaxC, {
    message: 'Minimum comfortable temperature must not exceed the maximum.',
    path: ['temperature'],
  })
  .refine(
    (p) => Object.values(p.weights).reduce((sum, value) => sum + value, 0) > 0,
    {
      message: 'At least one comfort weight must be positive.',
      path: ['weights'],
    },
  );
const preferenceOverrides = z.strictObject({
  temperature: temperature.partial().optional(),
  wind: wind.partial().optional(),
  sunshine: sunshine.partial().optional(),
  climbing: climbing.partial().optional(),
  // Replace a range as a whole; null explicitly removes the preference.
  distance: distance.nullable().optional(),
  weights: weights.partial().optional(),
  minimumStandards: z
    .strictObject({
      minimumTemperature: temperatureFloor.nullable().optional(),
      maximumGustKph: minimumStandards.shape.maximumGustKph
        .unwrap()
        .nullable()
        .optional(),
      maximumPrecipitationProbability:
        minimumStandards.shape.maximumPrecipitationProbability
          .unwrap()
          .nullable()
          .optional(),
      maximumPrecipitationRateMmH:
        minimumStandards.shape.maximumPrecipitationRateMmH
          .unwrap()
          .nullable()
          .optional(),
    })
    .optional(),
});
const timeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      Temporal.Now.zonedDateTimeISO(value);
      return !/^[+-]/.test(value);
    } catch {
      return false;
    }
  }, 'Use an IANA time zone or UTC.');
const ridingDefaults = z.strictObject({
  averageSpeedKph: z.number().min(5).max(50),
  departureStepMinutes: z.number().int().min(15).max(120),
});
const forecast = z.strictObject({
  representation: z.enum(['deterministic', 'ensemble-summary']),
  freshnessBasis: z.enum(['model-run', 'retrieval-time']),
});
const weather = z.discriminatedUnion('mode', [
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
]);
export const settingsSchema = z.strictObject({
  timeZone,
  riding: ridingDefaults,
  preferences: preferencesSchema,
  forecast,
  weather,
  planning: planningSchema.default(defaultPlanning),
  display: z
    .strictObject({ unit: z.enum(['km', 'mi']) })
    .default({ unit: 'km' }),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  planning: defaultPlanning,
  display: { unit: 'km' },
  timeZone: 'Europe/London',
  riding: { averageSpeedKph: 20, departureStepMinutes: 30 },
  preferences: {
    temperature: { comfortMinC: 16, comfortMaxC: 24 },
    wind: {
      comfortableHeadwindKph: 10,
      comfortableCrosswindKph: 15,
      comfortableGustKph: 25,
      crosswindSensitivity: 1,
    },
    sunshine: { sunnyIntervalsComfort: 0.7 },
    climbing: { preference: 'neutral' },
    distance: null,
    weights: {
      temperature: 0.3,
      wind: 0.2,
      dryness: 0.5,
      clearSkies: 0,
      sunshine: 0,
    },
    minimumStandards: {},
  },
  forecast: {
    representation: 'deterministic',
    freshnessBasis: 'retrieval-time',
  },
  weather: { mode: 'strict', providerId: 'apple-weather' },
};
const checkLevelConflicts = (
  patch: {
    preferenceLevels?: z.infer<typeof preferenceLevelsSchema>;
    preferences?: z.infer<typeof preferenceOverrides>;
  },
  context: z.RefinementCtx,
) => {
  for (const [level, field] of [
    ['sunshine', 'sunshine'],
    ['rain', 'dryness'],
  ] as const) {
    if (
      patch.preferenceLevels?.[level] !== undefined &&
      patch.preferences?.weights?.[field] !== undefined
    )
      context.addIssue({
        code: 'custom',
        path: ['preferenceLevels', level],
        message:
          'Do not combine a preference level with its raw weight in the same request.',
      });
  }
};
// No defaults on the patch: omitted values must inherit the saved profile.
export const settingsPatchSchema = z
  .strictObject({
    timeZone: timeZone.optional(),
    riding: ridingDefaults.partial().optional(),
    preferences: preferenceOverrides.optional(),
    forecast: forecast.partial().optional(),
    weather: weather.optional(),
    planning: planningSchema.partial().optional(),
    display: settingsSchema.shape.display.unwrap().partial().optional(),
    preferenceLevels: preferenceLevelsSchema.optional(),
  })
  .superRefine(checkLevelConflicts);
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export const mergeSettings = (
  patch: SettingsPatch,
  base: Settings = defaultSettings,
): z.input<typeof settingsSchema> => {
  const preferences = patch.preferences;
  return {
    planning: { ...(base.planning ?? defaultPlanning), ...patch.planning },
    display: { ...(base.display ?? { unit: 'km' as const }), ...patch.display },
    timeZone: patch.timeZone ?? base.timeZone,
    riding: { ...base.riding, ...patch.riding },
    forecast: { ...base.forecast, ...patch.forecast },
    weather: patch.weather ?? base.weather,
    preferences: {
      temperature: {
        ...base.preferences.temperature,
        ...preferences?.temperature,
      },
      wind: { ...base.preferences.wind, ...preferences?.wind },
      sunshine: { ...base.preferences.sunshine, ...preferences?.sunshine },
      climbing: { ...base.preferences.climbing, ...preferences?.climbing },
      distance:
        preferences?.distance === undefined
          ? base.preferences.distance
          : preferences.distance,
      weights: {
        ...base.preferences.weights,
        ...preferences?.weights,
        ...levelWeights(patch.preferenceLevels),
      },
      // A policy is replaced as a whole. Null explicitly removes a saved limit.
      minimumStandards: Object.fromEntries(
        Object.entries({
          ...base.preferences.minimumStandards,
          ...preferences?.minimumStandards,
        }).filter(([, value]) => value !== null),
      ),
    },
  };
};
export const recommendationRequestSchema = settingsPatchSchema.safeExtend({
  routeIds: z
    .array(z.uuid())
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length),
  date: z.iso.date(),
  riding: ridingDefaults
    .partial()
    .extend({ window: ridingWindowSchema.optional() })
    .optional(),
});
export const recommendationApiRequestSchema = z
  .strictObject({
    ...recommendationRequestSchema.shape,
    date: z.iso.date().optional(),
    days: planningDaysSchema.optional(),
    previewDays: z.number().int().min(1).max(7).optional(),
  })
  .superRefine(checkLevelConflicts)
  .refine(
    (input) => (input.date === undefined) !== (input.days === undefined),
    {
      message: 'Supply exactly one of date or days.',
    },
  );
const resolvedRecommendationSchema = settingsSchema
  .extend({
    routeIds: recommendationRequestSchema.shape.routeIds,
    date: recommendationRequestSchema.shape.date,
    riding: ridingDefaults.extend({ window: ridingWindowSchema }),
  })
  .superRefine((input, context) => {
    if (input.riding.window === 'daylight') return;
    try {
      for (const time of [input.riding.window.start, input.riding.window.end]) {
        Temporal.PlainDateTime.from(`${input.date}T${time}`).toZonedDateTime(
          input.timeZone,
          { disambiguation: 'reject' },
        );
      }
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['riding', 'window'],
        message:
          'Window times must exist and be unambiguous on this date in the selected time zone.',
      });
    }
  });
export const recommendationWithSettings = (
  request: z.infer<typeof recommendationRequestSchema>,
  base?: Settings,
) => {
  const { window = 'daylight', ...riding } = request.riding ?? {};
  const settings = mergeSettings({ ...request, riding }, base);
  return {
    ...settings,
    routeIds: request.routeIds,
    date: request.date,
    riding: { ...settings.riding, window },
  };
};
// Pure engine callers retain the existing parse-and-default convenience.
export const recommendationSchema = recommendationRequestSchema
  .transform((request) => recommendationWithSettings(request))
  .pipe(resolvedRecommendationSchema);
export { resolvedRecommendationSchema };
export type RecommendationInput = z.infer<typeof resolvedRecommendationSchema>;
export type Preferences = Settings['preferences'];

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
