# Ride On for cycle.travel (Chrome)

MV3 extension (WXT + Preact) that ranks your cycle.travel journeys by the best time to ride them,
using the Ride On API. Design: handoff sections 2a (page + popup) and 4a (signed out).

- **Popup** — When (days, time window, best in window), Rides (tracked routes), Preferences.
- **cycle.travel `/user/journeys`** — "Under consideration" module, per-row chips and the picker.
  Journeys are imported as GPX (with elevation) when tracked, and re-imported when edited on cycle.travel.

## Run it

```sh
bun install
bun run build        # → .output/chrome-mv3, load unpacked at chrome://extensions
bun run dev          # watch mode with a fresh Chrome profile
```

The manifest key pins the ID to `gafikjcoeoddjgojefhmdpjkjpbhmjle`, so the sign-in redirect is
`https://gafikjcoeoddjgojefhmdpjkjpbhmjle.chromiumapp.org/ride-on`. It must be listed in the API's
`AUTH_CONFIG_JSON.clientRedirects`.

Builds target `https://api.ride-on.cc`; set `WXT_API_URL` to point elsewhere.

## Test

```sh
bun run check        # Biome, tsc, unit tests (bun test unit)
bun run test:e2e     # e2e build against a mock API on 127.0.0.1:8787 + Playwright
```

E2E never touches the real API or cycle.travel: `e2e/extension.spec.ts` runs a mock API and
serves a minimal Journeys page fixture. Screenshots land in `test-results/`.

## API

Contracts: `docs/api.md` plus `docs/extension-api-brief.md` (planning days, day summaries,
verdicts, confidence, preference levels). Only the background service worker calls the API;
the popup and content script message it and render the shared state in `storage.local`.
