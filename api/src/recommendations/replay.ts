import type { prepareHistory } from '../rides/overlap.ts';
import type { Route } from '../routes/model.ts';
import type { LocationForecastResult } from '../weather/contracts.ts';
import { planDepartures } from './daylight.ts';
import { recommendRides } from './engine.ts';
import type { RecommendationInput } from './input.ts';

export const createScoreReplay = (
  routes: readonly Route[],
  input: RecommendationInput,
  weather: readonly LocationForecastResult[],
  nowMs: number,
  maxLocationDistanceM: number,
  alternatives: number,
  history: ReturnType<typeof prepareHistory>,
) => {
  const { assess, ...metadata } = history;
  return {
    routes,
    input,
    weather,
    nowMs,
    maxLocationDistanceM,
    alternatives,
    history: {
      ...metadata,
      assessments: routes.flatMap((route) =>
        planDepartures(route, input, nowMs).departures.map((departure) => {
          const departureAt = new Date(departure).toISOString();
          return {
            routeId: route.id,
            departureAt,
            evidence: assess(route.id, departureAt),
          };
        }),
      ),
    },
  };
};
export type ScoreReplay = ReturnType<typeof createScoreReplay>;

/** Replay scoring from JSON evidence without provider, database or network access.
 * Recent-ride overlap is an explicit input, not the rider's private history. */
export const replayScore = (replay: ScoreReplay) => {
  const history = new Map(
    replay.history.assessments.map((row) => [
      `${row.routeId}:${row.departureAt}`,
      row.evidence,
    ]),
  );
  return recommendRides(
    replay.routes,
    replay.input,
    replay.weather,
    replay.nowMs,
    replay.maxLocationDistanceM,
    replay.alternatives,
    {
      ...replay.history,
      assess: (routeId, departureAt) => {
        const evidence = history.get(`${routeId}:${departureAt}`);
        if (!evidence)
          throw new Error(
            'Replay is missing recent-ride evidence for this departure.',
          );
        return evidence;
      },
    },
  );
};
