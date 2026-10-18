import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { type State, send } from '../lib/state';

// Chrome asks the browser first. Safari's Ride On app asks macOS and registers the device.
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
      {error && <p role="alert">{error}</p>}
    </section>
  );
};
