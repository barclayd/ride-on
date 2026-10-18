import { api, getSecret, setSecret } from './api';
import type { AlertTriggers, Departure } from './types';

export type TrackedRide = {
  id: string;
  routeId: string;
  departureAt: string;
  finishAt?: string;
  timeZone: string;
  state: 'active' | 'inactive';
  endedReason: string | null;
  baseline: {
    pick: { candidate: Departure };
    context: { routes: { id: string; name: string }[] };
  };
  alerts?: { triggers: AlertTriggers } | null;
  latestAssessment: { pick: { candidate: Departure } } | null;
  latestAssessmentKind: 'current' | 'last_known' | null;
  refresh: {
    closed: boolean;
    lastSuccessfulAssessmentAt: string | null;
    refreshAt: string | null;
  };
};
export type Tracker = {
  ready: boolean;
  ride: TrackedRide | null;
  version: number;
  error: string | null;
  // From the API's capabilities; absent before brief v11.
  triggers?: boolean; // it takes the rider's triggers with a tracked ride
  summaryTime?: string; // local time of the evening-before forecast
  // docs/extension-api-brief-v13.md: rankings keep the tracked departure, and switches can change.
  fixed?: boolean;
  edits?: boolean;
};
export const loadTracker = async (): Promise<Tracker> => {
  const list = await api<{
    activeTrackedRideId: string | null;
    trackingVersion: number;
    capabilities?: {
      alertTriggers?: boolean;
      finalForecastLocalTime?: string;
      fixedDeparture?: boolean;
      alertEdits?: boolean;
    };
  }>('/tracked-rides');
  const ride = list.activeTrackedRideId
    ? (
        await api<{ ride: TrackedRide }>(
          `/tracked-rides/${list.activeTrackedRideId}`,
        )
      ).ride
    : null;
  return {
    ready: true,
    ride,
    version: list.trackingVersion,
    error: null,
    triggers: list.capabilities?.alertTriggers === true,
    summaryTime: list.capabilities?.finalForecastLocalTime,
    fixed: list.capabilities?.fixedDeparture === true,
    edits: list.capabilities?.alertEdits === true,
  };
};
// Persist the action key before sending, so a service-worker restart cannot duplicate it.
// The API rejects fields it doesn't know, so triggers go only once it says it takes them.
export const saveTrackedRide = async (
  reference: string,
  version: number,
  replace: string | null,
  triggers: AlertTriggers | null,
) => {
  const body = {
    recommendationRef: reference,
    expectedTrackingVersion: version,
    replaceTrackedRideId: replace,
    ...(triggers && { alerts: { triggers } }),
  };
  const signature = JSON.stringify(body);
  const previous = await getSecret<{ signature: string; key: string }>(
    'track-action',
  );
  const action =
    previous?.signature === signature
      ? previous
      : { signature, key: crypto.randomUUID() };
  await setSecret('track-action', action);
  await api('/tracked-rides', {
    body,
    headers: { 'Idempotency-Key': action.key },
  });
  await setSecret('track-action', null);
  return loadTracker();
};

// Change alerts keeps the plan, its departure and what monitoring has seen (brief v13 §3).
export const saveTriggers = async (
  id: string,
  version: number,
  triggers: AlertTriggers,
) => {
  await api(`/tracked-rides/${id}`, {
    method: 'PATCH',
    body: { expectedTrackingVersion: version, alerts: { triggers } },
  });
  return loadTracker();
};
