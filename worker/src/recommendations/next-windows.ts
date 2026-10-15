import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { rideDate } from '../rides/store.ts';
import type { Route } from '../routes/model.ts';
import { ALGORITHM_VERSION, orderDepartures } from './engine.ts';
import {
  recommendationRequestSchema,
  recommendationWithSettings,
  resolvedRecommendationSchema,
  type Settings,
  settingsPatchSchema,
} from './input.ts';
import { preferenceLevels } from './levels.ts';
import { mergeDays } from './multi-day.ts';
import { datesBetween, localDate, ridingWindowSchema } from './planning.ts';
import { presentRoute, verdictFor } from './presentation.ts';
import { type ComparisonContext, evaluateComparisons } from './service.ts';

export const nextWindowsSchema = settingsPatchSchema.safeExtend({
  routeIds: recommendationRequestSchema.shape.routeIds,
  after: z.strictObject({ date: rideDate, window: ridingWindowSchema }),
});
type NextWindowsRequest = z.infer<typeof nextWindowsSchema>;
/** Calendar policy is separate from evaluation and presentation; future presets
 * can reuse the same comparison service without additional forecast fan-out. */
export const nextWindowSearches = (
  after: NextWindowsRequest['after'],
  timeZone: string,
  now: Date,
) => {
  const today = localDate(now, timeZone);
  if (Temporal.PlainDate.compare(after.date, today) > 0)
    throw new AppError(
      400,
      'FUTURE_WINDOW',
      'The previous window date must be today or earlier.',
    );
  const tomorrow = today.add({ days: 1 }).toString();
  const earliest = today.add({ days: 2 });
  const weekday = Temporal.PlainDate.from(after.date).dayOfWeek;
  const sameWeekday = earliest
    .add({ days: (weekday - earliest.dayOfWeek + 7) % 7 })
    .toString();
  return [
    { kind: 'tomorrow' as const, dates: [tomorrow], window: after.window },
    {
      kind: 'same_weekday' as const,
      dates: [sameWeekday],
      window: after.window,
    },
    {
      kind: 'best_next_days' as const,
      dates: datesBetween(tomorrow, today.add({ days: 6 }).toString()),
      window: 'daylight' as const,
    },
  ];
};
const keyFor = (date: string, window: z.infer<typeof ridingWindowSchema>) =>
  JSON.stringify([date, window]);

export const recommendNextWindows = async (
  raw: NextWindowsRequest,
  settings: Settings,
  routes: readonly Route[],
  context: ComparisonContext,
) => {
  const searches = nextWindowSearches(
    raw.after,
    settings.timeZone,
    context.startedAt,
  );
  if (routes.length !== raw.routeIds.length)
    throw new AppError(
      404,
      'ROUTE_NOT_FOUND',
      'One or more routes were not found.',
    );
  const inputs = new Map<
    string,
    z.infer<typeof resolvedRecommendationSchema>
  >();
  const invalid = new Set<string>();
  for (const search of searches)
    for (const date of search.dates) {
      const key = keyFor(date, search.window);
      if (inputs.has(key) || invalid.has(key)) continue;
      const parsed = resolvedRecommendationSchema.safeParse(
        recommendationWithSettings(
          {
            routeIds: raw.routeIds,
            date,
            riding: { ...settings.riding, window: search.window },
          },
          settings,
        ),
      );
      if (parsed.success) inputs.set(key, parsed.data);
      else invalid.add(key); // A generated local clock time may be skipped/repeated at DST.
    }
  const basis = inputs.values().next().value;
  if (!basis)
    throw new Error('The daylight search must supply a valid comparison.');
  const shared = await evaluateComparisons(
    routes,
    [...inputs.values()],
    basis,
    context,
  );
  const byKey = new Map(
    shared.comparisons.map((item) => [
      keyFor(item.input.date, item.input.riding.window),
      item,
    ]),
  );
  const evaluated = searches.map((search) => {
    const comparisons = search.dates.flatMap((date) => {
      const comparison = byKey.get(keyFor(date, search.window));
      return comparison ? [comparison] : [];
    });
    const evaluation = mergeDays(
      comparisons.map((item) => item.result),
      Object.keys(settings.preferences.minimumStandards).length > 0,
    );
    const route = evaluation.rankings[0];
    const days = search.dates.map(
      (date) =>
        byKey.get(keyFor(date, search.window))?.summary ?? {
          date,
          availability: 'none',
          availabilityReason: 'invalid_window_time',
        },
    );
    const diagnostic = {
      kind: search.kind,
      searchRange: { start: search.dates[0], end: search.dates.at(-1) },
      days,
    };
    return {
      diagnostic,
      route,
      window: search.window,
      minimumStandardsStatus: evaluation.minimumStandardsStatus,
      message: evaluation.message,
      unranked: evaluation.unranked.map((item) => ({
        routeId: item.routeId,
        verdict: verdictFor(item),
      })),
    };
  });
  type Window = ReturnType<typeof toWindow>;
  const toWindow = (
    item: (typeof evaluated)[number],
    route: NonNullable<typeof item.route>,
    best: NonNullable<typeof route.best>,
  ) => ({
    ...item.diagnostic,
    date: best.date,
    window: item.window,
    effectiveWindow: route.effectiveWindow,
    minimumStandardsStatus: item.minimumStandardsStatus,
    recommendationKind:
      best.standards.status === 'meets' ||
      best.standards.status === 'not_configured'
        ? 'best_pick'
        : 'best_available',
    message: item.message,
    verdict: verdictFor(route),
    coverage: presentRoute(route, settings.riding.departureStepMinutes)
      .coverage,
    warnings: route.warnings,
    best: { routeId: route.routeId, routeName: route.routeName, ...best },
  });
  const windows: Window[] = [];
  const omitted: ((typeof evaluated)[number]['diagnostic'] & {
    reasonCode: string;
    unranked: (typeof evaluated)[number]['unranked'];
  })[] = [];
  for (const item of evaluated) {
    const best = item.route?.best;
    if (!item.route || !best) {
      omitted.push({
        ...item.diagnostic,
        reasonCode: 'no_ranked_ride',
        unranked: item.unranked,
      });
      continue;
    }
    if (
      item.diagnostic.kind === 'best_next_days' &&
      windows.some(
        (w) =>
          w.best.routeId === item.route?.routeId &&
          w.best.departureAt === best.departureAt,
      )
    ) {
      omitted.push({
        ...item.diagnostic,
        reasonCode: 'duplicate',
        unranked: [],
      });
      continue;
    }
    windows.push(toWindow(item, item.route, best));
  }
  const recommended = [...windows].sort(
    (a, b) =>
      orderDepartures(a.best, b.best) ||
      a.best.routeId.localeCompare(b.best.routeId),
  )[0];
  return {
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: context.startedAt.toISOString(),
    timeZone: settings.timeZone,
    windows,
    omitted,
    recommendedKind: recommended?.kind ?? null,
    resolvedPreferences: settings.preferences,
    preferenceLevels: preferenceLevels(settings.preferences),
    riding: settings.riding,
    forecast: settings.forecast,
    history: shared.history,
    weather: shared.weather,
  };
};
