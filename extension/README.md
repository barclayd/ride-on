# Ride On for cycle.travel (Chrome)

MV3 extension (WXT + Preact) that ranks your cycle.travel journeys by the best time to ride them,
using the Ride On API (v0.9.0). Design: handoff 3 (`design_handoff_ride_on_v2`), plus 4a (signed out).

- **Popup** — Rides (opens first), When (days, time window, default window), Preferences
  (distance and climbing for this search or as usual, auto-synced profile, forecast provider).
- **cycle.travel `/user/journeys`** — "Tracked routes" module, date · time button, per-row chips.
  Journeys are imported as GPX (with elevation) when tracked, and re-imported when edited on cycle.travel.
- **Weather attribution** from the results (Apple Weather logo, legal link and notice; "Powered by
  Met Office data") shows under the rides, in Preferences and on the page.

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

## Release

`.github/workflows/extension.yml` runs on PRs and every merge to `main` that touches `extension/`:
check, e2e, then the store zip (uploaded as the `extension-zip` artifact). On `main`, if extension
source changed since the last `extension-v*` tag (tests and docs don't count), it tags the next
patch version and publishes a GitHub Release with the zip. For a minor or major bump, raise
`version` in `package.json`; the higher one wins.

Store zips are built with `EXTENSION_VERSION=<v> STORE_BUILD=1 bun run zip`: the version is set
and the manifest `key` dropped. The first upload, listing copy and privacy answers are in
[STORE.md](STORE.md); the privacy policy is [PRIVACY.md](PRIVACY.md).

## API

Contracts: `docs/api.md`. What the extension still works around is in
`docs/extension-api-brief-v2.md`: one request per forecast day merged client-side, hard-coded
provider horizons, and the default window, sunshine, rain, favour tailwinds and km/mi stored only in
this browser. Only the background service worker calls the API; the popup and content script
message it and render the shared state in `storage.local`.
