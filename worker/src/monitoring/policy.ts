import { Temporal } from '@js-temporal/polyfill';
import { orderDepartures } from '../recommendations/engine.ts';
import { digest, type Pick, type Snapshot } from '../tracking/model.ts';

export const INTERVAL_MS = 15 * 60_000;
export const COOLDOWN_MS = 3 * 3_600_000;
export type Reference = {
  contextKey: string;
  score: number;
  failures: string[];
  standardsKnown: boolean;
  alternative: string | null;
};
export type MonitorState = {
  reference: Reference;
  observed: { failures: string[]; known: boolean };
  pendingBreaches: string[];
  lastNotifiedAt: string | null;
  unavailableSince: string | null;
  outageNotified: boolean;
  summaryDone: boolean;
};
export type Alert = {
  reasons: string[];
  reference: Reference | null;
  score: number | null;
  scoreDelta: number | null;
  newlyFailing: string[];
  recovered: string[];
  remainingFailures: string[];
  alternative: {
    routeId: string;
    routeName: string;
    departureAt: string;
    score: number;
  } | null;
  lastSuccessAt: string | null;
};
const keyFor = (pick: Pick) => `${pick.routeId}/${pick.candidate.departureAt}`;
export const qualifyingAlternative = (snapshot: Snapshot, at: string) => {
  const { context, pick } = snapshot;
  const best = context.best;
  if (
    !context.coverageComplete ||
    !context.weather.refreshAt ||
    context.weather.refreshAt <= at ||
    !best ||
    best.candidate.departureAt <= at ||
    keyFor(best) === keyFor(pick) ||
    (orderDepartures(best.candidate, pick.candidate) ||
      best.routeId.localeCompare(pick.routeId)) >= 0 ||
    !['meets', 'not_configured'].includes(best.candidate.standards.status) ||
    (best.candidate.score - pick.candidate.score < 5 &&
      pick.candidate.standards.status !== 'below')
  )
    return null;
  return best;
};
export const referenceFor = async (
  snapshot: Snapshot,
  at: string,
): Promise<Reference> => ({
  contextKey: await digest({
    inputs: snapshot.context.inputs,
    routes: snapshot.context.routes,
    history: snapshot.context.history,
    algorithm: snapshot.context.algorithmVersion,
    source: snapshot.context.weather.selectedSource,
  }),
  score: snapshot.pick.candidate.score,
  failures: snapshot.pick.candidate.standards.failures
    .map((f) => f.standard)
    .sort(),
  standardsKnown: snapshot.pick.candidate.standards.status !== 'unknown',
  alternative: (() => {
    const best = qualifyingAlternative(snapshot, at);
    return best ? keyFor(best) : null;
  })(),
});
export const summaryAt = (departure: string, timeZone: string) =>
  Temporal.Instant.from(departure)
    .toZonedDateTimeISO(timeZone)
    .subtract({ days: 1 })
    .with({
      hour: 19,
      minute: 0,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    })
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });
export const initialState = async (
  baseline: Snapshot,
  createdAt: string,
): Promise<MonitorState> => {
  const reference = await referenceFor(baseline, createdAt);
  return {
    reference,
    observed: { failures: reference.failures, known: reference.standardsKnown },
    pendingBreaches: [],
    lastNotifiedAt: null,
    unavailableSince: null,
    outageNotified: false,
    summaryDone: false,
  };
};
export const decide = async (input: {
  state: MonitorState;
  current: Snapshot | null;
  at: string;
  departure: string;
  createdAt: string;
  timeZone: string;
  lastSuccessAt: string | null;
  staleSince: string | null;
}) => {
  const { current, at, departure, createdAt, timeZone, lastSuccessAt } = input;
  const state = structuredClone(input.state);
  if (at >= departure) return { state, alert: null };
  const summaryDue = summaryAt(departure, timeZone);
  const summary =
    !state.summaryDone && createdAt <= summaryDue && at >= summaryDue;
  const reasons: string[] = [];
  if (summary) reasons.push('evening_summary');
  const empty: Alert = {
    reasons,
    reference: null,
    score: null,
    scoreDelta: null,
    newlyFailing: [],
    recovered: [],
    remainingFailures: [],
    alternative: null,
    lastSuccessAt,
  };
  if (!current) {
    state.unavailableSince ??=
      input.staleSince && input.staleSince < at ? input.staleSince : at;
    if (
      summary ||
      (!state.outageNotified &&
        Date.parse(departure) - Date.parse(at) <= 24 * 3_600_000 &&
        Date.parse(at) - Date.parse(state.unavailableSince) >= 3_600_000)
    ) {
      reasons.push('unavailable');
      return { state, alert: empty };
    }
    return { state, alert: null };
  }
  const ref = await referenceFor(current, at);
  // A different non-weather context starts a new forecast reference quietly.
  if (ref.contextKey !== state.reference.contextKey) {
    state.reference = ref;
    state.observed = { failures: ref.failures, known: ref.standardsKnown };
    state.pendingBreaches = [];
  }
  const before = state.reference;
  const delta = Math.round((ref.score - before.score) * 1000) / 1000;
  const crossed = state.observed.known
    ? ref.failures.filter((f) => !state.observed.failures.includes(f))
    : [];
  state.pendingBreaches = [
    ...new Set([...state.pendingBreaches, ...crossed]),
  ].filter((f) => ref.failures.includes(f));
  state.observed = { failures: ref.failures, known: ref.standardsKnown };
  const newlyFailing = state.pendingBreaches;
  if (!before.standardsKnown && ref.standardsKnown) {
    state.reference.failures = ref.failures;
    state.reference.standardsKnown = true;
  }
  const recovered = ref.standardsKnown
    ? before.failures.filter((f) => !ref.failures.includes(f))
    : [];
  const gapOpen =
    !state.lastNotifiedAt ||
    Date.parse(at) - Date.parse(state.lastNotifiedAt) >= COOLDOWN_MS;
  const recovery = state.outageNotified;
  state.unavailableSince = null;
  if (recovery) reasons.push('available_again');
  if (newlyFailing.length) reasons.push('minimum_breach');
  const canCombine = gapOpen || newlyFailing.length > 0 || summary || recovery;
  if (canCombine) {
    if (Math.abs(delta) >= 5)
      reasons.push(delta > 0 ? 'score_improved' : 'score_worsened');
    if (recovered.length) reasons.push('minimum_recovery');
    if (ref.alternative && ref.alternative !== before.alternative)
      reasons.push('better_option');
  }
  // Remember an option disappearing; if it later becomes useful again, it may alert again.
  if (!ref.alternative) state.reference.alternative = null;
  if (!reasons.length) return { state, alert: null };
  const alternative = qualifyingAlternative(current, at);
  return {
    state,
    alert: {
      ...empty,
      reference: ref,
      score: ref.score,
      scoreDelta: delta,
      newlyFailing,
      recovered,
      remainingFailures: ref.failures,
      alternative: alternative
        ? {
            routeId: alternative.routeId,
            routeName:
              current.context.routes.find((r) => r.id === alternative.routeId)
                ?.name ?? 'Another route',
            departureAt: alternative.candidate.departureAt,
            score: alternative.candidate.score,
          }
        : null,
    } satisfies Alert,
  };
};
export const acceptAlert = (
  state: MonitorState,
  alert: Alert,
  at: string,
): MonitorState => ({
  ...state,
  reference: alert.reference ?? state.reference,
  pendingBreaches: state.pendingBreaches.filter(
    (f) => !alert.newlyFailing.includes(f),
  ),
  lastNotifiedAt: alert.reference ? at : state.lastNotifiedAt,
  outageNotified: alert.reasons.includes('unavailable')
    ? true
    : alert.reasons.includes('available_again')
      ? false
      : state.outageNotified,
  summaryDone: state.summaryDone || alert.reasons.includes('evening_summary'),
});
