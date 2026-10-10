import { requiredWeather } from '../../src/recommendations/engine.ts';
import { recommendationSchema } from '../../src/recommendations/input.ts';
import { importGpx } from '../../src/routes/gpx.ts';
import type { Route } from '../../src/routes/model.ts';
import type {
  ForecastDescriptor,
  LocationForecastResult,
} from '../../src/weather/contracts.ts';
export const simpleGpx =
  '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test ride</name><trkseg><trkpt lat="51.5" lon="-0.1"><ele>10</ele></trkpt><trkpt lat="51.52" lon="-0.1"><ele>20</ele></trkpt></trkseg></trk></gpx>';
export const makeRoute = async (overrides: Partial<Route> = {}) => {
  const route = await importGpx(simpleGpx);
  return { ...route, ...overrides };
};
const hour = 3_600_000;
export const now = new Date('2026-10-09T12:00:00Z');
export const inputFor = (
  routes: readonly Route[],
  changes: Record<string, unknown> = {},
) =>
  recommendationSchema.parse({
    routeIds: routes.map((route) => route.id),
    date: '2026-10-10',
    ...changes,
  });
export const forecastsFor = (
  routes: readonly Route[],
  value: (
    quantity: string,
    hour: number,
    route: Route,
    locationIndex: number,
  ) => number | null = defaultValue,
  required: readonly ForecastDescriptor[] = requiredWeather,
): LocationForecastResult[] =>
  routes.flatMap((route) =>
    route.weatherLocations.map((location, index) => ({
      status: 'complete' as const,
      location: {
        requested: location,
        coordinate: location.coordinate,
        sourceLocationId: null,
        distanceFromRequestedM: 0,
        method: 'exact' as const,
      },
      provenance: {
        source: {
          providerId: 'fixture',
          productId: 'hourly',
          adapterVersion: '1',
        },
        dataVersion: now.toISOString(),
        forecastRunAt: now.toISOString(),
        retrievedAt: now.toISOString(),
        attribution: [],
      },
      issuedAt: null,
      issues: [],
      series: required.map((descriptor: ForecastDescriptor) => ({
        descriptor,
        samples: Array.from({ length: 25 }, (_, h) => {
          const valid = Date.parse('2026-10-10T00:00:00Z') + h * hour;
          const quantity =
            descriptor.kind === 'scalar'
              ? descriptor.measure.quantity
              : descriptor.kind === 'category'
                ? 'sky-condition'
                : 'probability';
          return {
            validAt: new Date(valid).toISOString(),
            value: value(quantity, h, route, index),
            time:
              quantity === 'probability'
                ? {
                    kind: 'period' as const,
                    range: {
                      start: new Date(valid - hour / 2).toISOString(),
                      end: new Date(valid + hour / 2).toISOString(),
                    },
                    aggregation: 'event' as const,
                  }
                : quantity === 'wind-gust'
                  ? {
                      kind: 'period' as const,
                      range: {
                        start: new Date(valid - hour).toISOString(),
                        end: new Date(valid).toISOString(),
                      },
                      aggregation: 'maximum' as const,
                    }
                  : {
                      kind: 'instant' as const,
                      at: new Date(valid).toISOString(),
                    },
          };
        }),
      })),
    })),
  );
export function defaultValue(quantity: string) {
  return quantity === 'air-temperature'
    ? 18
    : quantity === 'wind-from-direction'
      ? 180
      : quantity === 'wind-speed'
        ? 4
        : quantity === 'wind-gust'
          ? 5
          : 0;
}

export const present = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
};
