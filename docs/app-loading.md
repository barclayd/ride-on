# App loading: saved content first

Implemented 23 October 2026. The app restores saved rides before waiting for the network,
refreshes in place, caches route geometry and schedules opportunistic iOS background refresh.
The research below explains the design; there is no production-device timing claim yet.

## Implementation

- [`RideBoardStore`](../app/Packages/Services/Sources/Services/RideBoardStore.swift) is owned
  by the app, shared across windows and view recreation. It separates content, refresh,
  failure and authentication state. Foreground activation revalidates data; pull-to-refresh
  and settings/shortlist/window edits request fresh rankings. Concurrent loads coalesce; newer edits
  supersede older work. Routes uses the same store, while tracked-ride reads remain independent. Failed refreshes keep the board visible and retry after a minute.
- [`RideBoardRepository`](../app/Packages/Services/Sources/Services/RideBoardRepository.swift)
  performs restoration, mapping, network orchestration and atomic writes off the UI actor.
  Profile and selection load concurrently. Recommendations can appear before optional
  geometry/history enrichment finishes. The first successful recommendation is saved even
  before maps arrive; later interrupted refreshes preserve the previous snapshot.
- [`RideBoardSnapshot`](../app/Packages/Services/Sources/Services/RideBoardSnapshot.swift)
  stores a versioned envelope in `Caches/RideBoards`. It contains raw recommendation/profile
  JSON, decoded route geometry, summaries and request context. Presentation prose is rebuilt
  from canonical data and the current locale on restoration. Empty shortlists are saved too.
- Ranking reuse requires matching request/profile/selection/route/history context and a
  future forecast deadline. Missing history revisions on older APIs disable ranking reuse,
  without treating a successful recommendation as an error. Route metadata is checked on
  refresh, but unchanged geometry is neither downloaded nor decoded again.
- Weather expiry, the next midnight in the response timezone and the earliest displayed
  departure bound freshness. Stale boards are labelled as previous forecasts. Expired
  windows offer new dates even when the stored forecast is entirely in the past. Existing
  selection and open ride details survive refresh; a removed recommendation retains its
  last real detail instead of falling back to sample data.
- [`RideOnSession`](../app/Packages/Services/Sources/Services/RideOnSession.swift) persists
  a login ID separately from rotating tokens. Snapshots are scoped to account and login;
  sign-out clears the board and rejects late results. Old responses cannot rotate the
  current login's token or sign out a newer login. Concurrent profile reads share one
  request, with a two-second startup reuse window invalidated by profile writes.
- [`RideBoardBackgroundRefresh`](../app/App/RideBoardBackgroundRefresh.swift) submits the
  iOS refresh request. The app scene handles it through SwiftUI, cancels actual network
  work on expiration, and reschedules. The `fetch` mode and permitted identifier are in
  `project.yml`. macOS shares disk caching and activation refresh.

The `Loading` log category records endpoint latency/bytes, cache restoration and time from
starting the store load to publishing cached content. It omits tokens, bodies and route IDs.
A first install or purged cache still needs a network load and shows a content shell.
Map imagery remains managed by the existing MapKit/cycle-map components; a missing route geometry shows a placeholder and
route sharing stays disabled until geometry is available. Detail elevation caching remains
a separate follow-up.

## Validation

The Services tests include 13 cache/store scenarios plus profile-request coalescing. They
use temporary cache directories, an injected clock/session and a fake server, with no live
API access. Coverage includes process-style restoration, empty/corrupt caches, offline and
slow refresh, independent enrichment failure, version/history invalidation, forced refresh,
account isolation, late responses that ignore cancellation, overlapping edits, failed
window saves, background expiration, forecast deadlines and midnight/DST boundaries.

Services, Models and SharedUI formatting tests pass. iOS Simulator and macOS builds pass.
Two existing live MapKit tests remain opt-in and are skipped. XCUITest execution during implementation was blocked
by the host's Simulator Instruments service (`blessSimulatorHub`). A direct fixture-app
launch on iOS 26.0 succeeded and its Rides screen was visually checked. Physical-device
background scheduling and Release launch profiling remain to be checked. These are validation limits,
not promises that iOS will run refresh at a fixed time.

## Recommended behaviour

Open the Rides screen with the last usable saved board, then check for changes and update
it in place. Keep the current screen, selected day and navigation usable during refresh.
Use iOS background refresh to improve how often that saved board is already current.

