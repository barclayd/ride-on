# Shared Strava connection

The connection links a Ride On account and displays completed cycling activities.
API v0.33.0 distinguishes suggested matches from logged rides in grouped date-only
history under the product policy below. Route imports from Strava and speed suggestions remain
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

Route imports, derived speed defaults and training/learning remain deferred.
Provider history stays separate from Ride On's manually logged rides.

## Automatic ride matching and history (API v0.33.0)

Production uses `STRAVA_ENABLED=true` and `STRAVA_IMPORT_ENABLED=true` in Ride On,
with `RIDEON_IMPORT_ENABLED=true` in Stitch. These are operational kill switches.
The frontend remains a separate implementation.

### Matching rules

Connecting schedules the last 90 days automatically; the 15-minute scheduler
recovers missed work. Imports consider all saved routes with usable geometry,
including untracked routes and expired plans. Planned dates are ignored.
Imported rides do not complete a dated plan, create a manual `/rides` entry, or
feed recommendation scoring or learning.

Coverage measures the saved route distance accounted for by the activity,
divided by saved route distance. Detours and extra laps are not penalties.
Each recorded path sample can account for only one planned sample; repeating
one stretch does not inflate coverage. Forward, reverse and mixed-direction
coverage count.

- At least 90% coverage: log automatically only when assessment is complete,
  direction is consistently forward or reverse, and no alternative is similarly plausible.
- At least 50% but below 90%: suggest the best matching route and wait for the
  rider's confirmation. Suggestions do not enter grouped route history or counts.
- Ambiguous, mixed-direction or incomplete assessments also require confirmation,
  even at 90%+ coverage. Alternatives are ambiguous when the second route reaches
  90% or is within five percentage points of the best route (strictly less than
  five). Missing GPS with no usable candidate cannot produce a suggestion.
- Below 50%: no suggestion, route history entry or notification.
- Candidates rank by coverage, then route ID for stable ties. One primary route
  per activity; suggested routes have no primary route until confirmed.
- Riders can correct or dismiss logged rides, even after matching evidence expires.
  Confirmations and dismissals survive repeat imports.

`strava-route-coverage-v3` uses 10-metre path samples, a provisional 12-metre
position tolerance and a 30-degree heading tolerance. Work is bounded at 100,000
input coordinates, 60,000 sampled pieces per path, 1,000 saved routes, 8 MB saved
geometry and 500,000 work units. It is deterministic; no AI service receives
Strava activity data. Geometry tolerances still need calibration with consented
real rides; automated validation uses synthetic data.

### Retained date and temporary evidence

Dan chose this product policy on 17 October 2026: retain the local ride date
against the matched saved route. Clear matches are logged automatically; uncertain
matches require confirmation under the rules above. Confirmation and data
retention are separate product decisions. Date-only retention is not a claim of
Strava approval or an exemption from the API terms; none has been supplied. It supersedes the previous product launch gate.

`strava_ride_history` stores only the activity's local calendar date (`ridden_on`)
as ride content. Owner, connection generation, activity ID, route ID, decision,
optimistic version and last verification time are operational fields needed for
ownership, grouping, deduplication, correction and source deletion. Activity IDs
are retained so webhook deletions and repeat imports address the same record.
The persistent row does not store speed, elevation, power, GPS, activity time,
route names, coverage scores, direction or candidate routes.

The private import bridge returns `riddenOn` from Strava's `start_date_local`.
Do not convert it through UTC: a ride near midnight may have a different UTC date.
Missing or invalid local dates cause a retry rather than guessing the ride date.
Migration 0014 removes old metric columns; pre-existing cached dates initially
use their UTC date until refreshed (imports had been disabled before this release).

GPS exists only during assessment. UTC start time, candidate matches and optional
review timestamps stay in `strava_activity_cache` for at most seven days from
first fetch. Refreshing does not extend that cache's original expiry. Evidence
older than 48 hours since verification is hidden, and expired cache/jobs/push
records are removed even with imports disabled. The date record survives cache
expiry for logged rides. New unconfirmed suggestions only exist in the temporary
cache: they can be offered again after a fresh import, but cannot silently become
logged dates when the cache expires. Disconnect, connection replacement or
verified revocation cascades all imported history. Verified source unavailability removes the date and cache;
deleting the saved route removes its associated dates. A dismissal is retained
as a minimal tombstone so a later sync does not recreate the match.

### Frontend API contract

Endpoints require the existing owner-bound session and return `Cache-Control:
no-store`. Disabled imports return `503 STRAVA_IMPORT_DISABLED`. Cross-account
reads and corrections are denied.

| Endpoint | Purpose |
| --- | --- |
| `GET /connections/strava/imports` | Connection/import status, requested bounds, pending/retrying job counts and sanitized errors. Session times use epoch milliseconds; scan bounds use epoch seconds. |
| `POST /connections/strava/imports` | Queue a silent import. `{}` requests the last 90 days. Optional UTC `after`/`before` request up to 366 days per request. Returns 202; concurrent scan returns 409. |
| `GET /history/routes?limit=30&cursor=…` | Groups by saved route: `routeId`, current `routeName`, `rideCount`, `firstRiddenOn`, `lastRiddenOn`, `mostRecentRide`. Dates are local `YYYY-MM-DD`. |
| `GET /history/routes/:routeId/rides?limit=30&cursor=…` | Paginated date-only occurrences, including dates whose evidence expired. |
| `GET /history/strava-rides?status=all&limit=30&cursor=…` | Date records plus temporary suggestions and unmatched activities. `all` is the default. `status=review` returns only fresh suggestions awaiting confirmation; none count in grouped history. |
| `GET /history/strava-rides/:activityId` | `{ ride, evidence, retention, cache }`. `evidence` becomes null when stale/expired; retained `ride` remains readable. |
| `PATCH /history/strava-rides/:activityId` | Confirm a suggestion or correct a logged ride: `{ "expectedVersion": 1, "routeId": "saved-route-uuid" }`. `routeId: null` dismisses. Confirmed/automatic dates can be corrected after cache expiry; new suggestions require fresh evidence. Returns the date-only `ride`. |

