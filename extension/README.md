# Ride On for cycle.travel (Chrome and Safari)

**Every change goes into both Chrome and Safari unless told otherwise.** They share all of this
source; differences live behind `import.meta.env.SAFARI` and the per-browser manifest in
`wxt.config.ts`.

MV3 extension (WXT + Preact) that ranks your cycle.travel journeys by the best time to ride them,
using the Ride On API (v0.9.0). Design: handoff 3 (`design_handoff_ride_on_v2`), plus 4a (signed out).

- **Popup** — Rides (opens first), When (days, time window, default window), Preferences
  (distance and climbing for this search or as usual, auto-synced profile, forecast provider).
- **cycle.travel `/user/journeys`** — "Tracked routes" module, date · time button, per-row chips.
  Journeys are imported as GPX (with elevation) when tracked, and re-imported when edited on cycle.travel.
- **Weather attribution** from the results (Apple Weather logo, legal link and notice; "Powered by
  Met Office data") shows under the rides and in Preferences, not on the page.

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

### Safari (macOS, iPhone, iPad)

Safari extensions ship inside an app: `safari/` is an XcodeGen project whose `RideOnExtension`
target runs `bun run build:safari` and copies `.output/safari-mv3` into the extension bundle. The
`RideOn` app explains how to turn the extension on and delivers APNs ride notifications. It has the main app's identity
(`com.danbarclay.rideon`, extension `com.danbarclay.rideon.Extension`), so these targets move into
`app/project.yml` when the full app ships as an update to the same App Store record.

```sh
bun run safari       # WXT Safari build + xcodegen → open safari/RideOn.xcodeproj, run RideOn
```

Then on macOS: Safari → Settings → Extensions → tick Ride On (for unsigned local builds, first
enable Settings → Advanced → "Show features for web developers", then Developer → "Allow unsigned
extensions"). On iOS: Settings → Apps → Safari → Extensions → Ride On.

Sign-in differences from Chrome (Safari has no `identity` API):

- The popup asks for `api.ride-on.cc` and `cycle.travel` access first, because Safari grants hosts per site.
- Sign-in opens a tab instead of a window. The API redirects it to
  `https://api.ride-on.cc/auth/browser/done`, which must be in `AUTH_CONFIG_JSON.clientRedirects`.
  There, `entrypoints/auth.content.ts` (Safari only) hands the code to the background, which
  checks `state`, exchanges it and closes the tab. The PKCE flow waits in IndexedDB, because Safari
  can unload the background while the rider signs in. Closing the tab cancels it.
- No manifest `key` and no `identity` permission. On iPhone the popup fills the sheet.

## Ride notifications

The bell pins the displayed departure for your account. Replacing it is explicit; all devices share the same tracked ride, saved minimums and pause. Shortlist changes do not stop the pinned departure. Choose **Preferences → Enable notifications** on each installation that should receive alerts.

Chrome 121+ requests its optional notifications permission and subscribes to Web Push. Safari links to the containing app through native messaging; open that app and press **Enable notifications** to finish. Taps open the latest tracked ride in the browser, with sign-in if needed. See [monitoring and push delivery](../docs/ride-monitoring.md#chrome-and-safari-delivery-api-v0370) for the policy, API, secure shared Keychain, server configuration and signing environments. Apple push needs a separate APNs key; WeatherKit credentials do not enable it.

## Test

```sh
bun run check        # Biome, tsc, unit tests (bun test unit)
bun run test:e2e     # e2e build against a mock API on 127.0.0.1:8787 + Playwright
```

E2E never touches the real API or cycle.travel: `e2e/extension.spec.ts` runs a mock API and
serves a minimal Journeys page fixture. Screenshots land in `test-results/`.

## Release

Chrome and Safari share the version from the `extension-v*` tags.

`.github/workflows/extension.yml` runs on PRs and every merge to `main` that touches `extension/`:
check, e2e, then the store zip (uploaded as the `extension-zip` artifact). On `main`, if extension
source changed since the last `extension-v*` tag (tests and docs don't count), it tags the next
patch version and publishes a GitHub Release with the zip. For a minor or major bump, raise
`version` in `package.json`; the higher one wins.

Store zips are built with `EXTENSION_VERSION=<v> STORE_BUILD=1 bun run zip`: the version is set
and the manifest `key` dropped. The first upload, listing copy and privacy answers are in
[STORE.md](STORE.md); the privacy policy is [PRIVACY.md](PRIVACY.md).

CI also builds the Safari container unsigned for macOS and the iOS Simulator. Signing and upload
are manual: `bun run safari:archive` (`safari/archive.sh`) archives both platforms at the latest
`extension-v*` version with a timestamp build number, and uploads them to App Store Connect for
TestFlight. See [STORE.md](STORE.md) "App Store (Safari)".

## API

Contracts: `docs/api.md`. Rankings are one `POST /recommendations` across the planned days, with
`previewDays: 7` for the day strip. The default window, sunshine, rain and km/mi are stored only in
this browser, and so, until the API stores alerts, is which tracked ride has its bell on (no alert
is sent yet). A pause is also kept in this browser until the API stores it on the profile
(`docs/extension-api-brief-v8.md`); while paused the background asks for no forecasts, and a
`chrome.alarms` alarm turns Ride On back on at 00:00 on the chosen day. Only the background service worker calls the API; the popup and content script
message it and render the shared state in `storage.local`.
