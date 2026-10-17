# Shared Strava connection

Implemented locally on 17 October 2026; **disabled until the coordinated rollout below**.
The connection release links a Ride On account and displays completed cycling
activities. API v0.31.0 adds separately gated automatic matching and grouped
history, described below. Route imports from Strava and speed suggestions remain
deferred. Strava history does not enter recommendation scoring or learning.

## Shared application

Ride On and Stitch use Strava application **262735**. Its Authorization Callback
Domain remains **stravastitch.com**. Stitch owns the client secret, encrypted
access/refresh tokens, per-athlete refresh coordination and the existing webhook
subscription. No Strava secret or token is copied into Ride On or the native app.

The Ride On Worker calls Stitch's named `RideOnStrava` entrypoint through the
private `STRAVA_STITCH` service binding. The ordinary Stitch website exposes no
connection lookup, token exchange or history endpoint. Both Workers must belong
to the same Cloudflare account. This deliberately couples availability and quota
to the shared service.

Consent requests Stitch's existing scopes: `read`, `activity:read`,
`activity:read_all` and `activity:write`. Ride On uses activity reads only. The
app explains that the shared connection also supports Stitch uploads. Riders can
withhold private-activity access; the API then reports `privateActivities: false`.
Missing all activity-read permission prevents connection. Revoking permissions
can affect both products because this is one Strava authorization.

## Client API

All `/connections/strava` endpoints require the signed-in Ride On owner, using
the existing bearer session or browser session. Responses use `Cache-Control:
no-store`; no credentials, private grant identifier or raw provider errors are
returned. Strava failures never cause a Ride On sign-out.

| Method and path | Result |
| --- | --- |
| `GET /connections/strava` | `{configured, connection}`; connection is null or `{status, athleteId, connectedAt, privateActivities}`. Status is `connected` or `needs-reauthorisation`. |
| `POST /connections/strava/start` | Accepts `{state, codeChallenge}`; returns 201 `{requestId, authorizationUrl, expiresIn: 600}`. Starting again invalidates the owner's previous attempt. |
| `POST /connections/strava/complete` | Accepts `{requestId, codeVerifier}`; returns `{connected: true}`. Requires the originating owner and verifier; the handoff can succeed once. |
| `GET /connections/strava/rides?page=1` | Returns `{rides, page, nextPage, fetchedAt}`. |
| `DELETE /connections/strava` | Deletes Ride On's mapping and pending attempts; returns `{disconnected: true, message}`. Stitch stays connected. |

The native client generates a random verifier (43–128 URL-safe characters) and
state (16–128 URL-safe characters). `codeChallenge` is unpadded base64url SHA-256
of the verifier. The challenge protects the Ride On handoff; Strava's own code
exchange remains server-side.

Open `authorizationUrl` in `ASWebAuthenticationSession`, supplying the Ride On
bearer session via `additionalHeaderFields` **on that initial request only**.
Validate its HTTPS origin/path before attaching the header. The browser endpoint
also requires the originating owner, so forwarding the URL to another person
does not link their Strava account. Web clients instead use their Ride On session
cookie. A native caller cannot start this flow by opening an unauthenticated URL
in an ordinary browser.

The browser receives a Secure, HttpOnly, SameSite=Lax cookie before Strava consent.
Strava redirects to `https://stravastitch.com/auth/ride-on/callback`; Stitch relays
only `state`, `code`, `scope` and `error` to a fixed Ride On endpoint. Ride On
checks the cookie/state, claims the attempt once, exchanges through the private
binding and redirects to:

```
https://api.ride-on.cc/integrations/strava/done?state=<client-state>&result=ready
```

The app validates the exact HTTPS host/path, unique state and `result=ready`,
then completes the handoff within 60 seconds. Other outcomes are `cancelled` and
`failed`; neither carries an upstream error or authorization code. Existing
Ride On associated-domain configuration handles the HTTPS authentication callback.

## Completed rides

Each entry contains `id`, `name`, `sportType`, `startedAt`, `distanceKm`,
`movingSeconds`, `elapsedSeconds`, `elevationGainM` and a `url` linking to the
activity on Strava. IDs are decimal strings; dates are UTC ISO 8601. Cycling types
are Ride, MountainBikeRide, GravelRide, VirtualRide, EBikeRide, EMountainBikeRide,
Handcycle and Velomobile. No GPS, heart rate, photos or other athletes' data are
returned.

