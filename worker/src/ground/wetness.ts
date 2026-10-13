import { DAY, dateKey, HOUR, hourFloor } from './contracts.ts';
import type { collectGroundEvidence } from './service.ts';

export type GroundEvidence = Awaited<ReturnType<typeof collectGroundEvidence>>;
type EvidenceCell = GroundEvidence['cells'][number];

/** Engineering scenarios for calibration, NOT measured soil parameters. */
export const WETNESS_MODEL = {
  version: 'ground-experimental-v0.1',
  backgroundHours: 28 * 24,
  capacityMm: 60,
  scenarios: {
    lower: { initialMm: 0, drainageHalfLifeHours: 36, et0Factor: 1.2 },
    central: { initialMm: 30, drainageHalfLifeHours: 72, et0Factor: 0.8 },
    upper: { initialMm: 60, drainageHalfLifeHours: 168, et0Factor: 0.4 },
  },
  responseThresholdsMm: {
    granular: [8, 20, 40],
    soft: [3, 10, 25],
  },
  thawLookbackHours: 72,
} as const;
export const CONDITIONS = ['firm', 'soft', 'muddy', 'difficult'] as const;
export type GroundCondition = (typeof CONDITIONS)[number];
export type Material = 'granular' | 'soft' | 'unresolved';
export const materialFor = (surface: string): Material =>
  ['gravel', 'compacted'].includes(surface)
    ? 'granular'
    : ['earth', 'dirt', 'grass'].includes(surface)
      ? 'soft'
      : 'unresolved';

export type WetnessSnapshot = {
  lower: number;
  central: number;
  upper: number;
  expectedHours: number;
  completeHours: number;
  forecastHours: number;
  staleHours: number;
  futureRetrievalHours: number;
  freezing: boolean;
  thawing: boolean;
  snowInWindow: boolean;
};

const advance = (
  storage: number,
  rain: number,
  et0: number,
  scenario: (typeof WETNESS_MODEL.scenarios)[keyof typeof WETNESS_MODEL.scenarios],
) =>
  Math.min(
    WETNESS_MODEL.capacityMm,
    Math.max(
      0,
      storage * 2 ** (-1 / scenario.drainageHalfLifeHours) +
        rain -
        scenario.et0Factor * et0,
    ),
  );

/** One pass per cell; sections share snapshots. No I/O, clock or route facts. */
const buildTimeline = (
  cell: EvidenceCell,
  issuedAt: number,
  through: number,
  evidenceAvailableAt: number,
) => {
  const start = hourFloor(issuedAt) - WETNESS_MODEL.backgroundHours * HOUR;
  const hours = new Map(cell.hours.map((h) => [Date.parse(h.end), h]));
  const days = new Map(cell.days.map((day) => [day.date, day]));
  const snapshots = new Map<number, WetnessSnapshot>();
  let lower = WETNESS_MODEL.scenarios.lower.initialMm as number;
  let central = WETNESS_MODEL.scenarios.central.initialMm as number;
  let upper = WETNESS_MODEL.scenarios.upper.initialMm as number;
  let completeHours = 0;
  let forecastHours = 0;
  let staleHours = 0;
  let futureRetrievalHours = 0;
  let lastFreeze = -Infinity;
  let snowInWindow = false;
  for (let end = start + HOUR; end <= through; end += HOUR) {
    const hour = hours.get(end);
    const day = days.get(dateKey(end));
    const futureRetrieval =
      !!day?.retrievedAt && Date.parse(day.retrievedAt) > evidenceAvailableAt;
    const complete =
      !!day?.retrievedAt &&
      !!hour &&
      hour.rainMm !== null &&
      hour.referenceEt0Mm !== null &&
      hour.temperatureC !== null &&
      hour.snowfallCm !== null &&
      hour.precipitationMm !== null;
    if (complete) completeHours++;
    if (complete && hour?.basis === 'forecast') forecastHours++;
    if (day?.stale) staleHours++;
    if (futureRetrieval) futureRetrievalHours++;
    // Missing/stale evidence invalidates the estimate below. Never substitute
    // zero rainfall or interpret a failed refresh as evidence of firm ground.
    if (complete && !day?.stale && !futureRetrieval && hour) {
      const rain = hour.rainMm as number;
      const et0 = hour.referenceEt0Mm as number;
      lower = advance(lower, rain, et0, WETNESS_MODEL.scenarios.lower);
      central = advance(central, rain, et0, WETNESS_MODEL.scenarios.central);
      upper = advance(upper, rain, et0, WETNESS_MODEL.scenarios.upper);
      if ((hour.temperatureC as number) <= 0) lastFreeze = end;
      if ((hour.snowfallCm as number) > 0) snowInWindow = true;
    }
    if (end >= hourFloor(issuedAt))
      snapshots.set(end, {
        lower,
        central,
        upper,
        expectedHours: (end - start) / HOUR,
        completeHours,
        forecastHours,
        staleHours,
        futureRetrievalHours,
        freezing: lastFreeze === end,
        thawing:
          lastFreeze < end &&
          end - lastFreeze <= WETNESS_MODEL.thawLookbackHours * HOUR,
        snowInWindow,
      });
  }
  return snapshots;
};

