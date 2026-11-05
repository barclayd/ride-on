import { z } from 'zod';
import type {
  Coordinate,
  ForecastDescriptor,
  LocationForecastResult,
} from './contracts.ts';
import { descriptorKey } from './descriptors.ts';
import {
  coordinateSchema,
  forecastDescriptorSchema,
  utcInstant,
} from './validation.ts';

export const resolvedLocationSchema = z.object({
  requested: z.object({ id: z.string(), coordinate: coordinateSchema }),
  coordinate: coordinateSchema,
  sourceLocationId: z.string().nullable(),
  distanceFromRequestedM: z.number().nonnegative(),
  method: z.enum([
    'nearest-site',
    'grid-cell',
    'interpolated',
    'exact',
    'provider-location',
  ]),
});

export const provenanceSchema = z.object({
  source: z.object({
    providerId: z.string(),
    productId: z.string(),
    adapterVersion: z.string(),
  }),
  dataVersion: z.string().nullable(),
  forecastRunAt: utcInstant.optional(),
  retrievedAt: utcInstant,
  expiresAt: utcInstant.optional(),
  attribution: z.array(
    z.object({
      text: z.string(),
      url: z.string(),
      logo: z.object({ lightUrl: z.string(), darkUrl: z.string() }).optional(),
      notice: z.string().optional(),
    }),
  ),
});

export const fieldEvidenceSchema = z.object({
  provenance: provenanceSchema,
  location: resolvedLocationSchema,
  descriptor: forecastDescriptorSchema,
  method: z.enum(['native', 'linear-interpolation', 'circular-interpolation']),
  nativeTimeStepSeconds: z.number().positive(),
  periods: z.array(z.object({ start: utcInstant, end: utcInstant })),
});

/** Compile once per forecast, not once per departure/leg. Include neighbouring
 * hourly instants used by nearest-sample and temperature interpolation checks. */
export const evidenceLocations = (
  result: LocationForecastResult,
  required: readonly ForecastDescriptor[],
) => {
  const locations = new Map<
    string,
    { coordinate: Coordinate; periods: { start: number; end: number }[] }
  >();
  const keys = new Set(required.map(descriptorKey));
  if (result.status === 'unavailable') return [];
  for (const series of result.series) {
    if (!keys.has(descriptorKey(series.descriptor))) continue;
    const margin = series.samples.some((s) => s.time.kind === 'instant')
      ? 3_600_000
      : 0;
    for (const evidence of series.evidence ?? []) {
      const coordinate = evidence.location.coordinate;
      const key = JSON.stringify(coordinate);
      const location = locations.get(key) ?? { coordinate, periods: [] };
      location.periods.push(
        ...evidence.periods.map((p) => ({
          start: Date.parse(p.start) - margin,
          end: Date.parse(p.end) + margin,
        })),
      );
      locations.set(key, location);
    }
  }
  return [...locations.values()].map(({ coordinate, periods }) => {
    const merged: typeof periods = [];
    for (const period of periods.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && period.start <= last.end)
        last.end = Math.max(last.end, period.end);
      else merged.push({ ...period });
    }
    return { coordinate, periods: merged };
  });
};