Pages follow Strava's 30-activity pages before filtering. A page containing only
non-cycling activities can have `rides: []` and a non-null `nextPage`; clients
must still offer Load More. A full final page may require one additional request
to discover the end. `fetchedAt` describes this live read, not a background sync.

This live history endpoint does not persist history in D1, SwiftData or an app cache. The Preferences screen
clears its in-memory history when left or backgrounded, and reloads on return.
Deleted/edited Strava activities are reflected on the next read. With importing disabled, durable storage
contains only the connection mapping, scopes, timestamps, short-lived connection
attempts and bounded rate-limit counters. Disconnect clears the mapping and
attempts. Scheduled cleanup expires flow/rate-limit rows.

One Strava athlete can belong to one Ride On owner. A stable private grant ID is
stored with Stitch's encrypted account and retained across token refresh. When
Stitch forgets the account (including verified Strava revocation), a later
connection gets a new grant ID: an old Ride On mapping cannot silently regain
access. A slow history request also rechecks both this grant and Ride On's local
connection generation before returning data.

Provider errors use the normal API envelope: 409 requires reconnection, 403
requires activity permission, 429 includes `Retry-After`, 502 means the provider
is unavailable and 503 means the integration is disabled. Local start attempts
are limited to five per owner per minute; history and handoff endpoints also have
bounded request rates. The shared Strava application's limits apply to both apps.

## Coordinated rollout

1. Review the changes in both `ride-on` and `strava-stitch`. Run Ride On's
   `bun run check` and `bun run build:check`, and Stitch's `npm test`,
   `npm run typecheck`, `npm run format` and `npm run build`.
2. Deploy Stitch's **production environment** first. It adds the named
   `RideOnStrava` entrypoint and fixed callback relay without changing its
   existing sign-in callback, secrets, webhook registration or stored accounts.
3. Apply Ride On's pending D1 migrations, including `0012_strava.sql`, then
   deploy Ride On with its `STRAVA_STITCH` binding targeting the production
   `strava-stitch` Worker and `entrypoint: RideOnStrava`. Keep the feature flag
   false until both sides are in place. The repositories' normal main-branch
   deployment workflows can perform these steps in the same order.
4. Set `STRAVA_ENABLED` to the string `"true"` and deploy Ride On. Build/install
   the updated native app. No new client secret or Strava callback-domain change
   is needed.
5. On a real signed-in device, connect through Preferences → Strava, inspect
   completed rides and paging, then disconnect/reconnect. Check that Stitch can
   still open its existing activities. Real OAuth/provider access is the remaining
   production acceptance check; automated tests use synthetic accounts only.

Rollback by setting `STRAVA_ENABLED` to `"false"`. Leave the migration and private
entrypoint deployed while a binding still references it. Ride On disconnect
remains available to API callers even while disabled. Local tests run with an
injected synthetic binding; the fixed production relay deliberately cannot be
redirected to arbitrary localhost or preview URLs.

## References

