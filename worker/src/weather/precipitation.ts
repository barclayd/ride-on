/** Provider-neutral display categories, ordered by the v0.15 presentation policy.
 * Numeric codes are stable identifiers; this ordering does not affect scores. */
export const precipitationTypes = {
  drizzle: 1,
  light_showers: 2,
  light_rain: 3,
  showers: 4,
  rain: 5,
  heavy_showers: 6,
  heavy_rain: 7,
  sleet: 8,
  snow: 9,
  hail: 10,
  thunder: 11,
} as const;
export const precipitationSummaries = [
  'dry',
  'possible',
  'drizzle',
  'light_showers',
  'light_rain',
  'showers',
  'rain',
  'heavy_showers',
  'heavy_rain',
  'sleet',
  'snow',
  'hail',
  'thunder',
] as const;
export type PrecipitationSummary = (typeof precipitationSummaries)[number];

export const summarizePrecipitation = (
  rows: readonly {
    precipitationType: number | null;
    precipitationRateMmH: number;
    precipitationProbability: number;
  }[],
): PrecipitationSummary => {
  let worst: keyof typeof precipitationTypes | undefined;
  for (const row of rows)
    for (const [name, code] of Object.entries(precipitationTypes))
      if (
        row.precipitationType === code &&
        (!worst || code > precipitationTypes[worst])
      )
        worst = name as keyof typeof precipitationTypes;
  if (worst) return worst;
  const rate = Math.max(...rows.map((r) => r.precipitationRateMmH));
  if (rate >= 4) return 'heavy_rain';
  if (rate >= 0.5) return 'rain';
  if (rate >= 0.1) return 'light_rain';
  return rows.some((r) => r.precipitationProbability >= 0.3)
    ? 'possible'
    : 'dry';
};