/** Live estimates must use only evidence retrieved by their issue time. */
export const wetnessTimeline = (
  cell: EvidenceCell,
  issuedAt: number,
  through: number,
) => buildTimeline(cell, issuedAt, through, issuedAt);

/** Offline retrospective mechanism check; never a replay of a known forecast. */
export const hindcastWetnessTimeline = (
  cell: EvidenceCell,
  rideStart: number,
  through: number,
  reconstructedAt: number,
) => {
  if (
    ![rideStart, through, reconstructedAt].every(Number.isFinite) ||
    through < hourFloor(rideStart) ||
    through > rideStart + 2 * DAY ||
    reconstructedAt < through
  )
    throw new Error('Invalid hindcast time window.');
  return {
    purpose: 'hindcast' as const,
    historicalForecastValidation: false as const,
    reconstructedAt: new Date(reconstructedAt).toISOString(),
    timeline: buildTimeline(cell, rideStart, through, reconstructedAt),
  };
};

const classify = (
  water: number,
  material: Exclude<Material, 'unresolved'>,
): GroundCondition => {
  const thresholds = WETNESS_MODEL.responseThresholdsMm[material];
  return CONDITIONS[
    thresholds.filter((value) => water >= value).length
  ] as GroundCondition;
};
export type GroundEstimate = {
  status: 'estimated' | 'unknown' | 'freeze-thaw-uncertain';
  condition: GroundCondition | null;
  range: { lower: GroundCondition; upper: GroundCondition } | null;
  wetnessIndex: { lower: number; central: number; upper: number } | null;
  confidence: 'low' | 'unknown';
  reasons: string[];
};

export const estimateGround = (
  snapshot: WetnessSnapshot | undefined,
  material: Material,
): GroundEstimate => {
  const reasons: string[] = ['uncalibrated-model', 'drainage-unmeasured'];
  if (material === 'unresolved') reasons.push('surface-response-unknown');
  const unknown: GroundEstimate = {
    status: 'unknown',
    condition: null,
    range: null,
    wetnessIndex: null,
    confidence: 'unknown',
    reasons,
  };
  if (!snapshot)
    return { ...unknown, reasons: [...reasons, 'cell-or-time-unavailable'] };
  if (snapshot.completeHours !== snapshot.expectedHours)
    reasons.push('incomplete-weather');
  if (snapshot.staleHours) reasons.push('stale-weather');
  if (snapshot.futureRetrievalHours)
    reasons.push('evidence-retrieved-after-assessment');
  if (
    snapshot.completeHours !== snapshot.expectedHours ||
    snapshot.staleHours ||
    snapshot.futureRetrievalHours
  )
    return unknown;
  if (snapshot.forecastHours) reasons.push('includes-forecast');
  if (snapshot.snowInWindow) reasons.push('snowpack-and-melt-unmodelled');
  if (snapshot.freezing) reasons.push('freezing-risk');
  if (snapshot.thawing) reasons.push('thaw-risk');
  // Without snowpack/soil temperatures, neither freezing nor thaw is a firm
  // surface recommendation. Suppress the liquid-only index in these cases.
  if (snapshot.snowInWindow || snapshot.freezing || snapshot.thawing)
    return { ...unknown, status: 'freeze-thaw-uncertain', confidence: 'low' };
  const range = {
    lower: classify(
      snapshot.lower,
      material === 'unresolved' ? 'granular' : material,
    ),
    upper: classify(
      snapshot.upper,
      material === 'unresolved' ? 'soft' : material,
    ),
  };
  if (range.lower !== range.upper) reasons.push('scenario-disagreement');
  const index = (water: number) =>
    Math.round((1000 * water) / WETNESS_MODEL.capacityMm) / 10;
  return {
    status: material === 'unresolved' ? 'unknown' : 'estimated',
    condition:
      material === 'unresolved' ? null : classify(snapshot.central, material),
    range,
    wetnessIndex: {
      lower: index(snapshot.lower),
      central: index(snapshot.central),
      upper: index(snapshot.upper),
    },
    confidence: 'low',
    reasons,
  };
};
