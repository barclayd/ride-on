import {
  DAY,
  dayStart,
  type GroundHour,
  HOUR,
  hourFloor,
} from '../../src/ground/contracts.ts';
import { collectGroundEvidence } from '../../src/ground/service.ts';
import type { Route } from '../../src/routes/model.ts';

export const GROUND_NOW = Date.parse('2026-10-09T12:00:00Z');
export const wetnessEvidence = (
  routes: Route[],
  transform: (hour: GroundHour) => GroundHour = (hour) => hour,
  now = GROUND_NOW,
) =>
  collectGroundEvidence(
    routes,
    {
      read: async () => [],
      write: async () => {},
      prune: async () => {},
      acquire: async () => true,
      release: async () => {},
      reserve: async () => true,
    },
    {
      id: 'synthetic',
      model: 'synthetic',
      version: '1',
      attribution: {
        text: 'Synthetic test data',
        url: 'https://example.com',
        licence: 'test',
      },
      fetch: async (point, from, to) => ({
        gridCoordinate: point,
        hours: Array.from(
          { length: (dayStart(to) - dayStart(from) + DAY) / HOUR },
          (_, i) => {
            const end = dayStart(from) + i * HOUR;
            return transform({
              end: new Date(end).toISOString(),
              rainMm: 0,
              precipitationMm: 0,
              snowfallCm: 0,
              referenceEt0Mm: 0.1,
              temperatureC: 15,
              basis: end <= hourFloor(now) ? 'modelled-past' : 'forecast',
            });
          },
        ),
      }),
    },
    new Date(now),
  );
