import type { Route } from '../routes/model.ts';
import type { GroundCache } from './cache.ts';
import {
  DAY,
  dateKey,
  dayStart,
  type GroundDay,
  type GroundHour,
  type GroundProvider,
  HOUR,
  hourFloor,
} from './contracts.ts';
import { routeExposure } from './spatial.ts';
import { summarizeHours } from './summary.ts';

export const MAX_GROUND_CELLS = 12;
export const missingHour = (end: number, nowMs: number): GroundHour => ({
  end: new Date(end).toISOString(),
  precipitationMm: null,
  rainMm: null,
  snowfallCm: null,
  referenceEt0Mm: null,
  temperatureC: null,
  basis: end <= hourFloor(nowMs) ? 'modelled-past' : 'forecast',
});
export const refreshAfter = (
  date: string,
  nowMs: number,
  complete: boolean,
) => {
  if (!complete) return nowMs + 15 * 60_000;
  const age = (dayStart(dateKey(nowMs)) - dayStart(date)) / DAY;
  return nowMs + (age >= 3 ? 90 * 24 : age > 0 ? 6 : age >= -1 ? 3 : 12) * HOUR;
};

/** Explicit diagnostics only. Recommendation/preference paths never call this service. */
export const collectGroundEvidence = async (
  routes: readonly Route[],
  cache: GroundCache,
  provider: GroundProvider,
  now: Date,
) => {
  const nowMs = now.getTime();
  const started = Date.now();
  const asOf = hourFloor(nowMs);
  const today = dayStart(dateKey(nowMs));
  const dates = Array.from({ length: 35 }, (_, i) =>
    dateKey(today + (i - 28) * DAY),
  );
  const first = dates[0] as string;
  const last = dates.at(-1) as string;
  const exposures = routes.map(routeExposure);
  const unique = new Map(
    exposures.flatMap((route) =>
      route.cells.map((cell) => [cell.id, cell] as const),
    ),
  );
  // Stable independent of input route order; omitted coverage is explicit below.
  const selected = [...unique.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_GROUND_CELLS);
  const usage = {
    httpRequests: 0,
    estimatedWeightedCalls: 0,
    reservedUnits: 0,
    actualBillableCalls: null,
    billingStatus: 'not-reported-by-provider' as const,
  };
  await cache.prune(nowMs);
  const cells = [];
  for (const cell of selected) {
    const key = `${provider.id}:${provider.model}:${provider.version}:${cell.id}`;
    const stored = new Map(
      (await cache.read(key, first, last, nowMs)).map((day) => [day.date, day]),
    );
    const staleDates = dates.filter(
      (date) =>
        !stored.has(date) ||
        Date.parse(stored.get(date)?.refreshAt ?? '') <= nowMs,
    );
    let refreshStatus:
      | 'cached'
      | 'refreshed'
      | 'pending'
      | 'budget-exhausted'
      | 'provider-unavailable' = 'cached';
    if (staleDates.length) {
      const token = crypto.randomUUID();
      if (!(await cache.acquire(key, nowMs + Date.now() - started, token)))
        refreshStatus = 'pending';
      else {
        try {
          // Another request may have filled the cache between our read and lease.
          for (const day of await cache.read(key, first, last, nowMs))
            stored.set(day.date, day);
          const remaining = staleDates.filter(
            (date) =>
              !stored.has(date) ||
              Date.parse(stored.get(date)?.refreshAt ?? '') <= nowMs,
          );
          staleDates.splice(0, staleDates.length, ...remaining);
          if (staleDates.length) {
            const from = staleDates[0] as string;
            const to = staleDates.at(-1) as string;
            const daysRequested = (dayStart(to) - dayStart(from)) / DAY + 1;
            // Five variables, one model/location; estimate per the public pricing
            // rule. Provider responses do not disclose the actual billed weight.
            const estimate = Math.max(1, daysRequested / 14);
            const units = Math.ceil(estimate);
            if (!(await cache.reserve(dateKey(nowMs), units)))
              refreshStatus = 'budget-exhausted';
            else {
              usage.httpRequests++;
              usage.estimatedWeightedCalls += estimate;
              usage.reservedUnits += units;
              const fetched = await provider
                .fetch(cell, from, to, now)
                .catch(() => null);
              if (!fetched) {
                // Keep older evidence with its original provenance and stale flag.
                refreshStatus = 'provider-unavailable';
              } else {
                const byTime = new Map(
                  fetched.hours.map((hour) => [Date.parse(hour.end), hour]),
                );
                const refreshed: GroundDay[] = staleDates.map((date) => {
                  const hours = Array.from(
                    { length: 24 },
                    (_, i) =>
                      byTime.get(dayStart(date) + i * HOUR) ??
                      missingHour(dayStart(date) + i * HOUR, nowMs),
                  );
                  const complete = hours.every(
                    (hour) =>
                      hour.rainMm !== null &&
                      hour.referenceEt0Mm !== null &&
                      hour.precipitationMm !== null &&
                      hour.snowfallCm !== null &&
                      hour.temperatureC !== null,
                  );
                  return {
                    date,
                    retrievedAt: now.toISOString(),
                    refreshAt: new Date(
                      refreshAfter(date, nowMs, complete),
                    ).toISOString(),
                    gridCoordinate: fetched.gridCoordinate,
                    hours,
                  };
                });
                await cache.write(key, refreshed, nowMs);
                for (const day of refreshed) stored.set(day.date, day);
                refreshStatus = 'refreshed';
              }
            }
          }
        } finally {
          await cache.release(key, token);
        }
      }
    }
    const hours = dates.flatMap(
      (date) =>
        stored.get(date)?.hours ??
        Array.from({ length: 24 }, (_, i) =>
          missingHour(dayStart(date) + i * HOUR, nowMs),
        ),
    );
    cells.push({
      ...cell,
      refreshStatus,
      days: dates.map((date) => {
        const day = stored.get(date);
        return {
          date,
          retrievedAt: day?.retrievedAt ?? null,
          refreshAt: day?.refreshAt ?? null,
          gridCoordinate: day?.gridCoordinate ?? null,
          stale: !!day && Date.parse(day.refreshAt) <= nowMs,
        };
      }),
      history: [24, 72, 168, 336, 672].map((count) => ({
        hours: count,
        ...summarizeHours(hours, asOf, count),
      })),
      hours,
    });
  }
  const included = new Set(selected.map((cell) => cell.id));
  return {
    schemaVersion: 1,
    experimental: true,
    scoringApplied: false,
    asOf: new Date(asOf).toISOString(),
    source: {
      providerId: provider.id,
      model: provider.model,
      adapterVersion: provider.version,
      modelRunAt: null,
      attribution: provider.attribution,
    },
    requestGrid: {
      version: 'lattice-v1',
      cellSizeDegrees: 0.05,
      nativeModelGrid: false,
    },
    coverage: {
      requiredCells: unique.size,
      requestedCells: selected.length,
      omittedCellIds: [...unique.keys()].filter((id) => !included.has(id)),
      maxCells: MAX_GROUND_CELLS,
    },
    routes: exposures.map(({ cells: _cells, ...route }) => ({
      ...route,
      status: route.sections.length ? 'evidence-requested' : 'not-applicable',
      omittedM: route.sections
        .filter((section) => !included.has(section.cellId))
        .reduce((sum, section) => sum + section.toM - section.fromM, 0),
    })),
    usage: {
      ...usage,
      estimatedWeightedCalls:
        Math.round(usage.estimatedWeightedCalls * 1000) / 1000,
      dailyReservedUnitLimit: 400,
    },
    cells,
  };
};
