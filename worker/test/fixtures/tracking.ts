import { recommendRides } from '../../src/recommendations/engine.ts';
import type { Snapshot } from '../../src/tracking/model.ts';
import { forecastsFor, inputFor, makeRoute, now, present } from './rides.ts';
export const trackingSnapshot = async (): Promise<Snapshot> => {
  const route = await makeRoute(),
    input = inputFor([route]);
  const candidate = present(
    present(
      recommendRides([route], input, forecastsFor([route]), now.getTime())
        .rankings[0],
    ).best,
  );
  if (!candidate) throw new Error('Missing assessed fixture');
  const pick = {
    routeId: route.id,
    candidate: { ...candidate, score: 80, recommendationPriority: 80 },
  };
  return {
    pick,
    context: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      algorithmVersion: 'test',
      inputs: [input],
      routes: [],
      history: {
        revision: 0,
        status: 'ready',
        matcherVersion: 'test',
        reasonCode: null,
        affectedRideIds: [],
        affectedRouteIds: [],
      },
      weather: {
        refreshAt: '2026-10-10T20:00:00.000Z',
        selectedSource: null,
        locations: [],
      } as unknown as Snapshot['context']['weather'],
      best: pick,
      coverageComplete: true,
      eligibleDepartures: 10,
      assessmentFreshUntil: '2026-10-10T20:00:00.000Z',
    },
  };
};
