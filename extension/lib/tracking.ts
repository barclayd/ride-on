import { api, getSecret, setSecret } from './api';
import type { Departure } from './types';

export type TrackedRide = {
  id: string;
  routeId: string;
  departureAt: string;
  timeZone: string;
  state: 'active' | 'inactive';
  endedReason: string | null;
  baseline: {
    pick: { candidate: Departure };
    context: { routes: { id: string; name: string }[] };
  };
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
};
export const loadTracker = async (): Promise<Tracker> => {
  const list = await api<{
    activeTrackedRideId: string | null;
    trackingVersion: number;
  }>('/tracked-rides');
  const ride = list.activeTrackedRideId
    ? (
        await api<{ ride: TrackedRide }>(
          `/tracked-rides/${list.activeTrackedRideId}`,
        )
      ).ride
    : null;
  return { ready: true, ride, version: list.trackingVersion, error: null };
};
// Persist the action key before sending, so a service-worker restart cannot duplicate it.
export const saveTrackedRide = async (
  reference: string,
  version: number,
  replace: string | null,
) => {
  const body = {
    recommendationRef: reference,
    expectedTrackingVersion: version,
    replaceTrackedRideId: replace,
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
