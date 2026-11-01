import type { Route } from '../routes/model.ts';
import { DAY, dateKey, dayStart, HOUR, hourFloor } from './contracts.ts';
import { routeExposure } from './spatial.ts';
import {
  CONDITIONS,
  estimateGround,
  type GroundEvidence,
  materialFor,
  WETNESS_MODEL,
  wetnessTimeline,
} from './wetness.ts';

export const MAX_ASSESSMENT_SECTIONS = 12_000;
export const finishTime = (route: Route, departure: number, speedKph: number) =>
  departure + (route.distanceM / (speedKph * 1000)) * HOUR;

export const assessmentWindowError = (
  routes: readonly Route[],
  departure: number,
  speedKph: number,
  issuedAt: number,
) => {
  if (departure < issuedAt)
    return 'Ground assessments require a present or future departure; historical replay is not supported.';
  const lastHour = dayStart(dateKey(issuedAt)) + 7 * DAY - HOUR;
  if (routes.some((route) => finishTime(route, departure, speedKph) > lastHour))
    return 'All rides must finish within the available seven-calendar-day ground forecast window (ending at 23:00 UTC).';
  if (
    routes.reduce(
      (sum, route) => sum + routeExposure(route, false).sections.length,
      0,
    ) > MAX_ASSESSMENT_SECTIONS
  )
    return 'This assessment exceeds 12000 ground sections. Request fewer routes.';
  return null;
};

/** Constant-speed midpoint arrival, matching weather ranking's timing model. */
export const assessGround = (
  routes: readonly Route[],
  evidence: GroundEvidence,
  departure: number,
  speedKph: number,
  issuedAt: number,
) => {
  const through = hourFloor(
    Math.max(...routes.map((route) => finishTime(route, departure, speedKph))),
  );
  const timelines = new Map(
    evidence.cells.map((cell) => [
      cell.id,
      wetnessTimeline(cell, issuedAt, through),
    ]),
  );
  return {
    schemaVersion: 1,
    experimental: true,
    scoringApplied: false,
    modelVersion: WETNESS_MODEL.version,
    calibrationStatus: 'uncalibrated',
    issuedAt: new Date(issuedAt).toISOString(),
    departureAt: new Date(departure).toISOString(),
    averageSpeedKph: speedKph,
    timing: {
      method: 'constant-speed-section-midpoint',
      accumulationCutoff: 'last-completed-hour-before-arrival',
      partialHourIncluded: false,
      breaksIncluded: false,
    },
    source: evidence.source,
    requestGrid: evidence.requestGrid,
    cellCoverage: evidence.coverage,
    usage: evidence.usage,
    // Retain evidence provenance without returning the full hourly payload again.
    cells: evidence.cells.map(
      ({ hours: _hours, history: _history, ...cell }) => cell,
    ),
    routes: routes.map((route) => {
      const exposure = routeExposure(route, false);
      const sections = exposure.sections.map((section) => {
        const arrival =
          departure +
          ((section.fromM + section.toM) / 2 / (speedKph * 1000)) * HOUR;
        const cutoff = hourFloor(arrival);
        const snapshot = timelines.get(section.cellId)?.get(cutoff);
        const material = materialFor(section.surface);
        return {
          ...section,
          material,
          arrivalAt: new Date(arrival).toISOString(),
          evidenceThrough: new Date(cutoff).toISOString(),
          unassessedMinutesBeforeArrival:
            Math.round(((arrival - cutoff) / 60_000) * 10) / 10,
          weatherCoverage: snapshot
            ? {
                expectedHours: snapshot.expectedHours,
                completeHours: snapshot.completeHours,
                forecastHours: snapshot.forecastHours,
                staleHours: snapshot.staleHours,
              }
            : null,
          ...estimateGround(snapshot, material),
        };
      });
      const distanceWhere = (
        matches: (s: (typeof sections)[number]) => boolean,
      ) =>
        sections.reduce(
          (sum, s) => sum + (matches(s) ? s.toM - s.fromM : 0),
          0,
        );
      const exposureM = distanceWhere(() => true);
      const estimatedM = distanceWhere((s) => s.status === 'estimated');
      let longest: { fromM: number; toM: number; distanceM: number } | null =
        null;
      let runStart = 0;
      let runEnd = -1;
      for (const section of sections) {
        if (
          section.status === 'estimated' &&
          (section.condition === 'muddy' || section.condition === 'difficult')
        ) {
          if (runEnd !== section.fromM) runStart = section.fromM;
          runEnd = section.toM;
          const distanceM = runEnd - runStart;
          if (!longest || distanceM > longest.distanceM)
            longest = { fromM: runStart, toM: runEnd, distanceM };
        } else runEnd = -1;
      }
      return {
        routeId: route.id,
        sourceHash: route.sourceHash,
        finishAt: new Date(
          finishTime(route, departure, speedKph),
        ).toISOString(),
        status: exposureM ? 'experimental' : 'not-applicable',
        confidence: !exposureM
          ? 'not-applicable'
          : estimatedM
            ? 'low'
            : 'unknown',
        coverage: {
          routeDistanceM: route.distanceM,
          exposureM,
          estimatedM,
          unknownM: exposureM - estimatedM,
          excludedPavedOrNonCyclingM: route.distanceM - exposureM,
          unresolvedMaterialM: distanceWhere(
            (s) => s.material === 'unresolved',
          ),
          freezeThawUncertainM: distanceWhere(
            (s) => s.status === 'freeze-thaw-uncertain',
          ),
          omittedCellM: distanceWhere((s) => !timelines.has(s.cellId)),
          estimatedFractionOfExposure: exposureM
            ? estimatedM / exposureM
            : null,
        },
        estimatedDistanceM: Object.fromEntries(
          CONDITIONS.map((condition) => [
            condition,
            distanceWhere(
              (s) => s.status === 'estimated' && s.condition === condition,
            ),
          ]),
        ),
        muddyOrDifficultM: {
          // Scenario bounds apply only to sections with a known surface response.
          // Unknown/unassessed distance is reported separately, never set to firm.
          lowerScenario: distanceWhere(
            (s) =>
              s.status === 'estimated' &&
              !!s.range &&
              CONDITIONS.indexOf(s.range.lower) >= 2,
          ),
          centralScenario: distanceWhere(
            (s) =>
              s.status === 'estimated' &&
              !!s.condition &&
              CONDITIONS.indexOf(s.condition) >= 2,
          ),
          upperScenario: distanceWhere(
            (s) =>
              s.status === 'estimated' &&
              !!s.range &&
              CONDITIONS.indexOf(s.range.upper) >= 2,
          ),
        },
        longestEstimatedMuddyStretch: longest,
        sections,
      };
    }),
  };
};