Apple explicitly recommends displaying existing data while fetching changes asynchronously
when returning to the foreground. This is the foundation for the proposed experience.
[Apple: Preparing your UI to run in the foreground](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-foreground).

## Original loading bottlenecks

| Finding | Consequence | Source |
| --- | --- | --- |
| The view starts in `.loading`, with no disk restoration. | Every process launch waits for the network before showing rides. | [LiveRidesView](../app/Packages/Features/Sources/RideUI/LiveRidesView.swift) |
| Shortlist loads first, then settings, then recommendations, history summaries and all route metadata/geometry. | Three dependent stages; the final stage waits for its slowest request. A nonempty shortlist of N routes makes 2N + 4 requests per normal board load. | [RideBoardLoader.load and routeInfo](../app/Packages/Services/Sources/Services/RideBoardLoader.swift) |
| App startup separately loads settings and account information. | `/users/me` is fetched twice across the board and settings flows. | [RideOnApp](../app/App/RideOnApp.swift), [RiderSettingsStore.load](../app/Packages/Services/Sources/Services/RiderSettings.swift) |
| Route geometry is downloaded and decoded on every reload. | Unchanged routes add network and CPU work each time. | `RideBoardLoader.routeInfo` |
| A refresh error replaces an already loaded board with a full-screen failure. | A temporary connection problem removes useful content. | `LiveRidesView.load` |
| Reloading is driven by view appearance/settings revision, with no scene activation refresh. | Returning to a surviving view can leave old results on screen. | `LiveRidesView.body` |
| The API sends `weather.refreshAt`, but the app's response model only retains attribution from `weather`. | The app cannot tell when it can reuse the forecast-backed ranking. | `RideBoardLoader.Weather`, [API contract](api.md) |
| The Worker sets `Cache-Control: no-store`. | Increasing `URLCache` capacity alone will not solve this flow. Explicit application data persistence is needed. | [Worker middleware](../worker/src/index.ts) |

The existing in-memory [LiveWeatherProvider](../app/Packages/Services/Sources/Services/LiveWeatherProvider.swift)
cache is for direct WeatherKit calls; the live Rides board uses the API instead. Route
thumbnails already have a [disk cache](../app/Packages/Services/Sources/Services/RouteSnapshotService.swift),
but that cannot restore the board. The extension offers a useful local precedent:
[persisted state](../extension/lib/state.ts), forecast expiry checks, and preservation of
results during refresh in [background.ts](../extension/entrypoints/background.ts).

## Design rationale: persistence and refresh

Introduce an app-owned `RideBoardStore`, shared across view recreation and windows, with
separate `board`, `isRefreshing`, `refreshError` and authentication state. A repository
actor owns disk I/O and coalesces refresh requests; publishing UI state stays on the main
actor. File reading, decoding and polyline processing must explicitly execute away from
the main actor, rather than assuming that wrapping them in a `Task` moves them there.

Save after each successful load, using an atomic write to an account-scoped file in the
application's Caches directory. Restore at app startup, independently of network access.
Keep the in-memory board for warm returns. A missing, purged, corrupt or incompatible file
falls back to a first-load shell. Store a valid empty shortlist too, so users with no
routes do not get a spinner on every launch.

Use a versioned snapshot containing the board and its context: stable account ID, request
days/hours, response timezone, profile/shortlist versions, route versions, scoring version,
`generatedAt`, `fetchedAt`, `weather.refreshAt` and provider attribution. Add Codable
support or a dedicated snapshot DTO; `RideBoard` is currently only Hashable/Sendable.
The current API DTOs also need to retain IDs, versions and freshness fields they discard.
Keep canonical metric values. The board currently embeds localized prose, so also retain
the prose's units/locale and regenerate it when those change.

On foreground activation, show the cache before validation, then revalidate the shortlist,
profile, route versions and ride-history changes. Fetch independent inputs concurrently
and share the profile request with `RiderSettingsStore`. If relevant context is unchanged
and the ranking remains valid, reuse it. Otherwise fetch a replacement. Pull to refresh
explicitly requests a refresh, still leaving the current board visible.

Keep only one refresh for a given account/request. Tag each operation with a generation:
an older request must not overwrite a newer window, settings choice or login. Apply this
to memory and disk writes. On sign-out/401, clear the account's board and dependent
settings preview, cancel work and reject late completions. Key the cache by stable account
identity, not the bearer token, which rotates.

## Design rationale: data lifetimes