- [Strava authentication and scopes](https://developers.strava.com/docs/authentication/)
- [Strava activities API](https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities)
- [Strava webhooks](https://developers.strava.com/docs/webhooks/)
- [Strava API policy](https://www.strava.com/legal/api_policy)
- [Apple initial authentication request headers](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/additionalheaderfields)

Any later durable imports, derived speed defaults or training/learning use need
their own product and retention design against the current Strava terms. This
release keeps provider history separate from Ride On's manually logged rides.

## Automatic ride matching and history (API v0.31.0)

This backend feature is implemented behind **`STRAVA_IMPORT_ENABLED=false`**.
Stitch's event producer is separately gated by **`RIDEON_IMPORT_ENABLED=false`**.
The existing live `/connections/strava/rides` endpoint remains available under
its original connection flag. No frontend changes are included in this phase.

### Matching rules

Connecting schedules the last 90 days automatically; the 15-minute scheduler
recovers missed work. Imports consider every saved route with usable geometry,
including routes with no tracked plan and routes whose plans have expired.
Planned dates do not affect matching. Importing a ride never marks a dated plan
complete, creates a manual `/rides` entry, or changes recommendation scoring.

Coverage is the distance of the saved route accounted for by the activity,
divided by the saved route's distance. Extra distance, detours and extra laps
are not penalties. Each recorded path sample can account for only one planned
sample, so riding the outbound half of an out-and-back cannot count as both
halves. Forward and reverse directions count; reverse matches are labelled.

- At least 90% coverage: automatically select one clear primary route.
- At least 50% but below 90%: suggest the route for confirmation.
- Below 50%: no suggestion.
- Multiple routes reaching 90%, or the two best matches within five percentage
  points, require a choice. Mixed-direction evidence also requires review.
- Missing GPS, gaps greater than 500 metres, missing saved geometry or an
  incomplete bounded assessment never produce an automatic match.

`strava-route-coverage-v1` samples path distance at 10 metres, uses a provisional
12-metre position tolerance and a 30-degree heading tolerance, and scores both
orientations. It is deterministic; no AI service receives Strava data. These
geometry tolerances need calibration with consented real rides before rollout.
Assessment is bounded at 100,000 input coordinates, 60,000 sampled pieces per
path, 1,000 saved routes, 8 MB of saved geometry and 500,000 work units (planned pieces plus nearby comparisons).
Incomplete results can offer candidates for review but cannot auto-match.

### Frontend API contract

All endpoints require the existing owner-bound Ride On session and return
`Cache-Control: no-store`. Imports must be enabled; otherwise these endpoints
return `503 STRAVA_IMPORT_DISABLED`. Other accounts cannot read or review rides.

| Endpoint | Purpose |
| --- | --- |
| `GET /connections/strava/imports` | Connection/import status, requested bounds, pending/retrying job counts and sanitized error codes. Session timestamps are epoch milliseconds; requested scan bounds are epoch seconds. |
| `POST /connections/strava/imports` | Queue a silent import. `{}` requests the last 90 days. Optional UTC `after` and `before` request older history, up to 366 days per request. Returns 202; a concurrent scan returns 409. |
| `GET /history/routes?limit=30&cursor=…` | One row per matched saved route: `routeId`, current `routeName`, `rideCount`, `firstRiddenAt`, `lastRiddenAt` and `mostRecentRide`. |
| `GET /history/routes/:routeId/rides?limit=30&cursor=…` | Paginated occurrences of one saved route, newest first. |
| `GET /history/strava-rides?status=review&limit=30&cursor=…` | Unconfirmed suggestions. `status=all` also includes automatic/confirmed matches, dismissed rides and rides with no matching evidence. |
| `GET /history/strava-rides/:activityId` | Fetch a ride for review or a push deep link. |
| `PATCH /history/strava-rides/:activityId` | `{ "expectedVersion": 1, "routeId": "saved-route-uuid" }` confirms or corrects the one primary route. `routeId: null` dismisses it. Any route owned by the rider can be chosen. |

List endpoints return opaque `nextCursor` values (URL-encode them) and accept
limits from 1 to 100. Ordering is newest ride first with ID as the tie-breaker.
Refresh the first page after an import or correction; lists are not immutable
snapshots while new rides arrive. Unconfirmed suggestions are excluded from
route counts. Automatic matches remain in history while inviting review.

A ride contains only `activityId`, `source: "strava"`, `stravaUrl`, `startedAt`
(UTC), `averageSpeedMps` (metres/second), `elevationGainM` (total climbing, metres),
`averagePowerWatts`, and `powerSource` (`meter`, `estimated`, or null), plus the
match/review and cache metadata. Missing metrics are null, never invented zeros.
Power is Strava's reported average power, not normalized or weighted power.
GPS is fetched transiently through the private bridge and is never stored in D1
or returned by these public history endpoints. Activity titles, descriptions,
heart rate, elapsed time and full provider payloads are not persisted.

`match` contains `matcherVersion`, `status`, `reason`, `assessmentComplete`,
`primaryRouteId` (the algorithm's choice) and up to 50 candidate routes. Each
candidate includes route ID/name/version, coverage fraction, covered distance
and direction. The ride's **top-level `primaryRouteId` and `decision`** are the
accepted result after any rider correction; use these to display history.
`decision` is `automatic`, `confirmed` or `dismissed`. `version` increments on
sync and review. A stale `expectedVersion` returns
`409 STRAVA_RIDE_VERSION_CONFLICT`; reload before retrying the user's choice.
A confirmed or dismissed decision is never overwritten by a later sync while
that cache record exists. An expired/missing ride returns 404.

Example older-history request:

```json
{ "after": "2026-01-01T00:00:00Z", "before": "2026-07-01T00:00:00Z" }
```

### Delivery and recovery

Stitch keeps its single existing Strava webhook subscription. Activity events
are reduced to athlete/activity IDs, event type and time, then durably sent to
Ride On's existing `ride-monitoring` queue through `RIDEON_EVENTS`. Queue delivery
failure returns 503 so Strava can retry. Public callers cannot access the named
`RideOnStrava` entrypoint or the import readers. Unsigned webhook bodies are
refresh hints: activity ownership, current resource availability and the private
grant are checked against Strava before publishing a match or removing one.
Only an actual activity-detail 404/non-cycling/private-without-access response
removes an activity; a missing stream merely removes matching evidence.

D1 jobs have leases, revisions, connection-generation checks and a queue outbox.
Duplicate delivery is safe, completed devices are skipped on retry, and an old
request cannot write after disconnect or account replacement. Jobs and GPS work
are bounded; a scan exceeding 1,000 pages reports `import_range_too_large` and
requires a narrower request. Transient failures, including Strava rate limits,
retry after at least 15 minutes. A rate-limit response pauses all Ride On import
reads for 15 minutes; push deliveries can continue. The shared application's
quota still applies.
The scheduler silently rescans 90 days daily and when it detects saved-route
changes, and revalidates older cached activities daily. Older requested history
must be requested again after cache expiry.

A newly uploaded activity with an automatic match or suggestion creates a push
outbox entry. APNs uses the existing owner-scoped device registrations and
credentials. The payload has `type: "strava_ride_match"` and `activityId`, with a
"New ride logged" alert inviting confirmation/correction. It contains no GPS or
route name. Historical backfills, unmatched activities, already reviewed rides
and expired notifications do not notify. Delivery expires after 24 hours;
stable APNs IDs/collapse IDs reduce duplicates, but delivery is at least once,
not a promise that a device displays exactly one banner. The frontend is
responsible for opening the review UI and managing its presentation.

### Retention and launch gate

**This is a temporary cache, not a permanent ride archive.** Strava's API data
terms also apply to the requested date/speed/elevation/power fields and derived
matches; omitting GPS does not establish permission for indefinite retention.
No written retention permission has been supplied. Both import flags therefore
remain off, and all validation uses synthetic activities.

Imported records, reviews, delivery records and job identifiers have a hard
seven-day lifetime. Refreshing does not extend a record's original expiry.
API reads additionally hide data that has not been verified within 48 hours.
Scheduled cleanup runs even with importing disabled. Disconnect, a replaced
connection generation, verified revocation or permission loss cascades deletion;
a verified missing activity removes its cached match and deliveries.

Every history response includes `cache: { mode: "temporary", maximumAgeDays: 7,
maximumVerificationAgeHours: 48 }` and every ride has `fetchedAt`/`expiresAt`.
**Corrections survive syncs, but currently expire with the seven-day record.**
Permanent grouped history and permanent corrections remain a launch constraint:
obtain Strava's written permission and agree the corresponding retention model
before enabling this as an enduring history feature. Do not bypass this gate by
copying cached matches into the permanent manual ride/learning tables.

For rollout, apply `0013_strava_imports.sql` and deploy Ride On's queue consumer
before enabling Stitch's producer. Both repositories can deploy with their new
flags false. Production reuses the already-provisioned `ride-monitoring` queue;
Stitch staging uses `ride-monitoring-staging`, which must have an isolated test
consumer provisioned before staging event delivery is enabled. No new Strava
client secret, OAuth callback, subscription or scope is required. After resolving
retention, configure both import flags and the existing connection flag together,
and perform a consented live acceptance check. Roll back by disabling both import
flags; cache expiry/deletion continues. No live imports or push sends were used
for automated validation.

References: [Strava API terms](https://www.strava.com/legal/api_policy),
[activity and stream APIs](https://developers.strava.com/docs/reference/),
[webhook lifecycle](https://developers.strava.com/docs/webhooks/).
