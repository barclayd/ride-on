import { z } from 'zod';
import { haversineKm } from '../geo.ts';
import { fetchEvidenceJson } from '../ground/http.ts';
import { defaultSettings } from '../recommendations/input.ts';
import { windComfort } from '../recommendations/wind-comfort.ts';
import { routeSchema } from '../routes/model.ts';
import type { Experience } from './experience.ts';
import { featuresSchema } from './learning.ts';

export const weatherRouteSchema = routeSchema.pick({
  distanceM: true,
  legs: true,
});
const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const reading = z.number().finite().nullable();
const responseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly_units: z.object({
    time: z.literal('unixtime'),
    temperature_2m: z.literal('°C'),
    wind_speed_10m: z.literal('km/h'),
    wind_direction_10m: z.literal('°'),
    precipitation: z.literal('mm'),
    sunshine_duration: z.literal('s'),
    relative_humidity_2m: z.literal('%'),
    cloud_cover: z.literal('%'),
  }),
  hourly: z.object({
    time: z.array(z.number().int()),
    temperature_2m: z.array(reading),
    wind_speed_10m: z.array(reading),
    wind_direction_10m: z.array(reading),
    precipitation: z.array(reading),
    sunshine_duration: z.array(reading),
    relative_humidity_2m: z.array(reading),
    cloud_cover: z.array(reading),
  }),
});
const cachedResponseSchema = responseSchema.extend({
  retrievedAt: z.iso.datetime(),
});
export const evidenceSchema = z.object({
  version: z.literal(1),
  provider: z.literal('open-meteo'),
  model: z.enum(['ecmwf_ifs', 'era5']),
  basis: z.enum(['modelled-past', 'reanalysis']),
  retrievedAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  geometryBasis: z.literal('assumed-saved-route'),
  timingBasis: z.literal('constant-speed'),
  sampleCount: z.number(),
  completeSampleCount: z.number(),
  coverage: z.number(),
  features: featuresSchema.nullable(),
  quality: z.number(),
  baselineComfort: z.number().min(0).max(1),
  summary: z
    .object({
      temperatureC: z.number(),
      headwindKph: z.number(),
      crosswindKph: z.number(),
      rainMmH: z.number(),
      sunshineFraction: z.number(),
      humidityPercent: z.number(),
      cloudCoverFraction: z.number(),
    })
    .nullable(),
  locations: z.array(
    z.object({
      requestedLatitude: z.number(),
      requestedLongitude: z.number(),
      latitude: z.number(),
      longitude: z.number(),
    }),
  ),
  attribution: z.literal(
    'Weather data by Open-Meteo and ECMWF; route exposure estimated by Ride On.',
  ),
});
export type RideWeatherEvidence = z.infer<typeof evidenceSchema>;