A date-only `ride` contains `activityId`, `source: "strava"`, `riddenOn`,
`primaryRouteId`, `suggestedRouteId`, `status`, `decision` (`automatic`, `confirmed`,
`dismissed`) and `version`. `status` is the frontend presentation state:

- `logged`: clear automatic match or rider-confirmed route; included in history.
- `suggested`: awaiting confirmation, `primaryRouteId: null`; `suggestedRouteId`
  identifies the highest-ranked candidate. Fetch detail for alternatives/coverage.
- `dismissed`: rider rejected the match, excluded from history.
- `unmatched`: fresh assessment found no candidate at 50%+.
- `unavailable`: no usable fresh assessment and no logged route.

`decision: automatic` means no manual choice has been made; it does **not** mean
that the ride is logged. Use `status` for UI behaviour. Only `status: logged`
contributes to route counts. `suggestedRouteId` is null in every other state and
is derived from fresh temporary evidence, never stored in the date record.
History responses advertise
`retention: { mode: "ride_date", activityMetricsStored: false }`.

Detail `evidence` includes the temporary UTC `startedAt`, Strava link, match
candidates, review timestamp and `fetchedAt`/`expiresAt`. Match candidates include
coverage, direction and route identity/version. No activity metrics or GPS are
returned. `cache: { mode: "temporary", maximumAgeDays: 7,
maximumVerificationAgeHours: 48 }` applies only to this evidence.

Lists accept limits 1–100 and return opaque `nextCursor` values; URL-encode them.
Order is local ride date descending, then ID ascending. Distinct activities on
the same date count separately. Refresh page one after an import or correction.
A stale version returns `409 STRAVA_RIDE_VERSION_CONFLICT`; reload before retrying.
Suggestions, dismissed, unmatched and unavailable records are excluded from
grouped route counts.

Example older-history request:

```json
{ "after": "2026-01-01T00:00:00Z", "before": "2026-07-01T00:00:00Z" }
```

### Delivery, recovery and rollout

Stitch retains the existing webhook subscription and forwards minimal refresh
hints (athlete/activity IDs, event type/time) through `RIDEON_EVENTS` to the
existing `ride-monitoring` queue. Queue failure returns 503 for Strava to retry.
Unsigned webhook bodies never authorize deletion: the consumer verifies current
resource availability, ownership and grant through the private service binding.
A missing stream removes matching evidence; only verified resource unavailability
removes history. Credentials remain in Stitch.

D1 jobs use leases, revisions and connection generations. Stale jobs cannot write
after disconnect/replacement. Repeat imports update one record per activity;
corrections/dismissals win over automatic matching. Automatic matches can change
when the source geometry or saved routes change. Source date edits update the
retained date. A 429 pauses import reads for 15 minutes across owners. Scans are
bounded at 1,000 pages and report `import_range_too_large` if exceeded.

Cron silently rescans 90 days daily and on saved-route changes. It also queues
reverification of retained dates, including rides older than 90 days, oldest
verified first (up to 100 per dispatch). Rate limits or unavailable upstreams can
delay this bounded work; retained dates remain visible while fresh evidence does
not. Source deletion events provide the prompt cleanup path.

Clear matches send “New ride logged”, inviting the rider to view or correct the
route. Suggestions send “Did you ride this route?”, inviting confirmation before
history inclusion. Payload type remains `strava_ride_match`, with the activity
ID; load the latest detail before presenting a confirmation or correction.
Backfills, unmatched activities, reviewed rides and expired pushes stay quiet. A retained activity does not re-notify when its evidence is rebuilt.
Notifications expire after 24 hours; accepted devices are skipped on retry and
stable APNs IDs reduce duplicate banners. Existing device/APNs setup is reused.

Migration 0015 reclassifies existing v2 automatic matches using cached evidence:
clear matches keep counting, uncertain matches become suggestions. Existing
confirmations/dismissals and local dates are preserved. Automatic records whose
evidence is absent stop counting until a fresh assessment; the bounded dispatcher
queues reassessment, including retained dates older than 90 days. Old client
versions are invalidated for changed automatic records. This change requires no
Stitch deployment or flag changes.

The original date-only rollout deployed the updated Stitch reader before the
Ride On consumer and migration 0014, then enabled both production import flags
and the connection flag. A short producer/consumer rollout gap is recovered by the initial 90-day scan. Staging
keeps its producer disabled until its isolated queue/consumer is provisioned.
No new Strava credentials, callback, scope or subscription is required. Roll back
by disabling both import flags; evidence cleanup continues. This schema migration
removes metric columns, so rollback must use a date-schema-compatible Worker.

References: [Strava API agreement](https://www.strava.com/legal/api),
[Strava API policy](https://www.strava.com/legal/api_policy),
[activity and stream APIs](https://developers.strava.com/docs/reference/),
[webhook lifecycle](https://developers.strava.com/docs/webhooks/).