| Data | Proposed reuse policy |
| --- | --- |
| Ranking and forecast | Use the API's `weather.refreshAt` as the weather freshness limit. A null/missing/past value requires refresh, with backoff after failures. |
| Planning context | Re-resolve presets at midnight in the response timezone. Changed dates, hours, profile, provider, shortlist, routes or ride history require a new ranking even before forecast expiry. |
| Departure validity | A departure that has passed cannot remain the current recommendation. Refresh at the next relevant departure boundary and on activation; do not invent replacement scores or locally re-rank. |
| Route metadata and geometry | Persist by account, route ID and server version. Check versions, then fetch/decode only changed geometry. |
| Last successful board | Retain for continuity when offline, with its original timestamp and a clear stale/offline state. Expired windows show the existing window-passed design, not a future recommendation. |

The server already varies forecast refresh thresholds by ride date and provider evidence;
use its deadline instead of a client-wide arbitrary TTL. `generatedAt` describes the
assessment, not necessarily when upstream weather was retrieved. See
[planning and forecast caching](planning-api.md#provider-capabilities-caching-and-attribution)
and [the refreshAt calculation](../worker/src/recommendations/service.ts).

Refresh failures should leave content visible with a small retry message. Use a dated
"Last updated" label when the data is from another day. Preserve provider attribution
with cached forecasts. Treat very old data as a previous plan, without claiming its
conditions still meet the rider's preferences.

After persistence is working, remove optional enrichment from the first useful render:
cached geometry can draw immediately; absent thumbnails and last-ridden details can arrive
later. A failed thumbnail/history fetch should not discard successful recommendations.
Keep route sharing unavailable until its actual geometry exists. Cache detail elevation
by route version as a follow-up. Preserve stable view identities and use the existing
design-system motion tokens when fresh results arrive.

## Design rationale: background execution

Use `BGAppRefreshTask` for a short fetch that updates the same repository. Apple provides
up to 30 seconds and chooses when it runs; this is suitable for preparing saved content.
[Apple: Choosing background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).

Implementation touchpoints:

- In [project.yml](../app/project.yml), add `fetch` alongside the existing
  `remote-notification` background mode and a `BGTaskSchedulerPermittedIdentifiers`
  entry such as `com.danbarclay.rideon.refresh`. Regenerate the Xcode project.
  [Apple: Configuring background tasks](https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app).
- In the iOS app scene, register `.backgroundTask(.appRefresh(...))`. Submit one pending
  request when entering the background and reschedule after execution. Use the next
  relevant refresh boundary, with a minimum retry delay when a deadline is already past.
  Share the same request coalescing and account checks as foreground refresh.
- Respect task cancellation/expiration; preserve the previous complete snapshot if the
  refresh cannot finish. Avoid rendering maps, downloading elevation or saving user
  preference changes in this handler. SwiftUI cancels the action when its time expires.
  [Apple: SwiftUI backgroundTask](https://developer.apple.com/documentation/swiftui/scene/backgroundtask(_:action:)).
- Keep registration/scheduling iOS-specific. The macOS app can share persistence and
  refresh-on-activation without acquiring an always-running helper.

`earliestBeginDate` is a lower bound, not a scheduled execution time. Users can also
disable Background App Refresh. Therefore an on-disk board and foreground revalidation
must work independently of background execution.
[Apple: earliestBeginDate](https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate),
[Apple: Background scheduling availability](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler/error/unavailable).

## Physical-device verification

The implementation includes saved-board restoration, nonblocking refresh, request
coalescing, versioned geometry caching and opportunistic background refresh. The largest
expected benefit is removal of network waiting from a cached launch. Measure the following
on a physical device before making a speed-up claim.

Instrument launch-to-first-usable-board separately from time-to-fresh-board, plus cache
read/decode, request count, response bytes and each endpoint's latency. Use Instruments
on a physical device with a Release build. The existing
[`testColdLaunchPerformance`](../app/RideOnUITests/RideOnUITests.swift) uses a fixture board
and bypasses `LiveRidesView`, so it cannot measure this network/loading experience.

Acceptance coverage should exercise the real store with injected network and clock:
warm return; terminated-process launch with persisted data; offline/slow/failed refresh;
no-cache first launch; empty shortlist; corrupt cache; sign-out/account switching during
an in-flight request; edits racing a refresh; changed route geometry; midnight/DST and
elapsed departures; background cancellation; and background refresh disabled. Assert
that cached content appears before delayed network completion and stays usable after a
refresh failure. Verify real background scheduling on a device; simulator-only testing
does not establish scheduling behaviour.
