import { z } from 'zod';

export const preferenceLevelValues = {
  sunshine: { 'dont-mind': 0, nice: 0.12, important: 0.25 },
  rain: { 'dont-mind': 0, 'light-ok': 0.2, avoid: 0.4 },
} as const;
export const preferenceLevelsSchema = z.strictObject({
  sunshine: z.enum(['dont-mind', 'nice', 'important']).optional(),
  rain: z.enum(['dont-mind', 'light-ok', 'avoid']).optional(),
});
export const levelWeights = (
  levels: z.infer<typeof preferenceLevelsSchema> | undefined,
) => ({
  ...(levels?.sunshine === undefined
    ? {}
    : { sunshine: preferenceLevelValues.sunshine[levels.sunshine] }),
  ...(levels?.rain === undefined
    ? {}
    : { dryness: preferenceLevelValues.rain[levels.rain] }),
});
export const preferenceLevels = (weights: {
  sunshine: number;
  dryness: number;
}) => {
  const find = (values: Record<string, number>, value: number) =>
    Object.entries(values).find(([, v]) => Math.abs(v - value) <= 1e-9)?.[0] ??
    'custom';
  return {
    sunshine: find(preferenceLevelValues.sunshine, weights.sunshine),
    rain: find(preferenceLevelValues.rain, weights.dryness),
  };
};
