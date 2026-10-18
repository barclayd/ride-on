import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { API_URL } from '../lib/api';
import { type State, send } from '../lib/state';

export const Notifications = ({ state }: { state: State }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (enable: boolean) => {
    setError(null);
    setBusy(true);
    try {
      if (
        enable &&
        !import.meta.env.SAFARI &&
        !(await browser.permissions.request({ permissions: ['notifications'] }))
      )
        throw new Error(
          'Notifications were not allowed. You can enable them later.',
        );
      const result = await send({
        type: enable ? 'enablePush' : 'disablePush',
      });
      if (result.error) throw new Error(result.error);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not update notifications.',
      );
    } finally {
      setBusy(false);
    }
  };
  // Safari: the Ride On app shares this sign-in and owns this device's alert switches.
  if (import.meta.env.SAFARI)
    return (
      <section class="ro-card ro-col" aria-label="Notifications">
        <span class="ro-label">Notifications</span>
        <p>{state.push.message}</p>
        <button
          type="button"
          class="ro-primary"
          onClick={() => {
            location.href = 'rideon-notifications://notifications';
          }}
        >
          Open Ride On
        </button>
        <button
          type="button"
          class="ro-edit"
          onClick={() => send({ type: 'pushStatus' })}
        >
          Check setup
        </button>
      </section>
    );
  return (
    <section class="ro-card ro-col" aria-label="Notifications">
      <span class="ro-label">Notifications</span>
      <p>{state.push.message}</p>
      <button
        type="button"
        class="ro-primary"
        disabled={busy}
        onClick={() => change(state.push.status !== 'ready')}
      >
        {state.push.status === 'ready'
          ? 'Turn off on this device'
          : 'Enable notifications'}
      </button>
      {state.push.status !== 'ready' && state.push.status !== 'off' && (
        <button
          type="button"
          class="ro-link"
          disabled={busy}
          onClick={() => change(false)}
        >
          Turn off on this device
        </button>
      )}
      <button
        type="button"
        class="ro-edit"
        disabled={busy}
        onClick={() => send({ type: 'pushStatus' })}
      >
        Check setup
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
};
export const TrackedRideSummary = ({ state }: { state: State }) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ride = state.tracker.ride;
  if (!ride)
    return state.tracker.error ? (
      <p role="status">
        Could not check your tracked ride. Refresh to try again.
      </p>
    ) : null;
  const name =
    ride.baseline.context.routes.find((r) => r.id === ride.routeId)?.name ??
    'Your ride';
  const time = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ride.timeZone,
  }).format(new Date(ride.departureAt));
  return (
    <section class="ro-card ro-col" aria-label="Tracked ride">
      <span class="ro-label">
        {ride.refresh.closed ? 'Ride departure passed' : 'Tracking your ride'}
      </span>
      <strong>{name}</strong>
      <span>{time}</span>
      <a
        href={`${API_URL}/notifications/open#ride=${encodeURIComponent(ride.id)}`}
        target="_blank"
        rel="noreferrer"
      >
        View latest ride update
      </a>
      {!ride.refresh.closed && (
        <button
          type="button"
          class="ro-link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await send({
              type: 'setAlert',
              routeId: null,
              expectedTrackingVersion: state.tracker.version,
              replaceTrackedRideId: ride.id,
            });
            setError(result.error ?? null);
            setBusy(false);
          }}
        >
          Stop monitoring this departure
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {state.push.status !== 'ready' && !ride.refresh.closed && (
        <span>
          {import.meta.env.SAFARI
            ? 'Turn on notifications in the Ride On app to get alerts on this device.'
            : 'Enable notifications in Preferences to receive alerts on this device.'}
        </span>
      )}
    </section>
  );
};
