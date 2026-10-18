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
`RideOn` app finishes setup and delivers APNs ride notifications. On macOS it's one System
Settings-style window (handoff Safari v1, 1c; `safari/App/Mac/`): **General** shows whether Safari
runs the extension (`SFSafariExtensionManager`, rechecked whenever the app comes forward) and the
signed-in account, with **Sign Out**; **Notifications** holds this Mac's Ride alerts, Final forecast
and Sound switches; **Help** lists the setup steps. On iOS it's a one-screen guide with **Enable
notifications**. It has the main app's identity
(`com.danbarclay.rideon`, extension `com.danbarclay.rideon.Extension`), so these targets move into
`app/project.yml` when the full app ships as an update to the same App Store record.

```sh
bun run safari       # WXT Safari build + xcodegen → open safari/RideOn.xcodeproj, run RideOn
```

Then on macOS: Safari → Settings → Extensions → tick Ride On (for unsigned local builds, first
enable Settings → Advanced → "Show features for web developers", then Developer → "Allow unsigned
extensions"). On iOS: Settings → Apps → Safari → Extensions → Ride On.

On macOS, Safari runs **every** registered copy of the extension at once. Each copy has its own
background, but they all share one `storage.local`. A copy built in another DerivedData folder, a
worktree, an archive or a `-derivedDataPath` scratch folder then fails the current copy's writes
(`SQLITE_BUSY` in Safari's log) and draws its own older Journeys strip, so a fix looks like it never
landed. So the `RideOn` target's last build phase unregisters every copy but the one it just built
(`safari/unregister-stale.sh`), and `archive.sh` hands Safari back to the newest local build. After
building some other way, run:

```sh
bun run safari:unregister-stale   # keep the newest non-archive build, unregister the rest
pluginkit -m -A -D -v -i com.danbarclay.rideon.Extension   # list the registered copies
```

Safari drops the old copies within a minute. Then reload any open cycle.travel tabs, because the old
copies' content scripts stay in them until then.

Sign-in differences from Chrome (Safari has no `identity` API):

- The popup asks for `api.ride-on.cc` and `cycle.travel` access first, because Safari grants hosts per site.
- Sign-in opens a tab instead of a window. The API redirects it to
  `https://api.ride-on.cc/auth/browser/done`, which must be in `AUTH_CONFIG_JSON.clientRedirects`.
  There, `entrypoints/auth.content.ts` (Safari only) hands the code to the background, which
  checks `state`, exchanges it and closes the tab. The PKCE flow waits in IndexedDB, because Safari
  can unload the background while the rider signs in. Closing the tab cancels it.
- No manifest `key` and no `identity` permission. On iPhone the popup fills the sheet.
- Safari can't open the popup from a script, so the Journeys page's buttons (Sign in, the window,
  the forecast provider) open the popup page in a tab beside it. Chrome does the same when
  `action.openPopup()` refuses, for example without a focused window. Signing in on that page
  doesn't open the panel full screen: it says to close the page and go back to cycle.travel, with
  **Back to cycle.travel** to do it (`?from=<tab id>` names the tab to return to).

## Ride notifications

The bell pins the displayed departure for your account. An off bell opens the alerts dialog (handoff v10, 29c): the rider picks which changes to hear about (rain, gusts over their limit, feeling colder than their range, a better time) and confirms; moving alerts from another ride says so first, and an on bell turns them off straight away, with Undo. The choices are kept per route on the device and go to the API once `GET /tracked-rides` advertises `capabilities.alertTriggers` ([brief v11](../docs/extension-api-brief-v11.md)). All devices share the same tracked ride, saved minimums and pause. Shortlist changes do not stop the pinned departure. The first confirm asks the browser for notifications in the panel; on the Journeys page, which can't ask, it opens **Preferences** instead. Choose **Preferences → Enable notifications** on each installation that should receive alerts.

Once `GET /tracked-rides` advertises `capabilities.fixedDeparture` ([brief v13](../docs/extension-api-brief-v13.md)), alerts fix the ride's day and time (handoff v11, 30c/30d). The dialog shows the time as a pill and says it will stay put. The tile then keeps that departure instead of moving to the route's best one, and shows it as a pill. The pill, or the bell, opens **What we're tracking**: the time, the switches that are on and when the rider will hear from us. On the Journeys page's phone layout it opens as a card at the bottom. It closes on ×, Escape, a click outside or focus leaving, and focus goes back to what opened it. From there, **Change alerts** reopens the dialog to edit the switches on the same plan (`PATCH /tracked-rides/{id}`, only with `capabilities.alertEdits`), and **Turn off alerts** stops the plan with Undo. When the API finds a better departure on the same route, the tile offers it under the pill with **Move alerts**, which tracks it with the same switches, with Undo. When the API can't score the fixed time, the tile keeps it without a score and says why: the forecast doesn't cover it, the ride no longer fits in daylight, the route is gone or elevation is missing. API 0.40.0 advertises `fixedDeparture`; against an older API, all of this stays off. Tracking errors (`TRACKING_VERSION_CONFLICT`, `TRACKING_INACTIVE`, `RECOMMENDATION_UNAVAILABLE`) show in the rider's words (`TRACKING_ERRORS` in `lib/tracking.ts`), not the API's developer messages.

Chrome 121+ requests its optional notifications permission and subscribes to Web Push. Safari can't ask for notifications itself, so the containing app owns them. While signed in, the extension checks in with the app over native messaging (`{type: 'account'}` with the owner, session token and email; production builds only), and the app registers the device for APNs. On Safari, Preferences and the alerts dialog's confirm open the app (`rideon-notifications://notifications`): on macOS turn on a switch under **Notifications**, on iOS press **Enable notifications**. The Mac switches go to the API with the registration once `GET /push-devices/config` advertises `deviceAlerts` (API 0.39, [brief v12](../docs/extension-api-brief-v12.md)), and later changes `PATCH` it. The Mac app's **Sign Out** unregisters the Mac, ends the session (`POST /api/auth/sign-out`) and signs the extension out: at once over `SFSafariApplication.dispatchMessage` if it's running, otherwise at its next check-in (a `sign-out` request in the shared Keychain) or on its next API call (401). Taps open the latest tracked ride in the browser, with sign-in if needed. See [monitoring and push delivery](../docs/ride-monitoring.md#chrome-and-safari-delivery-api-v0370) for the policy, API, secure shared Keychain, server configuration and signing environments. Apple push needs a separate APNs key; WeatherKit credentials do not enable it.

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
`previewDays: 7` for the day strip. The account's tracked departure, monitoring and pause are
shared through the API; notification permission and delivery registration belong to each
installation. The background service worker calls the API, while the popup and content script
message it and render the shared state in `storage.local`. Safari's companion also calls the
device-registration API using its private Keychain session.
