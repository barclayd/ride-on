import type { Route } from '../../src/routes/model.ts';

export const groundRoute = (
  surface: 'paved' | 'gravel' | 'unknown' = 'gravel',
  longitude = -0.1,
): Route => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  name: 'Synthetic ground test',
  createdAt: '2026-10-09T12:00:00.000Z',
  sourceHash: 'synthetic-hash',
  distanceM: 1000,
  ascentM: 0,
  originalPointCount: 3,
  warnings: [],
  legs: [0, 500].map((fromM) => ({
    fromM,
    toM: fromM + 500,
    coordinate: { latitude: 51.5, longitude },
    bearingDegrees: 180,
    weatherLocationId: 'synthetic',
  })),
  weatherLocations: [0, 1000].map((distanceM) => ({
    id: String(distanceM),
    distanceM,
    coordinate: { latitude: 51.5, longitude },
  })),
  surface: {
    schemaVersion: 1,
    source: {
      providerId: 'cycle-travel',
      method: 'route-instructions',
      formatVersion: 2,
      mappingVersion: 1,
    },
    geometryDistanceM: 1000,
    sourceHash: 'synthetic-hash',
    capturedAt: '2026-10-09T12:00:00.000Z',
    sections: [{ fromM: 0, toM: 1000, surface, sourceCode: 'synthetic' }],
  },
});
export const groundResponse = (url: URL) => {
  const start = Date.parse(`${url.searchParams.get('start_date')}T00:00:00Z`);
  const end =
    Date.parse(`${url.searchParams.get('end_date')}T00:00:00Z`) + 86400000;
  const time = Array.from(
    { length: (end - start) / 3600000 },
    (_, i) => (start + i * 3600000) / 1000,
  );
  return {
    latitude: Number(url.searchParams.get('latitude')),
    longitude: Number(url.searchParams.get('longitude')),
    utc_offset_seconds: 0,
    hourly_units: {
      time: 'unixtime',
      precipitation: 'mm',
      rain: 'mm',
      snowfall: 'cm',
      temperature_2m: '°C',
      et0_fao_evapotranspiration: 'mm',
    },
    hourly: {
      time,
      precipitation: time.map(() => 1 as number | null),
      rain: time.map(() => 1 as number | null),
      snowfall: time.map(() => 0 as number | null),
      temperature_2m: time.map(() => 10 as number | null),
      et0_fao_evapotranspiration: time.map(() => 0.1 as number | null),
    },
  };
};
