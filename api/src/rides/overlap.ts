import { Temporal } from '@js-temporal/polyfill';
import type { Route } from '../routes/model.ts';
import type { Coordinate } from '../weather/contracts.ts';
import { decodeGeometry, distanceM, type RideGeometry } from './geometry.ts';
import type { HistoryEntry, HistorySnapshot } from './store.ts';

export const MATCHER_VERSION = 'path-overlap-v1';
export const MAX_PENALTY_POINTS = 10;
export type RecentRidesPreference = {
  mode: 'neutral' | 'prefer-variety';
  lookbackDays: number;
};
type Vector = [number, number, number];
type Piece = { a: Vector; b: Vector; mid: Vector; length: number };
type Group = { length: number; hashes: string[] };
type Coverage = { groups: Group[]; length: number };
export type HistoryEvidence = {
  status: 'disabled' | 'no_recent_history' | 'assessed' | 'unavailable';
  matchedDistanceM: number | null;
  overlapFraction: number | null;
  recencyWeightedOverlapFraction: number | null;
  penaltyPoints: number;
  lookbackDays: number;
  mostRecentRiddenOn: string | null;
  reasonCode: string | null;
};
const xyz = (p: Coordinate): Vector => {
  const lat = (p.latitude * Math.PI) / 180;
  const lon = (p.longitude * Math.PI) / 180;
  return [
    6371000 * Math.cos(lat) * Math.cos(lon),
    6371000 * Math.cos(lat) * Math.sin(lon),
    6371000 * Math.sin(lat),
  ];
};
const delta = (a: Vector, b: Vector): Vector => [
  b[0] - a[0],
  b[1] - a[1],
  b[2] - a[2],
];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const interpolate = (a: Vector, b: Vector, t: number): Vector => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const pieces = (
  geometry: RideGeometry,
  budget: { pieces: number },
): Piece[] => {
  const points = decodeGeometry(geometry);
  const result: Piece[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const length = distanceM(from, to);
    if (length < 0.05) continue;
    const count = Math.ceil(length / 20);
    budget.pieces += count;
    if (budget.pieces > 150_000) throw new Error('history_assessment_limit');
    const a = xyz(from);
    const b = xyz(to);
    for (let n = 0; n < count; n++)
      result.push({
        a: interpolate(a, b, n / count),
        b: interpolate(a, b, (n + 1) / count),
        mid: interpolate(a, b, (n + 0.5) / count),
        length: length / count,
      });
  }
  return result;
};
const cell = (p: Vector) => p.map((n) => Math.floor(n / 50));
const matches = (candidate: Piece, historical: Piece) => {
  const direction = delta(candidate.a, candidate.b);
  const other = delta(historical.a, historical.b);
  // Same direction or its reverse, within 15 degrees. Perpendicular crossings
  // are not shared roads; proximity alone is insufficient.
  if (
    Math.abs(dot(direction, other)) <
    Math.cos(Math.PI / 12) *
      Math.sqrt(dot(direction, direction) * dot(other, other))
  )
    return false;
  const t = Math.max(
    0,
    Math.min(
      1,
      dot(delta(historical.a, candidate.mid), other) / dot(other, other),
    ),
  );
  const offset = delta(
    candidate.mid,
    interpolate(historical.a, historical.b, t),
  );
  return dot(offset, offset) <= 8 ** 2;
};
const age = (entry: HistoryEntry, departure: string) => {
  const day = Temporal.Instant.from(departure)
    .toZonedDateTimeISO(entry.timeZone)
    .toPlainDate();
  return Temporal.PlainDate.from(entry.riddenOn).until(day).days;
};
export type HistoryAssessment = ReturnType<typeof prepareHistory>;
export const prepareHistory = (
  routes: readonly Route[],
  preference: RecentRidesPreference,
  snapshot: HistorySnapshot | null,
  earliestDeparture: string,
  latestDeparture: string,
) => {
  const metadata = {
    revision: snapshot?.revision ?? null,
    matcherVersion: MATCHER_VERSION,
    reasonCode: null as string | null,
    affectedRouteIds: [] as string[],
    affectedRideIds: [] as string[],
  };
  const relevant = (snapshot?.entries ?? []).filter(
    (entry) =>
      age(entry, latestDeparture) >= 0 &&
      age(entry, earliestDeparture) < preference.lookbackDays,
  );
  let status: HistoryEvidence['status'] =
    preference.mode === 'neutral'
      ? 'disabled'
      : relevant.length
        ? 'assessed'
        : 'no_recent_history';
  const coverages = new Map<string, Coverage>();
  const entriesByHash = new Map<string, HistoryEntry[]>();
  for (const entry of relevant)
    entriesByHash.set(entry.sourceHash, [
      ...(entriesByHash.get(entry.sourceHash) ?? []),
      entry,
    ]);
  const zones = [...new Set(relevant.map((entry) => entry.timeZone))];
  if (
    preference.mode !== 'neutral' &&
    (!snapshot || snapshot.limited || zones.length > 16)
  ) {
    status = 'unavailable';
    metadata.reasonCode = snapshot
      ? 'history_assessment_limit'
      : 'history_not_loaded';
  } else if (status === 'assessed') {
    metadata.affectedRouteIds = routes
      .filter((r) => !r.geometry)
      .map((r) => r.id);
    metadata.affectedRideIds = relevant
      .filter((r) => !snapshot?.geometries.has(r.sourceHash))
      .map((r) => r.id);
    if (metadata.affectedRouteIds.length || metadata.affectedRideIds.length) {
      status = 'unavailable';
      metadata.reasonCode = 'history_geometry_unavailable';
    } else {
      try {
        const budget = { pieces: 0, comparisons: 0 };
        const index = new Map<string, { hash: string; piece: Piece }[]>();
        for (const hash of entriesByHash.keys()) {
          const geometry = snapshot?.geometries.get(hash);
          if (!geometry) throw new Error('history_geometry_unavailable');
          for (const piece of pieces(geometry, budget)) {
            const key = cell(piece.mid).join(',');
            const bucket = index.get(key) ?? [];
            bucket.push({ hash, piece });
            index.set(key, bucket);
          }
        }
        for (const route of routes) {
          if (!route.geometry) throw new Error('history_geometry_unavailable');
          const groups = new Map<string, Group>();
          let length = 0;
          for (const piece of pieces(route.geometry, budget)) {
            length += piece.length;
            const hashes = new Set<string>();
            const [x = 0, y = 0, z = 0] = cell(piece.mid);
            for (let dx = -1; dx <= 1; dx++)
              for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                  for (const other of index.get(
                    `${x + dx},${y + dy},${z + dz}`,
                  ) ?? []) {
                    if (++budget.comparisons > 5_000_000)
                      throw new Error('history_assessment_limit');
                    if (!hashes.has(other.hash) && matches(piece, other.piece))
                      hashes.add(other.hash);
                  }
                }
            const sorted = [...hashes].sort();
            const key = sorted.join(',');
            const group = groups.get(key) ?? { length: 0, hashes: sorted };
            group.length += piece.length;
            groups.set(key, group);
          }
          if (!length) throw new Error('history_geometry_unavailable');
          coverages.set(route.id, { groups: [...groups.values()], length });
        }
      } catch (error) {
        status = 'unavailable';
        metadata.reasonCode =
          error instanceof Error && error.message === 'history_assessment_limit'
            ? error.message
            : 'history_geometry_unavailable';
        coverages.clear();
      }
    }
  }
  // Geometry is evaluated once for the comparison. Dates only change recency.
  const memo = new Map<string, HistoryEvidence>();
  const departureDays = new Map<
    string,
    { key: string; dates: Map<string, Temporal.PlainDate> }
  >();
  const weightsByDay = new Map<
    string,
    Map<string, { weight: number; date: string | null }>
  >();
  const assess = (routeId: string, departure: string): HistoryEvidence => {
    if (status !== 'assessed')
      return {
        status,
        matchedDistanceM: status === 'unavailable' ? null : 0,
        overlapFraction: status === 'unavailable' ? null : 0,
        recencyWeightedOverlapFraction: status === 'unavailable' ? null : 0,
        penaltyPoints: 0,
        lookbackDays: preference.lookbackDays,
        mostRecentRiddenOn: null,
        reasonCode: metadata.reasonCode,
      };
    let day = departureDays.get(departure);
    if (!day) {
      const instant = Temporal.Instant.from(departure);
      const dates = new Map(
        zones.map((zone) => [
          zone,
          instant.toZonedDateTimeISO(zone).toPlainDate(),
        ]),
      );
      day = { key: [...dates.values()].join(','), dates };
      departureDays.set(departure, day);
    }
    const key = `${routeId}:${day.key}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let weights = weightsByDay.get(day.key);
    if (!weights) {
      weights = new Map();
      for (const [hash, entries] of entriesByHash) {
        let weight = 0;
        let date: string | null = null;
        for (const entry of entries) {
          const localDay = day.dates.get(entry.timeZone);
          if (!localDay) throw new Error('Missing history time zone');
          const days = Temporal.PlainDate.from(entry.riddenOn).until(
            localDay,
          ).days;
          const recency =
            days < 0 ? 0 : Math.max(0, 1 - days / preference.lookbackDays);
          if (recency > weight) {
            weight = recency;
            date = entry.riddenOn;
          }
        }
        weights.set(hash, { weight, date });
      }
      weightsByDay.set(day.key, weights);
    }
    const active = [...weights.values()].some((w) => w.weight > 0);
    let matched = 0;
    let weighted = 0;
    let recent: string | null = null;
    const coverage = coverages.get(routeId);
    for (const group of coverage?.groups ?? []) {
      let weight = 0;
      for (const hash of group.hashes) {
        const w = weights.get(hash);
        if (w && w.weight > 0) {
          weight = Math.max(weight, w.weight);
          if (w.date && (!recent || w.date > recent)) recent = w.date;
        }
      }
      if (weight > 0) matched += group.length;
      weighted += group.length * weight;
    }
    const effective =
      status === 'assessed' && !active ? 'no_recent_history' : status;
    const fraction = coverage ? Math.min(1, weighted / coverage.length) : 0;
    const result: HistoryEvidence = {
      status: effective,
      matchedDistanceM: matched,
      overlapFraction: coverage ? Math.min(1, matched / coverage.length) : 0,
      recencyWeightedOverlapFraction: fraction,
      penaltyPoints: fraction * MAX_PENALTY_POINTS,
      lookbackDays: preference.lookbackDays,
      mostRecentRiddenOn: recent,
      reasonCode: metadata.reasonCode,
    };
    memo.set(key, result);
    return result;
  };
  return { ...metadata, status, assess };
};
