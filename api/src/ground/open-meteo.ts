import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import {
  type GroundHour,
  type GroundProvider,
  HOUR,
  hourFloor,
} from './contracts.ts';
import { fetchEvidenceJson } from './http.ts';

export const GROUND_VARIABLES = [
  'precipitation',
  'rain',
  'snowfall',
  'temperature_2m',
  'et0_fao_evapotranspiration',
] as const;
const values = z.array(z.number().nullable()).max(24 * 40);
const responseSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  utc_offset_seconds: z.literal(0),
  hourly_units: z.object({
    time: z.literal('unixtime'),
    precipitation: z.literal('mm'),
    rain: z.literal('mm'),
    snowfall: z.literal('cm'),
    temperature_2m: z.literal('°C'),
    et0_fao_evapotranspiration: z.literal('mm'),
  }),
  hourly: z.object({
    time: z.array(z.number().int().nonnegative()).max(24 * 40),
    precipitation: values,
    rain: values,
    snowfall: values,
    temperature_2m: values,
    et0_fao_evapotranspiration: values,
  }),
});
const bounded = (value: number | null, min: number, max: number) =>
  value !== null && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;

/** Shared validation for live forecasts and explicitly separate offline archives. */
export const parseGroundResponse = (
  raw: unknown,
  point: { latitude: number; longitude: number },
  now: Date,
) => {
  const data = responseSchema.parse(raw);
  if (
    GROUND_VARIABLES.some(
      (key) => data.hourly[key].length !== data.hourly.time.length,
    )
  )
    throw new Error('Misaligned ground evidence series.');
  const gridCoordinate = {
    latitude: data.latitude,
    longitude: data.longitude,
  };
  if (
    haversineKm(
      [point.latitude, point.longitude],
      [data.latitude, data.longitude],
    ) > 30
  )
    throw new Error('Ground evidence grid too far from requested location.');
  const seen = new Set<number>();
  const hours: GroundHour[] = data.hourly.time.map((seconds, i) => {
    const time = seconds * 1000;
    if (time % HOUR !== 0 || seen.has(time))
      throw new Error('Invalid ground evidence timestamps.');
    seen.add(time);
    return {
      end: new Date(time).toISOString(),
      precipitationMm: bounded(data.hourly.precipitation[i] ?? null, 0, 500),
      // UKMO rainfall_accumulation already represents rainfall. Its unsupported
      // showers field must not be substituted with zero or added a second time.
      rainMm: bounded(data.hourly.rain[i] ?? null, 0, 500),
      snowfallCm: bounded(data.hourly.snowfall[i] ?? null, 0, 500),
      referenceEt0Mm: bounded(
        data.hourly.et0_fao_evapotranspiration[i] ?? null,
        0,
        30,
      ),
      temperatureC: bounded(data.hourly.temperature_2m[i] ?? null, -100, 70),
      basis: time <= hourFloor(now.getTime()) ? 'modelled-past' : 'forecast',
    };
  });
  return { gridCoordinate, hours };
};

export const openMeteoGroundProvider: GroundProvider = {
  id: 'open-meteo',
  model: 'ukmo_seamless',
  version: 'ground-open-meteo-v1',
  attribution: {
    text: 'Weather data by Open-Meteo, using UK Met Office models; aggregated by Ride On.',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
  },
  fetch: async (point, firstDate, lastDate, now) => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      models: 'ukmo_seamless',
      hourly: GROUND_VARIABLES.join(','),
      start_date: firstDate,
      end_date: lastDate,
      timezone: 'GMT',
      timeformat: 'unixtime',
    }).toString();
    return parseGroundResponse(await fetchEvidenceJson(url), point, now);
  },
};