export const collectRideWeather = async (
  db: D1Database,
  route: z.infer<typeof weatherRouteSchema>,
  timing: NonNullable<Experience['timing']>,
  now: Date,
  preferences = defaultSettings.preferences,
): Promise<RideWeatherEvidence> => {
  if (route.distanceM > 240_000) throw new Error('sampling-limit');
  const start = Date.parse(timing.startedAt);
  const finish = Date.parse(timing.finishedAt);
  const model = now.getTime() - finish >= 6 * DAY ? 'era5' : 'ecmwf_ifs';
  const count = Math.max(3, Math.min(12, Math.ceil(route.distanceM / 10_000)));
  const samples = Array.from({ length: count }, (_, i) => {
    const fraction = (i + 0.5) / count;
    const distance = route.distanceM * fraction;
    const leg = route.legs.find(
      (l) => l.fromM <= distance && distance <= l.toM,
    );
    if (!leg) throw new Error('geometry-unavailable');
    // A request-sharing lattice, not a claim of native model resolution.
    const latitude = Math.round(leg.coordinate.latitude * 20) / 20;
    const longitude = Math.round(leg.coordinate.longitude * 20) / 20;
    return {
      latitude,
      longitude,
      bearing: leg.bearingDegrees,
      at: start + (finish - start) * fraction,
      key: `${latitude},${longitude}`,
    };
  });
  const cells = [...new Map(samples.map((s) => [s.key, s])).values()];
  const first = new Date(Math.floor(start / HOUR) * HOUR)
    .toISOString()
    .slice(0, 10);
  const last = new Date(Math.ceil(finish / HOUR) * HOUR)
    .toISOString()
    .slice(0, 10);
  const responses = new Map<string, z.infer<typeof cachedResponseSchema>>();
  const missing: typeof cells = [];
  for (const cell of cells) {
    const key = `ride-weather-v1:${model}:${cell.key}:${first}:${last}`;
    const cached = await db
      .prepare(
        'SELECT payload_json FROM ride_weather_cache WHERE cache_key = ? AND expires_at > ?',
      )
      .bind(key, now.getTime())
      .first<{ payload_json: string }>();
    try {
      const parsed = cached
        ? cachedResponseSchema.safeParse(JSON.parse(cached.payload_json))
        : null;
      if (parsed?.success) {
        responses.set(cell.key, parsed.data);
        continue;
      }
    } catch {
      /* A corrupt cache entry is a miss. */
    }
    missing.push(cell);
  }
  if (missing.length) {
    const reserved = await db
      .prepare(
        'INSERT INTO ride_weather_usage(date, units) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET units = units + excluded.units WHERE units + excluded.units <= 300 RETURNING units',
      )
      .bind(now.toISOString().slice(0, 10), missing.length)
      .first();
    if (!reserved) throw new Error('budget-exhausted');
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.search = new URLSearchParams({
      latitude: missing.map((c) => c.latitude).join(','),
      longitude: missing.map((c) => c.longitude).join(','),
      start_date: first,
      end_date: last,
      models: model,
      hourly:
        'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,sunshine_duration,relative_humidity_2m,cloud_cover',
      timeformat: 'unixtime',
      timezone: 'UTC',
      wind_speed_unit: 'kmh',
    }).toString();
    const raw = await fetchEvidenceJson(url);
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length !== missing.length)
      throw new Error('invalid-provider-data');
    const statements: D1PreparedStatement[] = [];
    missing.forEach((cell, index) => {
      const parsed = {
        ...responseSchema.parse(list[index]),
        retrievedAt: now.toISOString(),
      };
      const hours = parsed.hourly;
      if (
        Object.values(hours).some((a) => a.length !== hours.time.length) ||
        hours.time.some(
          (t, i) => i > 0 && t - (hours.time[i - 1] ?? 0) !== 3600,
        ) ||
        haversineKm(
          [cell.latitude, cell.longitude],
          [parsed.latitude, parsed.longitude],
        ) > 40
      )
        throw new Error('invalid-provider-data');
      responses.set(cell.key, parsed);
      statements.push(
        db
          .prepare(
            'INSERT INTO ride_weather_cache VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at',
          )
          .bind(
            `ride-weather-v1:${model}:${cell.key}:${first}:${last}`,
            JSON.stringify(parsed),
            now.getTime() + (model === 'era5' ? 30 * DAY : 6 * HOUR),
          ),
      );
    });
    await db.batch(statements);
  }
  const rows = samples.flatMap((s) => {
    const response = responses.get(s.key);
    if (!response) return [];
    const h = response.hourly;
    const instant = h.time.indexOf(Math.round(s.at / HOUR) * 3600);
    // Accumulated precipitation/sunshine belong to the PRECEDING hour.
    const period = h.time.indexOf(Math.ceil(s.at / HOUR) * 3600);
    const temperature = h.temperature_2m[instant];
    const speed = h.wind_speed_10m[instant];
    const direction = h.wind_direction_10m[instant];
    const rain = h.precipitation[period];
    const sunshine = h.sunshine_duration[period];
    const humidity = h.relative_humidity_2m[instant];
    const cloud = h.cloud_cover[instant];
    if (
      temperature == null ||
      speed == null ||
      direction == null ||
      rain == null ||
      sunshine == null ||
      humidity == null ||
      cloud == null ||
      cloud < 0 ||
      cloud > 100 ||
      temperature < -70 ||
      temperature > 60 ||
      speed < 0 ||
      speed > 250 ||
      direction < 0 ||
      direction > 360 ||
      rain < 0 ||
      rain > 500 ||
      sunshine < 0 ||
      sunshine > 3600 ||
      humidity < 0 ||
      humidity > 100
    )
      return [];
    const angle = ((direction - s.bearing) * Math.PI) / 180;
    const headwind = Math.max(0, speed * Math.cos(angle));
    const crosswind = Math.abs(speed * Math.sin(angle));
    return [
      {
        temperature,
        headwind,
        crosswind,
        rain,
        sunshine: sunshine / 3600,
        humidity,
        cloud: cloud / 100,
        cold: clamp((preferences.temperature.comfortMinC - temperature) / 10),
        heat: clamp((temperature - preferences.temperature.comfortMaxC) / 10),
        wind: 1 - windComfort(headwind, crosswind, 0, preferences.wind),
        rainFeature: clamp(rain / 2),
        shade: 1 - sunshine / 3600,
      },
    ];
  });
  const mean = (key: keyof (typeof rows)[number]) =>
    rows.reduce((s, r) => s + r[key], 0) / rows.length;
  const complete = rows.length === samples.length;
  const weights = preferences.weights;
  const weightTotal =
    weights.temperature +
    weights.wind +
    weights.dryness +
    weights.sunshine +
    weights.clearSkies;
  const retrospectiveBaseline =
    !complete || weightTotal === 0
      ? 0.5
      : clamp(
          1 -
            (weights.temperature * Math.max(mean('cold'), mean('heat')) +
              weights.wind * mean('wind') +
              weights.dryness * mean('rainFeature') +
              weights.sunshine * mean('shade') +
              weights.clearSkies * mean('cloud')) /
              weightTotal,
        );
  return {
    version: 1,
    provider: 'open-meteo',
    model,
    basis: model === 'era5' ? 'reanalysis' : 'modelled-past',
    retrievedAt:
      [...responses.values()].map((r) => r.retrievedAt).sort()[0] ??
      now.toISOString(),
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt,
    geometryBasis: 'assumed-saved-route',
    timingBasis: 'constant-speed',
    sampleCount: samples.length,
    completeSampleCount: rows.length,
    coverage: rows.length / samples.length,
    features: complete
      ? {
          cold: mean('cold'),
          heat: mean('heat'),
          wind: mean('wind'),
          rain: mean('rainFeature'),
          shade: mean('shade'),
        }
      : null,
    quality: complete ? (model === 'era5' ? 0.6 : 0.35) : 0,
    baselineComfort: retrospectiveBaseline,
    summary: complete
      ? {
          temperatureC: mean('temperature'),
          headwindKph: mean('headwind'),
          crosswindKph: mean('crosswind'),
          rainMmH: mean('rain'),
          sunshineFraction: mean('sunshine'),
          humidityPercent: mean('humidity'),
          cloudCoverFraction: mean('cloud'),
        }
      : null,
    locations: cells.flatMap((cell) => {
      const response = responses.get(cell.key);
      return response
        ? [
            {
              requestedLatitude: cell.latitude,
              requestedLongitude: cell.longitude,
              latitude: response.latitude,
              longitude: response.longitude,
            },
          ]
        : [];
    }),
    attribution:
      'Weather data by Open-Meteo and ECMWF; route exposure estimated by Ride On.',
  };
};
