import { clientEntry, type Handle, ref } from 'remix/component';

/**
 * The one MapLibre map (SPEC §5.3). It renders an empty box on the server and mounts in the browser.
 * `backdrop` is the signed-out map behind sign-in.
 */
export const CycleMap = clientEntry(
  '/assets/cycle-map.js#CycleMap',
  function CycleMap(handle: Handle<{ backdrop?: boolean }>) {
    return () => (
      <div
        class="map"
        mix={[
          ref((node, signal) => {
            // A runtime URL, so neither Bun nor wrangler pulls MapLibre into the server bundle.
            import(`${location.origin}/assets/map.js`).then(
              (map: typeof import('./map.ts')) =>
                map.mount(node as HTMLElement, signal, handle.props.backdrop),
            );
          }),
        ]}
      />
    );
  },
);
