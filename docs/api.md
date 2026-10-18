# Ride On API MVP

API v0.37.0 adds [Chrome Web Push and Safari companion delivery](ride-monitoring.md#chrome-and-safari-delivery-api-v0370), transport-specific readiness and an authenticated browser view for notification taps. Monitoring policy and scoring are unchanged.

Implemented on 9 October, calibrated and first deployed on 10 October 2026. TypeScript, Hono and Cloudflare Workers;
D1 stores route facts, source identities, shortlists, ride history and user profiles, KV caches forecasts, and a deterministic evaluator ranks
route/departure combinations. This replaces the legacy classification and Strava
OAuth endpoints. The existing app clients have not yet been migrated.

API v0.11.0 adds [ride history and recent-route preferences](ride-history.md).
API v0.12.0 adds [planned ride snapshots, next-window suggestions and route-history summaries](extension-api-brief-v3.md).
API v0.13.0 adds the [Safari extension sign-in](authentication.md#safari-extensions) landing page and CORS.
API v0.14.0 presents [one Met Office provider choice](weather-provider-choices.md) alongside Apple Weather.
API v0.15.0 adds [wind and precipitation descriptions](#condition-chip-summaries) and [saved display units](#display-units). Scoring remains `comfort-v0.10`.
API v0.16.0 adds a `maximumTemperatureC` [minimum standard](#personal-minimum-standards) for rides that get too hot.
API v0.17.0 adds `weather.refreshAt` to recommendations: when the cached forecast behind them goes stale, so clients can reuse a ranking until then.
API v0.18.0 corrects Met Office BPF array decoding and introduces `comfort-v0.11`: gradual wind discomfort and stronger gust penalties. See [wind comfort calibration](#wind-comfort-calibration-v011).
API v0.19.0 adds [separate planning days](planning-api.md#search-dates-and-optional-preview): `days: {kind: "dates", dates}` and `range.dates` on every non-null range. Scoring remains `comfort-v0.11`.
API v0.22.0 adds the opt-in [experimental ground assessment](ground-assessment-api.md), using v0.21.0 [cached ground evidence](ground-evidence-api.md) and v0.20.0 [located surfaces](#route-surface-evidence). Phase 3 model mechanics are implemented; [real-world calibration](ground-calibration.md) is pending. The [phased plan](ground-conditions-plan.md) keeps scoring unchanged at `comfort-v0.11`.
API v0.23.0 adds temperature interpolation and ride-scoped forecast details (`comfort-v0.12`); see below.
Algorithm `comfort-v0.14` rewards the sustained forward component of diagonal tailwinds in proportion to distance, retaining the separate crosswind/gust discomfort and bounded benefit introduced in v0.13. It is checked against the 14 October preference interview and a saved route-level forecast replay.
API v0.24.0 adds an explicit [helpful-tailwind preference](#helpful-tailwind-preference). Algorithm `comfort-v0.15` applies the calibrated assistance bonus only when the rider opts in; new and existing profiles otherwise receive no bonus.
API v0.25.0 adds [wind bearing and comparable previous scores](redesign/ride-detail-api-requests.md), [factor point-loss explanations, crosswind levels and linked sign-in methods](redesign/preferences-api-requests.md). Algorithm `comfort-v0.15` and existing rankings are unchanged. Seasonal floors, automatic gust-setting coupling and linked wind/distance units were declined in the contract review; Strava connection metadata awaits a real OAuth/sync implementation.

API v0.27.0 adds an explicit [tailwind opportunity preference](tailwind-opportunity.md), with up to five recommendation-priority points separate from Conditions (algorithm `comfort-v0.17`). It defaults off and reuses cached weather.

API v0.29.0 adds compact route `outline` sketches and per-departure `windStretches`
for the wind dropdown. These reuse stored geometry and the existing observations;
no extra weather requests, scoring changes or forecast-cache invalidation.
The reviewed [extension brief v7](extension-api-brief-v7.md) records the contract
and the decision to preserve short wind sections. Scoring remains `comfort-v0.17`.

API v0.35.0 adds display-only temperature traces, feels-like values, hourly precipitation amounts and a UK monthly climate comparison. Scoring remains `comfort-v0.17`; see [temperature and rain along the ride](#temperature-and-rain-along-the-ride-v0350).

API v0.34.0 adds [account-wide pauses](#pause), including automatic return dates and quiet resumption of scheduled monitoring. Scoring remains `comfort-v0.17`.

API v0.33.0 separates [Strava route suggestions from grouped date-only history](strava.md#automatic-ride-matching-and-history-api-v0330). Clear matches at 90%+ coverage are logged automatically; 50–89% and ambiguous or incomplete matches require confirmation. Confirmed dates and corrections survive temporary evidence expiry.

API v0.28.0 adds [tracked ride plans](ride-tracking-api.md): server-issued recommendation references, one active plan per account, immutable accepted baselines, manual refresh and retained assessment history. API v0.30.0 adds [scheduled monitoring, notification decisions, device registration and Apple push delivery](ride-monitoring.md); app notification integration follows separately. Scoring is unchanged at `comfort-v0.17`.

API v0.26.0 adds opt-in [cold sensitivity and local seasonal tolerance](seasonal-temperature.md) with algorithm `comfort-v0.16`. Existing profiles retain standard, season-independent scoring. Monthly hard minimums remain user-chosen.
API v0.10.0 added [multi-day planning, preference presets and richer result metadata](planning-api.md).
That guide is the authoritative contract for the extension's next integration.

The [shared Strava connection API](strava.md) adds account connection, disconnect
and live completed cycling history under `/connections/strava`. It is disabled
pending a coordinated Stitch/Ride On rollout. Route imports and speed suggestions
remain deferred.

## Run locally

Use Node.js 24+ and Bun 1.4.0. From `worker/`:

```sh
bun install --frozen-lockfile
# On a new checkout, copy .dev.vars.example to .dev.vars and fill its placeholders.
bun run migrate:local
bun run dev:session
bun run dev
```

`.dev.vars` contains `APPLE_WEATHER_CONFIG_JSON`, `MET_OFFICE_API_KEY`,
`MET_OFFICE_BPF_API_KEY` and a separate local `AUTH_CONFIG_JSON`. `dev:session` creates a 24-hour bearer session in local
D1 and saves it to ignored, owner-readable `.local-session.json`; it never accesses
production. Pass an existing local owner ID to reuse that local dataset. The
current checkout's weather secrets must not be overwritten. Secrets and local
database state are ignored by Git. Route IDs in local live reports refer to local D1.

Product endpoints, including `/weather-providers`, require a session cookie or session bearer token. `/health`,
authentication provider discovery and login entrypoints are public. Responses use
`Cache-Control: no-store`. Cookie writes and browser CORS use exact trusted origins;
Safari extension origins get CORS without credentials.
See [authentication](authentication.md) for Apple, Google, passkeys, extension
handoff and account linking. Legacy private API keys and the profile-claim endpoint
have been retired; clients use normal sign-in.

## Users and saved preferences

`POST /users` creates the authenticated rider's cycling profile; it does not issue
a login token. New social logins receive server-assigned owner IDs on first product
API access. Existing login-to-owner bindings are retained automatically; no claim
step is needed. Clients cannot choose another user ID or read/update somebody else's profile. Saved settings stay independent of the
login provider.

```http
POST /users
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "displayName": "Dan",
  "settings": {
    "timeZone": "Europe/London",
    "riding": { "averageSpeedKph": 20, "departureStepMinutes": 30 },
    "preferences": {
      "wind": { "comfortableCrosswindKph": 5, "crosswindSensitivity": 5 },
      "weights": { "temperature": 0.15, "wind": 0.4, "dryness": 0.2, "clearSkies": 0, "sunshine": 0.25 }
    },
    "weather": { "mode": "strict", "providerId": "met-office" },
    "forecast": { "representation": "deterministic", "freshnessBasis": "model-run" }
  }
}
```

Returns `201 { "user": { "id": "user_<server-generated-id>", "schemaVersion": 1, "version": 1,
"displayName": "Dan", "createdAt": "...", "updatedAt": "...", "settings": { ... }, "pause": null } }`
with every resolved setting and `Location: /users/me`. `settings` is optional at
creation; omitted values use the documented API defaults. This example is a
partial profile, not an import of the complete reviewed profile.

`GET /users/me` returns the saved user. `PATCH /users/me` changes selected values:

```json
{
  "expectedVersion": 1,
  "settings": {
    "preferences": {
      "temperature": { "comfortMinC": 12 },
      "minimumStandards": { "maximumGustKph": 35 }
    }
  }
}
```

The patch can also set `displayName`. It merges nested settings and validates the
complete result before writing, returning the updated user with an incremented
`version`. Include the version you last read as `expectedVersion`; a stale or
concurrent update returns `409 USER_VERSION_CONFLICT`. Read the current profile
and reconcile before retrying. Duplicate creation returns `409 USER_ALREADY_EXISTS`;
a missing profile returns `404 USER_NOT_FOUND`. Failed writes do not replace it.

Omitted values are preserved, including other weights and minimum standards.
`minimumStandards: {}` preserves all limits. Set an individual limit to `null`
to remove it, e.g. `{ "maximumGustKph": null }`. A `minimumTemperature` policy
(including a monthly map) replaces the previous policy as a whole. A `weather`
policy also replaces the whole source selection. `preferences.distance` replaces
both bounds together, and `null` removes the distance preference. Other settings
reject nulls. See [preferred distance](#preferred-distance).
Changing weather product does not implicitly change forecast statistics: save
`weather` and `forecast` together when switching between Global Spot and BPF.

Recommendations resolve **API defaults → saved user settings → request overrides**.
Request overrides never write to the profile. A caller without a saved profile
uses the current API defaults and per-request settings. From v0.9.0 these select
Apple Weather; existing saved source policies are preserved. Responses
include `savedUser: { "id": "dan", "version": 1 }` (or `null`) and the exact
resolved settings, so a result can be traced to the profile used. Date, route IDs
and the day's time window belong to the recommendation request, not the profile.

### Pause

From v0.34.0, every user response (`POST /users`, `GET /users/me`,
`PATCH /users/me`, and the pause endpoints) includes a top-level `pause`, next to
`settings`. It is `null` when Ride On is on, otherwise:

```json
{
  "until": "2026-10-25",
  "resumesAt": "2026-10-24T23:00:00.000Z",
  "pausedAt": "2026-10-18T09:12:00.000Z"
}
```

`until` is the local return date. `resumesAt` is the UTC instant of the start of
that day in `settings.timeZone` (default `Europe/London`), including days where a
clock change skips midnight. Clients compare against this instant rather than
calculating it. A time-zone edit recalculates the return instant. At or after it,
reads return `pause: null` without needing a storage cleanup or a client write.
`until: null` and `resumesAt: null` mean paused until explicitly turned back on.

```http
PUT /users/me/pause
Content-Type: application/json

{ "until": "2026-10-25" }
```

Use `{ "until": null }` for an indefinite pause. A date must be a real
`YYYY-MM-DD` date after today in the profile's zone and no more than 365 calendar
days ahead. Invalid, past, same-day and over-limit dates return
`422 PAUSE_DATE_OUT_OF_RANGE`; a missing key, wrong type or unknown field returns
400. The response is `200 { "user": { … } }`, with the complete profile.
Changing the return date keeps `pausedAt`; repeating a request is idempotent.
Starting again after expiry records a new `pausedAt`.

`DELETE /users/me/pause` turns Ride On back on immediately and returns the same
whole-user response with `pause: null`. It also succeeds when already on. Both
endpoints require the existing owner session, return `404 USER_NOT_FOUND` for a
missing profile, and use `Cache-Control: no-store`.

Pause writes are last-write-wins and do not accept `expectedVersion`, increment
`version`, or change `updatedAt`. Pause state lives in a separate `user_pauses`
table, outside `user_json`: a concurrent preference edit cannot erase it and a
pause cannot cause a preference-version conflict. The user `schemaVersion` stays
1. `PATCH /users/me`, saved settings and recommendation overrides reject pause
fields; use the dedicated endpoints.

While paused, [scheduled monitoring](ride-monitoring.md#account-pauses) makes no
assessments or weather calls, sends no alerts of any kind and cancels pending
deliveries. Plans and their accepted baselines stay intact. Explicit or automatic
resume starts with a quiet reference assessment; missed summaries are dropped.
The 15-minute cron handles dated returns with no client open.

Recommendations, next-window searches, manual refresh, tracked-ride creation and
route endpoints remain available. Clients read `user.pause` when opening or
returning to the foreground, hide forecasts/scores/check-ins, keep the route name
and distance, and stop automatic forecast calls while paused. The extension also
reads on a daily alarm and at `resumesAt`; on resume it fetches fresh recommendations.
The extension's default pause sends today + 7 in the rider's zone; its other
choices send today + 3 or `null`. The browser extension uses these endpoints; the
app does not yet.

### Tailwind opportunity preference

From v0.27.0, `settings.preferences.wind.prioritiseTailwindOpportunities` adds
optional priority for predominantly one-way rides with sustained favourable wind.
It defaults false, requires `preferTailwind: true` to be active, and changes ordering
without changing Conditions. See the [preference, response fields, client handoff
and calibration](tailwind-opportunity.md).

### Helpful-tailwind preference

From v0.24.0, `settings.preferences.wind.preferTailwind` is a boolean. It defaults
to `false`, including when an older stored profile lacks the field. A read resolves
that default without writing to D1 or changing the profile version. A general wind
weight or wind comfort threshold does not imply this preference.

Use a **"Prefer helpful tailwinds"** switch. `true` means the rider prefers useful
sustained assistance over otherwise equally comfortable calm conditions. `false`
means no extra preference for assistance; it does **not** mean the rider actively
dislikes tailwinds or that every windy ride must rank below calm. Ordinary
headwind, crosswind and estimated gust discomfort still apply in both modes.

Read `GET /users/me` → `user.settings.preferences.wind.preferTailwind` and save
through the existing authenticated endpoint with the last-read `user.version`:

```http
PATCH /users/me
Content-Type: application/json
```

```json
{
  "expectedVersion": 1,
  "settings": {
    "preferences": {
      "wind": { "preferTailwind": true }
    }
  }
}
```

The response returns the resolved user and incremented version. `POST /users`
accepts the same nested setting at creation. Omitted fields preserve the saved
choice, including when an older client sends other wind fields. Explicit `false`
turns the bonus off. Null, strings, numbers and unknown fields are rejected with
400; stale writes return `409 USER_VERSION_CONFLICT` without changing settings.

Both `POST /recommendations` and `POST /recommendations/next-windows` accept a
temporary override at `preferences.wind.preferTailwind` (without the `settings`
wrapper). Single-day and multi-day searches use the same resolution:
defaults → saved profile → request overrides. Responses expose the effective value
at `resolvedPreferences.wind.preferTailwind`. Overrides never save themselves.

When enabled, the [v0.14 assistance curve](#wind-exposure-and-assistance-v014)
and assistance tie-break are unchanged. When disabled, each departure's
`windAssistance.potentialPoints` and `appliedPoints` are zero, so assistance also
cannot break a score tie. `usefulDistanceFraction` still describes the forecast;
it can be positive with the preference off. Wind discomfort, raw gust limits,
weather facts, speed/duration and other preferences are independent of the switch.
Zero wind weight still disables the bonus even when the switch is on.

After saving, clients should request fresh rankings using the returned profile
version and invalidate cached recommendation responses from `comfort-v0.14`.
Include the resolved preference (or saved profile version, plus request overrides)
and algorithm version in client ranking-cache identity. There is no need to wait
for weather expiry: the API reuses cached forecasts and evaluates the new choice.
Saved ride-plan snapshots retain their original scores and algorithm version.

**Rollout:** there is no automatic opt-in or per-user data migration. Riders who
want the former tailwind bonus must save `true` through the UI. With that explicit
choice, all 31 departures in the saved 14 October Horsham/Richmond replay match
v0.14 exactly: Horsham 08:00 scores 83.67; Richmond 09:00 scores 82.86. This is a
fixed forecast replay, not a promise about new live forecasts. No production
profile or forecast data is changed by this release.

### Display units

From v0.15.0, profiles can include optional
`settings.units: { temperature: "C" | "F", windSpeed: "kmh" | "mph" }`.
Both switches are independent; Celsius with mph is valid. Omitted units stay absent
on old and new profiles, so the client can choose its regional default until the
rider saves a choice. Reads never infer a region or change a profile's version.

Create with `POST /users`, or update with `PATCH /users/me`:

```json
{
  "expectedVersion": 1,
  "settings": {
    "units": { "temperature": "C", "windSpeed": "mph" }
  }
}
```

Send both fields when changing units; the complete pair replaces the saved pair.
Omitting `units` preserves it. Partial pairs, null and unknown values/keys are
rejected. The existing optimistic version check applies. Distance remains in
`settings.display.unit: "km" | "mi"`; there is no second distance-unit setting.
Units only control client display. Every API temperature, wind speed, distance
and preference retains its documented measurement unit; scores, thresholds,
forecast requests and cache reuse are unaffected.

## Upload a route

`POST /routes` accepts UTF-8 GPX in an `application/gpx+xml` body, or
`multipart/form-data` with exactly one `file` and an optional `name` string.
Returns HTTP 201 with:

```json
{
  "route": {
    "id": "a-generated-UUID",
    "name": "Imported ride",
    "createdAt": "2026-10-09T18:00:00.000Z",
    "distanceM": 84000,
    "ascentM": null,
    "originalPointCount": 652,
    "warnings": ["MISSING_ELEVATION"],
    "source": null,
    "version": 1,
    "updatedAt": "2026-10-09T18:00:00.000Z"
  }
}
```

Supports one GPX 1.0/1.1 track or route per file, including connected track
segments. Rejects malformed XML, DTDs, invalid coordinates, disconnected segments,
multiple tracks/routes, gaps over 5 km, files over 5 MB, more than 50,000 points,
and routes outside 100 m–400 km. Duplicate consecutive points are removed. Missing
elevation remains unknown; available ascent is an unsmoothed estimate. Traversal
order is preserved. GPX export is the current Garmin/cycle.travel import path;
there are no account connections yet.

Upload derives distance, direction and sections of at most 500 m, plus weather
locations every 10 km and the endpoint. Geometry is processed once; preferences
are never stored on the route. The original file is fingerprinted with SHA-256;
the stored record contains weather samples and, from v0.11.0, a bounded path
for [ride-history overlap](ride-history.md), rather than the original GPX file.
Plain file uploads to this endpoint create distinct IDs. For repeatable external
imports, use `POST /route-imports` below. Neither endpoint changes the shortlist.

## External route imports and library

`GET /route-sources` advertises the configured source adapters. The initial sources
are `cycle-travel`, `garmin` and `strava`, each reporting
`importModes: ["gpx-upload"]` and `accountConnection: false`. All three accept a
GPX export supplied by the user or an extension. This does **not** sign in to their
accounts, enumerate saved rides, or fetch arbitrary URLs. Source identity is
client-supplied provenance, not proof of ownership on the external site.

```http
POST /route-imports
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "source": { "providerId": "cycle-travel", "externalId": "12345" },
  "gpx": "<gpx version=\"1.1\">...</gpx>",
  "name": "Weekend loop"
}
```

`gpx` is the complete UTF-8 GPX document, JSON-escaped by the client; the abbreviated
example above is not a valid route. `name` is optional; otherwise the GPX name is
used. The built-in adapters require the saved journey/route/course ID as a
positive decimal **string**, without leading zeros (up to 40 digits). Keep Strava's
large IDs as strings throughout the client. Do not use a URL, display name, or
filename as the external ID. Requests are bounded to 6 MB of JSON, with the same
5 MB GPX byte limit and geometry validation as file uploads.

Returns `{ "outcome": "created", "route": { ...summary, "source": { ... },
"version": 1, "updatedAt": "..." } }` with HTTP 201 and
`Location: /routes/<id>`. Identity is unique per authenticated owner, source and
external ID; the same ID on different sites or for different users is independent.

- An identical GPX, effective name and supplied surface evidence returns HTTP 200 with `outcome: "unchanged"`.
  The route ID, timestamps and version stay unchanged, including concurrent retries.
- To change the GPX, name or surface evidence, send the same source identity with `expectedVersion`
  equal to the current route version. Returns HTTP 200 with `outcome: "updated"`
  and an incremented version. The route ID and creation time are preserved;
  direction, distance and weather sampling are rebuilt from the new geometry.
- A changed import without a current version returns `409 ROUTE_VERSION_CONFLICT`.
  Stale versions also conflict on identical data. Read the current source match,
  reconcile the change, and retry deliberately; do not blindly retry stale content.
  Failed or racing writes cannot partially replace the saved route.

Identity comes from the source ID, not matching geometry. Exporting the same ride
from two different sites creates two entries; a plain file upload isn't automatically
linked to a later source import. Byte changes anywhere in the GPX count as changes,
even if its geometry is equivalent. No automatic identity merging is applied. When the recent-rides preference is
active, [geometric overlap](ride-history.md) can lower scores across different IDs.

`GET /routes/<id>` returns one owned summary with source, version and timestamps.
`GET /routes/<id>/geometry` returns `{routeId, version, geometry}`: the stored
`polyline6` path (`{version, encoding, data, pointCount}`) for drawing the route, or
null when the GPX was too sparse or large. It carries no elevation.
Recommendation route results also carry a compact `outline` (at most 64 points),
so cards can draw a display sketch without fetching this full path. The sketch
is not navigation geometry; see the wind sections contract below.
`GET /routes` returns `{ "routes": [...], "limit": 100, "nextCursor": null }`.
Use `limit=1..100` and the returned `cursor` for additional pages, retaining any
filters. Ordering is newest creation first, then route ID; refreshing a source
does not reorder it. New imports may appear on a refreshed first page.

Filter by `sourceProviderId`, optionally with `sourceExternalId`, to map an external
saved ride to its API ID without importing it again:

```http
GET /routes?sourceProviderId=cycle-travel&sourceExternalId=12345
```

Existing uploads remain valid after migration, with `source: null`, `version: 1`
and `updatedAt` equal to their original creation time. Another owner's route returns
404, and another owner's pagination cursor is rejected.

## Route surface evidence

`POST /route-imports` accepts an optional `surface` object for `cycle-travel`.
It is client-supplied classification evidence from the saved journey, not an
independent survey or a wetness assessment. No rainfall or scoring change is
enabled. The extension reads the existing journey response's directions; it
does not make a new routing or weather request for surfaces.

Example for a GPX whose geometric length is 1,000 metres:

```json
{
  "schemaVersion": 1,
  "source": {
    "providerId": "cycle-travel",
    "method": "route-instructions",
    "formatVersion": 2,
    "mappingVersion": 1
  },
  "geometryDistanceM": 1000,
  "sections": [
    { "fromM": 0, "toM": 600, "surface": "paved", "sourceCode": "mode:13" },
    { "fromM": 600, "toM": 1000, "surface": "unpaved", "sourceCode": "mode:15" }
  ]
}
```

Positions are cumulative metres along the original GPX, before simplification.
Intervals must be ascending, non-overlapping, positive in length and within
`geometryDistanceM`; gaps remain unknown. The GPX length must agree within 1 m
(rounding tolerance, scaled to the server's distance). Maximum 5,000 sections,
400 km, existing 6 MB JSON/5 MB GPX limits. Schema errors return `400 BAD_REQUEST`;
source/length/range mismatches return `422 INVALID_SURFACE_EVIDENCE` without
changing the stored route. The server adds its GPX `sourceHash` and a `capturedAt`
retrieval timestamp. This ties evidence to these uploaded bytes; it does not
verify the client's material claims against the external site.

Surface values are `paved`, `compacted`, `gravel`, `rough-unpaved`, `earth`, `dirt`,
`grass`, `sand`, `unpaved`, `unknown` and `non-cycling`. Raw category codes are
retained, without road names. Version 1 explicit materials are retained; version
2 broad modes do not imply soil or drainage. Paved footpaths/cycleways stay paved,
unsurveyed roads stay unknown, and ferries/identified bus and rail legs are
non-cycling. Unfamiliar/malformed direction formats cause the extension to omit
surface evidence, preserving normal GPX import.

Every route summary now includes `surfaceSummary`:

| Field | Meaning |
| --- | --- |
| `status` | `complete`, `partial` or `unavailable` classification coverage |
| `pavedM`, `unpavedM`, `nonCyclingM`, `unknownM` | Metres across the whole route; gaps contribute to unknown |
| `classifiedFraction` | Known paved/unpaved/non-cycling share of total distance, 0–1 |
| `unpavedFraction` | Total-route unpaved share, 0–1; **null** whenever coverage is incomplete |
| `source`, `capturedAt` | Evidence provenance and retrieval time, or null |

`GET /routes/<id>/surface` returns `{routeId, version, surface, summary}`. `surface`
contains the stored evidence and sections, or null; `summary` has the same shape
as `surfaceSummary`. Authentication and owner isolation match route reads.
Old GPX imports report unavailable coverage and their full distance as unknown.
Unknown source codes may still have stored evidence even with unavailable coverage.

Surface-only enrichment needs the current `expectedVersion`, increments the route
version once, and preserves ID, creation time, shortlist and geometry/history
identity when the GPX bytes match. Identical retries keep timestamps and version.
Omitting `surface` with unchanged GPX bytes preserves any existing evidence,
including name-only edits by older clients. Changing the GPX without supplying
new evidence discards the old surfaces. There is no explicit clear operation in
v1. A first-import race with different supplied evidence returns a conflict.

The extension upgrades its local import marker once per tracked journey/source
update. It reuses the normal journey/GPX refresh, including its elevation request;
the enrichment itself does not rerank or fetch weather. Journeys without supported
surface data are also marked attempted, avoiding repeated imports on every visit.
Users receive this behavior after installing the updated extension. Future adapter
changes must advance the marker/mapping version if re-enrichment is required.

## Saved shortlist

The library contains imported rides; the shortlist contains the small set the rider
currently wants to consider. Removing a route from the shortlist keeps it in the
library, ready to select again later. Importing or refreshing a route never selects
or reselects it. No saved user profile is required, but the bearer token must map
to an owner as usual.

`GET /route-selection` initially returns:

```json
{ "selection": { "version": 0, "routeIds": [], "updatedAt": null } }
```

`PUT /route-selection` replaces the entire shortlist, preserving the submitted order:

```json
{
  "expectedVersion": 0,
  "routeIds": ["replace-with-an-owned-route-UUID"]
}
```

Returns HTTP 200 with `selection`, the incremented version and update timestamp.
Use the last-read version for subsequent edits. Concurrent/stale writes return
`409 SELECTION_VERSION_CONFLICT`; re-read and reconcile before retrying. Select up
to 12 distinct owned routes; `[]` clears the shortlist. Unknown/unowned IDs reject
the whole update with 404. Invalid lists return 400. Shortlists are private and
persist across devices using the same owner token.

Clients read the shortlist and pass its `routeIds` to `POST /recommendations`,
together with the day/window. Recommendations continue to require explicit IDs:
they never silently include the entire library, and a one-off comparison never
changes the saved shortlist. An empty list returns 400 without weather requests;
the client should ask the rider to select at least one route.

The Cycle.travel extension flow is: identify selected saved journeys → upload each
GPX with its stable source ID → save the chosen API IDs → request a recommendation
for those IDs → map scores back to source IDs for the saved-rides page. Import one
file per request and handle its result independently; one invalid file need not
discard successful imports. No extension UI is implemented yet.

### Adapter boundary and account connections

`RouteSourceProvider` in `worker/src/routes/sources.ts` owns source identifiers,
capability metadata and normalization into the shared `Route` contract. The
application accepts a replaceable provider registry; persistence, shortlists,
weather sampling and ranking do not switch on website names. A contract test uses
a fourth source with nonnumeric IDs. Future account connectors can add discovery,
OAuth credentials and download transport at this boundary; those flows and input
modes still need implementation and must be advertised truthfully.

Verified provider interfaces (10 October 2026):

- [Cycle.travel saved journeys](https://cycle.travel/advice/map/organising) expose
  GPX downloads; [its GPS help](https://cycle.travel/help/route_planning/gps)
  documents track exports. No public account API was verified for this implementation.
- [Strava's Routes API](https://developers.strava.com/docs/reference/#api-Routes)
  exposes routes and GPX exports through athlete authorization. A future connector
  needs its OAuth flow, consent and token lifecycle; GPX upload requires none of those.
- [Garmin's Courses API](https://developer.garmin.com/gc-developer-program/courses-api/)
  documents publishing courses **to** Garmin Connect. It does not establish a general
  API for reading a person's existing saved courses; exported GPX is the supported
  import path here. Account discovery remains separate work.

## Recommend a route and departure

`POST /recommendations` takes JSON. This minimal request uses 20 km/h and daylight:

```json
{
  "routeIds": ["replace-with-an-uploaded-UUID"],
  "date": "2026-10-10"
}
```

Defaults and optional settings are shown below. These comfort values are
**provisional tuning settings, not Dan's confirmed personal limits**:

```json
{
  "routeIds": ["replace-with-an-uploaded-UUID"],
  "date": "2026-10-10",
  "timeZone": "Europe/London",
  "riding": {
    "averageSpeedKph": 20,
    "departureStepMinutes": 30,
    "window": "daylight"
  },
  "preferences": {
    "temperature": { "comfortMinC": 16, "comfortMaxC": 24 },
    "wind": {
      "preferTailwind": false,
      "prioritiseTailwindOpportunities": false,
      "comfortableHeadwindKph": 15,
      "comfortableCrosswindKph": 20,
      "comfortableGustKph": 35,
      "crosswindSensitivity": 1
    },
    "weights": { "temperature": 0.3, "wind": 0.2, "dryness": 0.5, "clearSkies": 0, "sunshine": 0 },
    "minimumStandards": {}
  },
  "weather": { "mode": "strict", "providerId": "met-office" }
}
```

Nested settings can be supplied partially. Unknown settings are rejected, so a
typo cannot silently disable a personal restriction. Up to 12 distinct owned route
IDs and 256 weather locations are supported per comparison. Speed is 5–50 km/h;
departure increments are integer minutes from 15–120. Time zone accepts IANA zones
or UTC, not numeric offsets. Responses carry UTC timestamps plus the display time
zone. Dates before today naturally have no feasible future departures.

The whole ride must fit between the latest sunrise and earliest sunset across
its sampled locations. This is a conservative common daylight window, using the
requested date/time zone and an astronomical horizon. Terrain shading and stops
are not modelled. Today's elapsed departure slots are excluded. The API chooses
among discrete departure slots, not every possible start minute.

### Ride time windows

For a ride entirely between 09:00 and 13:00 on the selected date:

```json
{
  "routeIds": ["replace-with-an-uploaded-UUID"],
  "date": "2026-10-11",
  "riding": { "window": { "start": "09:00", "end": "13:00" } }
}
```

Clock times use the effective `timeZone` (request override, saved user setting,
then Europe/London). A window is a **whole-ride constraint**, not just a range of
start times. The ride must start at or after its start and finish at or before its
end; finishing exactly at the end is allowed. Estimated duration still uses moving
speed, excluding breaks. Daylight remains required. Each route's `effectiveWindow`
shows the intersection of the requested window, route daylight and the current
time; `daylight` remains the separate astronomical interval.

Departures use the configured step anchored at the supplied start: a 09:10 start
with a 30-minute step tests 09:10, 09:40, etc. Elapsed slots and slots outside the
common daylight interval are excluded. With `"window": "daylight"` or no window,
the existing grid anchored at local midnight is unchanged. A request never reuses
a previous request's window. The engine compares only feasible complete rides;
routes that cannot fit appear in `unranked` with `no_feasible_departure` and an
explanation. If none fits, `recommendedRouteId` is null and no forecast calls are
made. Minimum-standard failure remains distinct from insufficient riding time.

Use zero-padded 24-hour `HH:mm`, 00:00–23:59. Start must precede end on the same
calendar day. Overnight, empty and malformed windows return 400. A boundary in a
missing or repeated hour during a clock change also returns 400 rather than
silently shifting it; choose an unambiguous time or another explicit time zone.
The response timestamps remain UTC for reliable client display.

### Cloud-aware ensemble assessment

Use this request fragment for BPF v2 UK forecasts:

```json
{
  "weather": { "mode": "strict", "providerId": "met-office-bpf" },
  "forecast": { "representation": "ensemble-summary", "freshnessBasis": "retrieval-time" },
  "preferences": { "weights": { "temperature": 0.15, "wind": 0.2, "dryness": 0.2, "clearSkies": 0.45 } }
}
```

The four weights above are a **provisional personal calibration**, not defaults.
The original cloud-only experiment is in `evaluation/comfort-profile-v2.json`;
Dan’s clarified sunshine profile is described below. Global
clear-sky weight defaults to zero. A positive weight requires numeric total cloud
coverage; a provider without it cannot silently assume sunshine. Zero leaves the
sky factor and cloud summary null when no cloud evidence was requested.

`forecast` defaults to `{ "representation": "deterministic", "freshnessBasis":
"retrieval-time" }` for new profiles and requests without a saved profile, alongside
strict Apple Weather. The ensemble summary explicitly selects marginal p50 temperature,
wind speed, gust, precipitation rate and cloud, ensemble-mean wind direction, and
hourly probability of precipitation > 0 mm. It is not a joint forecast scenario.
`weather.descriptors` returns these meanings. The selection is provider independent;
an adapter must supply the exact requested statistics to be used.

BPF and Apple do not expose a verified model-run time. Use their retrieval-time
presets; `unknown-model-run` remains visible and `forecastRunAt`
is absent. Existing model-run policies are preserved. Retrieval age never establishes model age. Unsupported combinations
return unassessable weather without spending forecast quota.

### Visible sunshine versus clear skies

Dan's follow-up clarifies that **visible sunshine matters most**, even through
thin high cloud. The current personal profile is
`evaluation/sunshine-profile-v4.json`: weights 0.15 temperature / 0.40 wind /
0.20 dryness / 0.25 sunshine / 0 clear skies. The older cloud-only profile is
retained as an experiment, not Dan's active profile. Other riders can choose either
or both sky preferences; the default weights for both remain zero.

Both adapters now map hourly weather symbols into the provider-neutral
`sky-condition-v1` vocabulary: sunny (1), sunny intervals (2), cloudy (3), overcast
(4), obscured (5), precipitation (6), clear night (7), partly cloudy night (8).
These numeric codes are category identifiers, not quantities. Unknown symbols
remain missing. BPF preserves its hourly categorical interval; Global Spot uses
nominal validity time. Neither is a sunshine duration or probability forecast.

`preferences.sunshine.sunnyIntervalsComfort` defaults to 0.7. Sunny comfort is 1,
sunny intervals use that setting, and other symbols score 0. These are provisional
preference scores, **not an assertion that sunny intervals mean 70% sunshine**.
`best.conditions.skyConditionDistanceFractions` and each ride hour show how much
sampled route distance received each category. The fractions may sum to 0.99 or
1.01 after rounding. The separate `sunshine` factor is a comfort score.

This makes a route with visible sunshine through substantial cloud eligible for
a high sunshine score, while another profile can explicitly prefer lower cloud.
A missing weather symbol never becomes sunny, even if temperature and wind look
comfortable. No cloud percentage is inferred from a weather symbol.

In `comfort-v0.10`, unknown sunshine contributes neutral comfort (0.5) to the
combined score for the affected route sections, without blocking an otherwise
assessable departure or removing hours from day coverage. It remains missing in
the reported sunshine factor and category shares. Each departure includes
`sunshineAssessment: {status, unknownDistanceFraction}`, where status is
`complete`, `partial` or `unavailable`; the assessment is null when sunshine
has zero weight. The response assumptions and departure drawbacks disclose the
neutral scoring rule. Essential weather and minimum-condition checks are unchanged.

### Personal crosswind sensitivity

`preferences.wind.crosswindSensitivity` scales the crosswind discomfort term
above `comfortableCrosswindKph`. It is a number from 0 to 10, default 1; 0 ignores
crosswind discomfort. In v0.11, values up to 1 also scale the gentle penalty below
the comfort setting; higher values strengthen the above-setting penalty. Headwind,
gust and useful-assistance calculations remain separate. The combined wind
discomfort is clamped to 0–1, so scores remain bounded. This is a comfort setting,
not a safety limit or an automatically inferred minimum standard.

The v4 profile uses sensitivity 5 and a comfortable crosswind of
5 km/h (about 3.1 mph), with the weights above. Light winds below this threshold
remain comfortable whatever the route direction. Sustained crosswinds beyond it
carry more weight relative to sunshine. Other riders retain their own settings;
route names, locations and ranks never enter the scoring formula.

This calibration replays the same forecasts as v3. Braintree stays first and East
Anglia moves from second to sixth after all 86 departures are re-evaluated. These
are fitted results on one reviewed day, not validation on unseen weather. The
reviewed ranking was approved by Dan on 10 October 2026. Exact settings on other
days still need calibration. Earlier profiles remain available for comparison; no seasonal minimum temperatures were invented.

### Climbing preference

Use `preferences.climbing.preference` with `flatter`, `neutral` or `hillier`.
The default is `neutral`, including for older stored profiles that have no climbing
field. Reading an older profile supplies the default without rewriting its storage
or changing its version. Neutral adds no climbing influence; with no distance
preference, it preserves the existing weather scores and ranking.

Save a preference through `POST /users` or `PATCH /users/me`, or override it for
one recommendation without changing the saved profile:

```json
{
  "routeIds": ["<uploaded-route-id>"],
  "date": "2026-10-11",
  "preferences": { "climbing": { "preference": "flatter" } }
}
```

```json
{
  "expectedVersion": 1,
  "settings": {
    "preferences": { "climbing": { "preference": "hillier" } }
  }
}
```

Omitting the preference or supplying an empty climbing patch preserves the saved
value. Explicit `neutral` disables its scoring effect. `null`, unknown modes,
custom strengths and ascent limits are not accepted in this version.

Climbing means **estimated ascent per kilometre**, not total ascent, maximum slope
or effort. With equal weather, `flatter` prefers 60 km with 600 m ascent (10 m/km)
over 30 km with 450 m ascent (15 m/km); `hillier` reverses that preference.

With climbing active and no distance preference, the final score is **90% weather
comfort + 10% climbing comfort**. With distance also active it is **80% weather +
10% climbing + 10% distance**. The climbing factor rises linearly from 0 to 100 between 0 and 20 m/km
for `hillier`, and falls from 100 to 0 for `flatter`. It stays at its endpoint
beyond 20 m/km. These are provisional, versioned calibration choices, not
physiological thresholds. Scores do not depend on which other routes are selected.
Configured minimum conditions always take priority over the combined score.

Each result exposes `distanceM`, `ascentM` and `ascentMPerKm`. Candidates expose
`weatherScore` alongside the combined `score`, and `factors.climbing` on a 0–100
scale. The factor is `null` when the preference is neutral. Calculations use
unrounded values; reported scores and ascent per kilometre are rounded.

When climbing is active, a route without complete elevation remains visible in
`unranked` with status `unassessable` and issue `missing-elevation`. It receives no
combined score. From v0.10.0, an optional `partialAssessment` exposes weather-only evidence with
`score: null`; the route remains outside the combined ranking. Use its elevation-specific
verdict instead of labelling the forecast incomplete.
Weather is fetched for that diagnostic when a departure is feasible. Known zero
ascent is valid flat terrain. An impossible time window still returns `no_feasible_departure` first.
Neutral can assess routes without elevation using weather and any distance preference.

Available ascent remains an **unsmoothed GPX estimate**, with the existing
`ASCENT_IS_UNSMOOTHED_ESTIMATE` warning. GPS noise, elevation source and point
density can affect it. This release does not claim reliable steepness, adjust
ride duration for climbing, or add maximum-ascent restrictions. Climbing-only
changes need no new weather variables and reuse compatible cached forecasts.

### Preferred distance

Set `preferences.distance` to `{ "minKm": 30, "maxKm": 60 }` for an inclusive
preferred band in kilometres. The default is `null` (**No preference**), including
older profiles; reading them supplies `null` without rewriting storage or changing
their version. All distances inside the range fit equally. Routes outside it stay
available with a gradually reduced distance factor and an explicit drawback.
This is a scoring preference, not a hard distance limit or a minimum condition.

Both bounds are required whenever a range is supplied: `0 <= minKm <= maxKm <= 400`
and `maxKm > 0`. Decimal values and equal bounds are allowed. These bounds match
the current 400 km route-import limit. A range replaces both saved bounds together;
partial objects, empty objects, unknown fields and custom strengths are rejected.
Omission inherits the saved preference, while explicit `null` disables it.

For a short, flatter ride, send this to `POST /recommendations`:

```json
{
  "routeIds": ["<uploaded-route-id>"],
  "date": "2026-10-11",
  "preferences": {
    "distance": { "minKm": 15, "maxKm": 40 },
    "climbing": { "preference": "flatter" }
  }
}
```

Request overrides never save settings. Use `POST /users` or `PATCH /users/me`
to save a usual range; updates require the last-read profile version:

```json
{
  "expectedVersion": 1,
  "settings": {
    "preferences": { "distance": { "minKm": 30, "maxKm": 60 } }
  }
}
```

Send `"distance": null` at the same location to remove a saved range, or inside
a recommendation's `preferences` to disable it for that search only. Unrelated
profile updates preserve the range. Clients may display other units but must
convert to kilometres at this boundary.

Distance contributes **10%** of the combined score whenever configured. Weather
retains **90%**, or **80%** with an active climbing preference. No range and neutral
climbing use weather alone. The range does not change weather weights, weather
minimums, ride duration or the requirement for the whole ride to fit its window.
A route meeting configured weather minimums still outranks one that fails them.
Active climbing still requires complete elevation even when distance is configured.

For route length `d` in kilometres, the 0–1 distance comfort is `d / minKm` below
the range, `1` inside it, and `max(0, 1 - (d - maxKm) / maxKm)` above it. For a
30–60 km range, 15 km and 90 km each receive a distance factor of 50; 30, 45 and
60 km all receive 100; 120 km and longer receive 0. The factor varies continuously
at the boundaries and does not depend on other selected routes. This relative
taper is a provisional, versioned calibration choice, not a physiological recovery
model. Together with `flatter`, it expresses a short-distance, gentler-terrain
preference without estimating total exertion.

Each ranked or unranked route exposes `distanceFit`: `null` when disabled, otherwise
`{ "status": "within_range" | "below_range" | "above_range", "deviationKm": number }`.
Deviation is zero inside the band and the positive distance to the nearest boundary
outside it. Candidate `factors.distance` is 0–100, or `null` when disabled;
`weatherScore` remains the original weather-only score. Comparison and deviation
use unrounded route distance; clients can round display values without reclassifying
the fit. Distance-only changes reuse compatible cached forecasts.

### Personal minimum standards

No minimum standards are invented by default. Set any combination of:

- `minimumTemperature: { "kind": "fixed", "valueC": 12 }`
- `minimumTemperature: { "kind": "monthly", "valuesC": { "1": 0, "6": 16 }, "fallbackC": null }`
- `maximumTemperatureC: 28`
- `maximumGustKph: 40`
- `maximumPrecipitationProbability: 0.2` (fraction, not percent)
- `maximumPrecipitationRateMmH: 0.5`

These are syntax examples, not adopted settings. A missing month uses the explicit
fallback or remains unknown. Equality meets a threshold; any sampled breach fails
it. Failure evidence includes the limit, worst actual value, affected distance,
route sections and their modelled observation times. A zero scoring weight does
not switch off a configured minimum standard. [Seasonal comfort tolerance](seasonal-temperature.md)
never changes these limits; unsupported configuration is rejected rather than guessed.

### Result contract

The response includes:

| Field | Meaning |
|---|---|
| `recommendedRouteId` | Best assessable route, or `null` if none can be recommended. |
| `rankings` | Ordered routes; each has `best`, up to three tested alternative departures, duration, daylight, effective window, warnings and coverage counts. |
| `unranked` | Routes with `unassessable` evidence (weather, or elevation when climbing matters) or `no_feasible_departure`. |
| `outline` | Version-one display sketch with at most 64 `[latitude, longitude, distanceM]` points, or null when insufficient route points/endpoints are available. Included on ranked and unranked routes. |
| `distanceM`, `ascentM`, `ascentMPerKm` | Route distance and estimated total/ascent-per-kilometre facts; ascent fields are `null` when elevation is incomplete. |
| `distanceFit` | `null` with no distance preference; otherwise `status` (`within_range`, `below_range`, `above_range`) and nonnegative `deviationKm`. Outside-range routes stay eligible. |
| `best.departureAt`, `best.finishAt` | Suggested start and estimated finish. |
| `best.score`, `best.weatherScore`, `best.factors` | Combined ride score, original weather-only score and temperature/wind/dryness/clear-sky/sunshine/climbing/distance factors. These are not probabilities. |
| `best.recommendationPriority`, `best.tailwindOpportunity` | v0.27 ordering value (0–105) and separate opportunity explanation/points. Keep showing `score` for Conditions; see [contract](tailwind-opportunity.md). |
| `best.windStretches` | Contiguous wind sections with route bounds, ride times, wind effect/direction/speed and estimated maximum adverse gust. Also on alternatives, partial assessments, day winners and next-window winners. See below. |
| `best.temperatureAlongRide` | Ten-minute air/feels-like/usual temperature tuples, provenance and nullable monthly climate comparison. Also on alternatives, partial assessments, day winners and next-window winners. |
| `best.conditions`, `best.rideHours` | Derived overall/per-ride-hour temperature range, average sustained wind and components, maximum headwind/crosswind/gust, total cloud mean/maximum fractions (or null), precipitation risk/rate and maximum hourly amount/basis, categorical sky-condition distance fractions, assisted-distance fraction and the v0.15 wind/precipitation summaries below. |
| `best.standards` | `meets`, `below`, `unknown`, or `not_configured`, with structured failures. |
| `minimumStandardsStatus` | Collection-level `match_found`, `none_meet`, `unknown`, `not_configured`, or `no_feasible_departure`. |
| `message`, `best.drawbacks` | Readable conclusion and trade-offs. |
| `savedUser`, `resolvedPreferences`, `resolvedMinimumTemperature`, `riding` | Saved profile identity/version, exact effective settings and seasonal limit origin. |
| `algorithmVersion`, `generatedAt`, `assumptions` | How and when the assessment was made. |
| `weather` | Requested/selected provider, attempts, per-location provenance/issues, range, quality limits, cache hits/misses and `refreshAt`: the earliest retrieval-TTL, provider-expiry or model-age limit among the forecasts used, or `null` when any location was unavailable (ask again). The same request returns the same ranking until then, barring profile, route or ride-history changes. |

A route known to meet every configured standard takes priority over a higher
scoring route that does not. Otherwise the highest recommendation priority is
returned as the best available. Priority equals Conditions unless the explicit
[tailwind opportunity preference](tailwind-opportunity.md) contributes up to five
extra ordering points. Each route is represented by its best departure under that
same rule. A high score never erases a failed standard.

`none_meet` means every assessable choice fails and no unresolved choice could
change that conclusion. If another route/departure lacks evidence, or a month
rule is unresolved, return `unknown` instead. No feasible departure is distinct
from bad weather. Missing data never becomes zero rain or zero wind.

### Temperature timing and forecast details (v0.23.0)

`comfort-v0.12` linearly interpolates instantaneous air temperature between adjacent
hourly readings at each route-section arrival time. Overall ranges and temperature
standards also include each section's entry, exit and any hourly extrema inside it,
so departure and finish temperatures are included. Distance-weighted comfort still
uses section midpoints. Missing brackets, gaps greater than one hour and period
means remain unknown; the engine never extrapolates. Gust maxima, wind, precipitation
and categorical symbols retain their existing sampling and native periods.

Best and retained alternative departures include `forecastDetails`, an explanation
scoped to the locations and times used for that ride. Each location supplies source
identity, actual forecast coordinates/site ID, `retrievedAt`, nullable
`forecastRunAt`, selected temperature/gust statistics, `routePeriods`, hourly
`temperatures` (`at`, nullable `celsius`) bracketing those periods and overlapping
`gusts` (`start`, `end`, nullable `maximumKph`). Repeated uses of the same snapshot
and site are grouped. Gust period bounds remain complete even at a partial-hour
start or finish. The details reuse the selected cached evidence without provider
calls; they do not expose whole-horizon or arbitrary-location forecasts.

The extension no longer shows these details; its Forecast details disclosure
was removed from the popup and Journeys cards.
Older responses without details remain readable; persisted ranking keys are bumped
to discard recommendations computed before this algorithm change. Saved ride plans
remain historical snapshots.

### Condition chip summaries

Every newly computed conditions object includes the following two fields. They
appear on best and alternative departures, ride-hour conditions, planning results
and partial assessments wherever conditions can be computed. An hour with no
observations still has `conditions: null`. Persisted ride-plan conditions accept
these fields optionally: old snapshots stay readable and writable, and new
snapshots round-trip without dropping them or recalculating their descriptions.

`windDistanceFractions` contains `headwind`, `tailwind` and `crosswind` shares
weighted by the distance of each observed route section. If the absolute along-route
component is at least the crosswind component, positive along-route wind counts
as headwind and nonpositive as tailwind; otherwise it counts as crosswind. Each
share is rounded to two decimal places and their sum is within 0.01 of 1.
This includes calm sections and is separate from `assistedDistanceFraction`,
which requires a tailwind of at least 3 km/h that beats the crosswind. The client
names a direction only when average sustained wind is at least 10 km/h and one
share is greater than 0.5. Compare in km/h before display conversion.

`precipitationSummary` is one of:

```text
dry, possible, drizzle, light_showers, showers, heavy_showers,
light_rain, rain, heavy_rain, sleet, hail, snow, thunder
```

Provider weather types take precedence. The most severe wet type encountered
along the ride wins, in this presentation order:

```text
drizzle < light_showers < light_rain < showers < rain < heavy_showers
< heavy_rain < sleet < snow < hail < thunder
```

Without a recognised wet type, use the maximum observed precipitation rate:
at least 4 mm/h is `heavy_rain`, at least 0.5 is `rain`, and at least 0.1 is
`light_rain`. Below 0.1 mm/h, maximum probability of at least 0.3 gives `possible`;
otherwise `dry`. These bands and the severity order are Ride On's display policy,
not common official provider intensity bands or a change to dryness scoring.
Provider rate periods still differ (Apple's is an hourly mean). `dry` means no
wet description meets this policy, not a promise of zero precipitation risk.
For `possible`, display the separately reported maximum probability. That
probability includes frozen precipitation and is not a whole-ride probability.

Both Met Office products use the [published weather symbols](https://datahub.metoffice.gov.uk/definition-of-codes):
9–10 light showers, 11 drizzle, 12 light rain, 13–14 heavy showers, 15 heavy rain,
16–18 sleet, 19–21 hail, 22–27 snow, 28–30 thunder; -1 (trace rain) maps to light rain.
Apple's [condition codes](https://developer.apple.com/documentation/weatherkit/weathercondition)
map drizzle/rain/heavy rain directly, sun showers to showers, sleet/wintry mix to
sleet, snow/flurries/blizzard to snow, hail to hail and thunderstorm variants to
thunder. Freezing drizzle/rain retain the broad drizzle/rain labels; tropical
storm/hurricane map to rain. The small vocabulary does not preserve every hazard
qualifier and is not a weather-alert assessment. Blowing snow, wind-only codes
and unknown codes supply no wet type and use the numeric fallback.

Weather types are optional display evidence, available even when sunshine has
zero weight. Apple and Global Spot already return them; BPF adds the weather-code
parameter to its existing percentile request. This adds no provider HTTP calls.
Missing/invalid type data cannot block otherwise usable rides, trigger fallback
or prevent caching. Existing cached snapshots stay valid and use the numeric
fallback until their normal refresh; this release does not flush forecasts.
Sky-condition distance shares and all scores remain unchanged (`comfort-v0.10`).

Chip colours are a client presentation rule. They do not establish whether or
how much a condition lowered the score: rider weights, gusts, thresholds and
rounded display values can differ from a chip's rule. Use the returned factor
breakdown and standards failures for an accurate scoring explanation.

### Temperature and rain along the ride (v0.35.0)

Every returned departure carrying `rideHours` also includes `temperatureAlongRide`,
including alternatives, partial assessments, day winners and next-window winners:

```json
{
  "temperatureAlongRide": {
    "points": [[0, 7.4, 5.1, 10.1], [10, 7.8, 5.6, 10.4], [20.5, 8.2, 6, 10.6]],
    "feelsLikeBasis": "provider",
    "usual": {
      "month": 10,
      "averageHighC": 15.1,
      "averageLowC": 8.2,
      "bandHalfWidthC": 2.5,
      "differenceC": -2.6,
      "method": "monthly-diurnal-estimate",
      "coveredDistanceFraction": 1,
      "source": {
        "version": "haduk-grid-1.1.0.0-1991-2020-12km-tmax-tmin",
        "referencePeriod": "1991–2020",
        "statistics": ["maximum", "minimum"],
        "attribution": "Contains Met Office data licensed under the Open Government Licence v3.0.",
        "source": "https://catalogue.ceda.ac.uk/uuid/652cea3b8b4446f7bff73be0ce99ba0f",
        "licence": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
      }
    }
  }
}
```

Each point is `[minutesFromDeparture, airC, feelsLikeC, usualC]`. Points are strictly
increasing, with no duplicate offsets: zero, each ten minutes, the finish, and
any additional air/feels-like extrema or missing-data breaks. **Offsets may be
fractional**, as agreed for this implementation; clients must not round or index
them as whole minutes. At a section boundary the entering section supplies the
value; an outgoing extreme at that same boundary is represented immediately
before it (at most 1 ms earlier) to preserve both sides of the discontinuity.
The final point uses the last section's exit.

Temperatures are rounded to 0.1°C. The trace's air extrema match
`conditions.temperatureC`, which now also uses 0.1°C display precision. Scoring
and hard-standard checks continue using unrounded evidence. Air and feels-like
values interpolate between adjacent instantaneous hourly readings, using the
same route timing as v0.23. Missing brackets or gaps over an hour stay `null`;
clients break that line. A completely unassessable ride still has no departure
or trace; display enrichment does not change eligibility.

Apple `temperatureApparent` and Global Spot `feelsLikeTemperature` are retained
as optional evidence. A missing provider value stays `null`. For Met Office BPF,
we derive hourly feels-like values from air temperature and 10 m mean wind speed
using JAG/TI wind chill at air ≤10°C and wind >4.8 km/h, otherwise air temperature,
then interpolate those values. There is no humidity correction or rider-speed
adjustment. `feelsLikeBasis` is `provider`, `derived`, `mixed`, or `null` when none
is available. These values never enter scoring.

`usual` uses distance-weighted **raw calendar-month** high and low values for the
departure's local date, even when seasonal tolerance is off. The API computes the
[monthly daily curve](seasonal-temperature.md#display-only-monthly-comparison-v0350)
in the resolved time zone. `differenceC` is the duration-weighted mean air
minus mean usual temperature, rounded to 0.1°C. Air is integrated over each
section's hourly linear segments; usual uses time-weighted ten-minute trapezoids
before display rounding. An incomplete air trace has `differenceC: null`.
`coveredDistanceFraction` describes the route share within the UK grid. No covered
section means `usual: null` and all `usualC: null`; no nearest-cell extrapolation.
Clients must display the source attribution whenever they display the comparison.

All newly computed conditions objects also include:

```json
{
  "maximumPrecipitationAmountMm": 2.4,
  "precipitationAmountBasis": "hourly-accumulation"
}
```

This is the maximum hourly amount at the same observed section midpoints used
for rate and probability. Native hourly accumulation periods are respected:
Apple labels their start; Global Spot labels their end. Where an hourly amount
is unavailable, use rate × 1 hour. Basis is `hourly-accumulation`, `rate-estimate`
(BPF, or missing optional accumulation), or `mixed`. Amount is rounded to 0.1 mm.
Overall conditions describe the heaviest observed hour anywhere along the ride;
ride-hour conditions describe their own observations. This is not total rainfall
experienced by the rider. Probability remains separate. A ride hour without
observations still has `conditions: null`.

Both amount fields are optional in saved-plan validation: old plans remain
readable and new fields round-trip. Old responses can omit the entire trace and
new conditions fields. Forecast snapshots use a new cache namespace and the
extension's persisted ranking key is bumped, so refreshed rankings include the
new evidence. No extra provider calls are made beyond ordinary cache refreshes;
missing optional series do not trigger fallback or prevent caching.

### Route outline and wind sections (v0.29.0)

`rankings[].outline` and `unranked[].outline` contain
`{version: 1, points: [[latitude, longitude, distanceM], ...]}`. Coordinates are
rounded to five decimal places and distances to whole metres. Points run from
zero to `Math.round(route.distanceM)` in travel order with non-decreasing distance.
The first and last points survive a Douglas–Peucker simplification limited to
64 points, using earth-centred metres to handle date-line crossings. Stored
polyline geometry is decoded, cumulative distances are scaled to the authoritative
route length, and those distances survive sketch simplification. This is approximate
chainage because the stored path was already simplified at import. If geometry
is absent or invalid, actual start/end weather-location coordinates and leg
midpoints form the fallback; missing usable endpoints/points produce null.
Outlines are computed once per route for a comparison's dates and windows.
There is no elevation or basemap data, and this is not navigation geometry.

Every newly assessed departure carrying `rideHours` also carries `windStretches`:

```json
{"fromM":0,"toM":21500,"startAt":"2026-10-18T09:30:00.000Z","endAt":"2026-10-18T10:34:30.000Z","effect":"tailwind","windFromDegrees":228,"averageWindSpeedKph":17.4,"maximumAdverseGustKph":8.1}
```

The array uses the same observations as `conditions`. Sustained wind below
10 km/h is `light`; otherwise the dominant component determines `headwind`,
`tailwind` or `crosswind`, using the `windDistanceFractions` rule above. Adjacent
observations merge only with the same effect and eight-point compass sector
(45° sectors centred on N, NE, E, SE, S, SW, W and NW). Light observations merge
regardless of direction. **There is no 2% absorption rule:** even a brief adverse
section retains its own effect. Clients may omit small labels, but must not
recolour or discard those sections. The maximum is 1,000 entries, bounded by
route legs. Effects describe the sampled sustained wind; they are not detailed
wind measurements at every metre of the sketch.

Bounds cover exactly `[0, route.distanceM]` without gaps or overlaps and retain
unrounded distances. Times use the existing constant-speed model:
`departure + duration × distance / route.distanceM`. Direction is the same
rounded circular, distance-weighted mean as `conditions.windFromDegrees`, or null
for calm/variable direction. Speed is distance weighted and rounded to two decimal
places. Each adverse-gust maximum uses the existing prevailing-wind estimate;
the maximum across all stretches equals `conditions.gustExposure.maximumAdverseKph`.
It does not establish a separate gust direction or an exact time for the peak
within that section. No observations (or incomplete coverage) produce `[]`, never
a partial coloured route. A wholly unassessable departure remains `best: null`;
there is no fabricated departure object. Zero wind scoring weight still samples
wind and returns sections.

Logged ride plans accept optional `windStretches`, validate continuity, timing,
distance and the adverse-gust maximum, and preserve them on reads. Omitting the
field in old plans remains valid; no historical snapshot is back-filled. The
`POST /rides` body limit is now 400,000 bytes for complete section arrays. Tracked
recommendations retain their original sections in the immutable baseline, with
new assessments stored separately. See [tracking storage bounds](ride-tracking-api.md).

Only normalized weather is cached server-side; recommendation response bodies
are freshly assembled. Existing forecast caches can supply both fields immediately
on the next recommendation request. Clients holding an older response must request
recommendations again, or continue their normal refresh schedule. No cache-key or
algorithm-version bump and no weather refetch is needed for this addition.

## Algorithm

### Temperature and sunshine preference intent

`preferences.temperature.comfortMinC` and `comfortMaxC` define an equally
comfortable band, including both endpoints. All temperatures inside the saved
band receive full temperature comfort; there is no extra reward for moving
towards its middle or warmer end. Outside it, the existing comfort curve falls
with distance from the nearest boundary. Minimum standards remain separate.

From v0.26.0, explicit `coldSensitivity: "high"` and/or
`seasonalTolerance: "cooler-winters"` select the [seasonal temperature model](seasonal-temperature.md).
The description of the original linear curve below applies to the default
`standard` / `none` choices. New profiles and old saved profiles keep those defaults.

The engine combines that comfort with the saved `weights.temperature`,
`weights.sunshine` and `sunshine.sunnyIntervalsComfort`. A positive sunshine
weight expresses a preference for sunshine; zero removes that preference from
scoring. These inputs determine the warmth/sunshine trade-off for each rider.
There is no special rule tied to Dan, a named route, a departure time or fixed
temperatures from the interview.

The 14 October follow-up confirms that Dan's existing 16–32°C band means equal
temperature preference throughout. With his saved weights, the current algorithm
already prefers 8°C sunny over 12°C with sunny intervals, 14°C with intervals over
8°C sunny, and 16°C sunny over 20°C with intervals (likewise 22°C over 26°C).
`worker/test/temperature-sunshine-calibration.test.ts` preserves these comparisons
and verifies that another ideal band, zero sunshine importance or zero temperature
importance changes the outcome. No scoring change or algorithm-version bump is
needed for this calibration.

Calibration answers describe personal intent and must be represented in saved
preferences before they affect that rider's recommendations. They do not change
global defaults. Profiles currently contain resolved settings, without per-field
confirmation metadata: a default value alone is not evidence that a user actively
chose it. Any future adaptation requiring affirmative intent must capture that
choice explicitly rather than infer it from a default or another rider's answers.

### Wind exposure and assistance v0.14

From v0.15, the assistance benefit and tie-break described below require
`wind.preferTailwind: true`; the underlying wind discomfort model is unchanged.

Wind discomfort now uses the distance-weighted mean of section comfort. At the
constant modelled moving speed this is also time-weighted. The single worst wind
section no longer supplies a quarter of the weather score. Temperature, dryness,
sunshine and clear-sky curves keep their existing 75% mean / 25% worst-section
blend, calculated together without wind. Explicit minimum standards still inspect
every section and native gust maximum, regardless of a short exposure's score.

The v0.11 headwind and crosswind loss curves below are retained. Gust discomfort
uses an **estimated adverse gust component**: multiply the raw gust magnitude by
`hypot(max(0, headwind), crosswind) / hypot(headwind, crosswind)`. This uses the
prevailing wind direction; it is not a measured gust direction or a joint ensemble
scenario. When sustained wind is zero, use the full gust magnitude because no
directional signal is available. Aligned tailwind therefore has no gust comfort
loss; oblique tailwind retains its lateral gust exposure. Raw gust maxima remain
unchanged for display and `maximumGustKph` minimum standards.

Sustained assistance has a bounded positive benefit. For each section, assistance
strength is `clamp((tailwind − 5) / 8)`, using the sustained forward component in
km/h and clamping to 0–1. The benefit plateaus at 13 km/h (about 8 mph) of forward
assistance; gust peaks never earn a bonus. Let `A` be distance-weighted mean
assistance strength. Add `100 × normalizedWindWeight × 0.10 × A` to the weather
score, capped at 100. Assistance is proportional to strength and distance, without
a separate majority gate. Crosswind, headwind and gust discomfort are deducted
independently: useful diagonal wind can both assist and cause discomfort. The
interview's 60% tailwind / 40% headwind example still loses to calm conditions.
Strength-weighted coverage avoids a sudden bonus when weak sections cross a
binary direction or speed threshold. These constants remain provisional
calibration choices, not physical performance or speed estimates.

v0.13 subtracted crosswind from the forward component and multiplied the route
benefit by `clamp(2 × A − 1)`. The saved live-route replay revealed that together
these restrictions removed all assistance from Horsham's diagonal tailwinds.
v0.14 removes those two restrictions; it does not alter discomfort curves,
temperature/sunshine weights, forecast data or rider preferences.

Calm ideal rides can still score 100. Equal final scores favour the higher
potential assistance benefit before the existing departure-time tie-break;
minimum standards and final scores retain priority. Zero wind weight disables
both the benefit and its tie-break. Distance/climbing shares scale the assistance
contribution along with the rest of the weather score; history deductions remain
separate. The riding speed and duration model are unchanged.

New assessments expose `windAssistance` with `usefulDistanceFraction`,
`potentialPoints` and `appliedPoints`. Points are in the final score's scale;
`appliedPoints` accounts for the weather-score ceiling and the final score floor
after history deductions, and can be zero on an ideal assisted ride.
`factors.wind` remains discomfort-only (0–100), so clients
must not silently interpret it as including the benefit. Conditions additionally
include `gustExposure: {directionBasis: "prevailing-wind-estimate",
maximumAdverseKph: number}`. This field is optional on historical plans, which
are never retrospectively rescored. The extension retains the raw gust chip but
uses estimated adverse gust exposure for comfort colouring; a breached explicit
raw-gust limit still colours it amber. Persisted recommendations use a new cache key.

Synthetic checks in `worker/test/wind-exposure.test.ts` cover all six interview
answers, ceiling ties, sustained opposing winds, tiny exposures, segmentation
invariance, gust limits, missing data, zero wind weight and saved-plan compatibility.
The town-forecast examples use synthetic headings and one location: they support
the Horsham 10am versus 8am/noon and Richmond 8:30am versus 10am comparisons, but
are not replays of the real routes or proof of an exact best departure. Additional
tests cover diagonal assistance, winding routes below the former eligibility
threshold, and independent lateral discomfort. A separate local replay holds the
saved production routes, preferences and 14 October forecast snapshot fixed:
Horsham gains useful assistance and outranks Richmond, while its best departure
remains 8am. In the follow-up interview, Dan preferred 8am after reviewing those
route-level conditions, confirming that ordering. The synthetic town example does
not establish a live 10am optimum. Private geometry
and forecasts stay outside version control. The prior 80–85 crosswind/gust
reference still passes. No live weather requests are required.

### Previous wind comfort calibration v0.11–v0.12

Scores remain personal comfort values, not probabilities or a ranking percentile. There is no starting bonus tied to the width of a rider’s preferences. Calm, dry rides in the rider’s temperature comfort band can still reach 100. Without explicit seasonal tolerance, the same temperature earns the same comfort score year-round. The wind release preserved other curves; v0.26.0 subsequently adds opt-in seasonal temperature calibration.

Wind now loses comfort gradually before the rider’s preferred speed and more strongly beyond it. All speeds below are km/h. Let `approach(v, ideal, comfort)` be zero at or below `min(ideal, comfort)`, increasing linearly to one at `comfort` (using a minimum 1 km/h transition span when comfort is at/below ideal). Clamp each fraction to 0–1:

- Headwind loss: `0.15 × approach(head, 5, headComfort) + 0.45 × clamp((head − headComfort) / 20)`.
- Crosswind loss: `0.15 × min(1, sensitivity) × approach(cross, 5, crossComfort) + 0.35 × sensitivity × clamp((cross − crossComfort) / 20)^1.5`. Excess discomfort grows progressively: just over comfort has a small effect, while larger exceedances still matter strongly. Sensitivity zero still disables crosswind discomfort.
- Gust loss: `0.08 × approach(gust, 10, gustComfort) + 0.30 × clamp((gust − gustComfort) / 40)`.

Wind comfort is `1 − clamp(head loss + cross loss + gust loss)`. These are versioned calibration choices, not physical safety limits. Gust maxima are taken over native forecast intervals; gusts are not treated as sustained wind or assigned a direction the provider does not supply. Each section contributes its own wind discomfort. The existing 75% distance mean / 25% worst-section blend makes persistent exposure count more than a brief affected section.

The agreed synthetic reference is a two-hour, 20°C, sunny, dry ride with 10–11 mph crosswinds and 30–31 mph gusts. With head/cross comfort 16 km/h, gust comfort 25 km/h, sensitivity 5, and weights temperature/wind/dryness/sunshine 0.15/0.40/0.20/0.25, it scores about **81–84/100**, within the agreed 80–85 band. It remains below a separate 55 km/h maximum-gust limit. This is not a newly measured score for Richmond or Horsham. Other riders’ settings produce different scores.

Suggested reading: 95–100 almost ideal; 85–94 very comfortable; 70–84 good with noticeable compromises; 50–69 rideable with meaningful discomfort; below 50 a poor preference match. These bands are guidance, not guarantees or safety classifications. A best available ride need not score highly.

The extension exposes `comfortableGustKph` separately from `minimumStandards.maximumGustKph`, displays `conditions.maximumGustKph` alongside sustained wind, and invalidates cached rankings from before this change. Historical saved ride plans retain their original assessment.

### Previous weather curves (through v0.10)

The duration model is distance / constant moving speed. Weather is matched to the
estimated arrival at each section midpoint; wind uses that section's heading.
No tailwind-home weighting or automatic route reversal is applied. Wind assistance
requires a tailwind component of at least 3 km/h that exceeds the crosswind
component; its fraction is distance-weighted. A small aiding component in a
predominantly crosswind is no longer counted as assisted distance. Calm loops can
score well with no assistance; this metric does not add a separate score bonus.
Stronger aiding wind avoids a headwind penalty but still incurs crosswind/gust
penalties where relevant.

Each factor is a 0–1 comfort value. Temperature is 1 within the comfort band,
then decreases linearly to 0 at 10°C outside it. Wind discomfort is the sum of
45% headwind excess (over a 20 km/h span), 35% × `crosswindSensitivity` × crosswind excess (20 km/h span),
and 20% gust excess (30 km/h span), with each excess clamped to 0–1. Dryness is
`1 − (0.8 × precipitationProbability + 0.2 × clamp(rateMmH / 2))`.
Clear-sky comfort is `1 − totalCloudCoverFraction`. Per-section comfort is the
normalized preference-weighted factor mean. There is no fixed morning bonus: all
weather factors are evaluated at the expected arrival time, including hourly cloud or weather symbols. Weather
score is 100 × (75% distance-weighted mean comfort + 25% worst section comfort).
It is unchanged from v0.4. Neutral climbing and no distance preference use this
score directly; active climbing and distance preferences each contribute 10% via
their route-level factors as described above. With no distance preference, v0.6
preserves v0.5 scores and ordering, including active climbing.
Ties choose the earlier departure, then route ID. These curves, spans and the
consistency weight are versioned implementation choices for review and calibration.

Temperature uses linear interpolation between adjacent hourly readings, including
departure and finish when reporting its range and checking personal limits. Other
instant forecasts and ten-minute wind means use the nearest hourly validity,
within 30 minutes. These are approximations, not forecasts of every minute.
Full-hour means use their native interval bounds, including Apple's cloud cover
and precipitation rate derived from hourly accumulation. This v0.7 addition leaves
Met Office's short wind means and existing calibration unchanged.
Native intervals are used for hourly gust maxima and precipitation probabilities;
probabilities are neither interpolated nor multiplied across sections. Reported
precipitation risk is the maximum local hourly probability encountered, not a
probability for the whole ride. Hour bins are elapsed ride hours, not clock hours;
the midpoint approximation can leave a tiny final bin with `conditions: null`.

## Providers and performance

A provider implements `ForecastProvider`, returns the generic descriptor/series
contract and preserves units, time periods, missing values and provenance. Register
its factory in the API's provider map; no scoring changes are needed for equivalent
measurements. Different statistics require explicit product decisions rather than
passing a percentile off as a deterministic value. Apple Weather, Met Office Global
Spot hourly and BPF v2 UK are configured with separate secrets. See the
[Apple provider guide](apple-weather.md) for mapping, setup, cost and attribution.

`GET /weather-providers` requires authentication and returns `defaultProviderId`,
`defaultPolicy` and two public `providers`: Apple Weather and Met Office. Entries
include `id`, `name`, `configured`, `forecastHorizonHours`, `recommendedSettings`
and `attribution`. It makes no forecast calls. Read `user.weatherProviderId` from
`GET /users/me` for the current picker value, and send `settings.weatherProviderId`
on a profile patch to save a choice. The same field works at the top level of both
recommendation requests for temporary overrides. The API resolves compatible
forecast settings; do not combine this field with advanced `weather`/`forecast`
fields in the same request. Legacy presets and stored settings remain supported.
See [provider choice contract](weather-provider-choices.md) for exact fields and
legacy-product compatibility. `configured` reflects local configuration, not
upstream health or remaining quota. `weather.selectedProvider` supplies a display
label; exact technical provenance remains in `weather.selectedSource`.

`weather: { "mode": "ordered-fallback", "providerIds": ["met-office", "another-provider"] }`
allows that exact ordered list. The source-selection layer chooses one provider
for the entire comparison, with no field mixing or silent outside fallback.
New profiles and requests without a profile default to strict `apple-weather`.
Existing saved choices remain unchanged, including Dan's strict Met Office policy.

Quality limits: hourly resolution, retrieval refresh after three hours for today,
six hours for tomorrow or twelve hours for dates two or more days away in the
rider's timezone (model-run policies also retain their six-hour model-age limit), resolved
weather location within 10 km of the query and evaluated section. Weather points
are sampled along the route every 10 km. These are engineering starting policies,
not a claim of kilometre-scale forecast accuracy.

KV retains normalized evidence for 12 hours, keyed by provider/product/adapter,
coordinates, required descriptors, provider-horizon length, freshness basis and
spatial/temporal quality limits. Retrieval and
the selected freshness basis and any provider-declared `provenance.expiresAt` are
checked on every hit. Attribution may include `logo: { lightUrl, darkUrl }` and
`notice`; preserve and display these along with the legal link for Apple weather.
Changing only preferences or speed
can reuse the same horizon snapshot across dates and windows. Registered providers
use stable horizon keys; a clock-hour rollover does not invalidate cached data.
The nearest selected date controls refresh timing, independent of preview dates;
previews with evidence too old for their date remain unassessable until refreshed.
Expiry or changed required measurements (for example enabling cloud scoring) may cause new calls. Concurrent
cold requests are not globally coalesced. See [planning and caching](planning-api.md). Global Spot coalesces identical coordinates. BPF coalesces samples
that resolve to the same forecast site across comparisons and caches its site
catalogue for 24 hours. Adding a route only fetches sites without compatible fresh
evidence. The `weather:v2:` key prefix separates these snapshots from the previous
range-based cache. Failed reads/writes do not turn into fabricated
weather. Concurrent requests can still fetch the same missing key: this MVP has
no distributed quota counter or request coalescer.

The provider uses concurrency four, a ten-second per-location deadline (covering both BPF forecast calls), and a
30-second comparison deadline. Redirects are not followed. Quota/auth errors stop
queued calls; there are no automatic retries. Responses expose derived ride
assessments with “Powered by Met Office data” attribution, not a raw weather proxy.
See [weather provider research](weather-providers.md).

## Checks and observed results

`bun run check` runs types, formatting/lint, Bun unit tests and the MSW 3 integration
suite without live services. `bun run test:integration` runs that suite alone on
Node.js. Each scenario boots the actual Workers runtime with fresh D1 and KV,
applies the SQL migrations, and exercises the API over HTTP. MSW 3.0.2 handlers
resolve the Met Office subrequests through Miniflare's outbound service; an
unmatched request fails the test and has no network fallback. Only the clock and
request logging are overridden in the test entry point. No personal files or real
credentials are read. See `worker/integration/README.md` for scope and conventions.
`bun run build:check` verifies the production Worker bundle. Live checks are explicit:

```sh
bun scripts/evaluate-local.ts /path/to/GPX 2026-10-10 ../evaluation/api-live-check.json
# With existing route IDs, append --reuse; do not repeatedly re-upload.
```

The local ignored report (`evaluation/api-live-check.json`) covers all six supplied GPX
files, 55 weather locations and 86 tested departures. All departures were
assessable. The cold baseline was about 605 ms. After preparing forecast lookups
once per comparison, ten warm repeats had a median of 29 ms and a maximum/nearest-rank
p95 of 37 ms, all with 55 hits and zero misses. Small local samples are not deployed
latency or load guarantees. Full original forecast snapshots are not archived in
the report; deterministic reproduction uses the synthetic test fixtures.

The initial 10 October sunshine iteration assessed all six routes, 55 locations and 86
fully covered departures for Sunday 11 October. The explicit six-route comparison
used Global Spot weather symbols (BPF's 55-call allowance cannot cover all sites).
BPF was independently exercised on London Loop, Braintree and East Anglia using
its numerical cloud field. Both runs are diagnostic local checks, not calibration
success claims: Braintree ranks first with the sunshine profile, while East Anglia
still ranks too highly compared with Dan's initial feedback. Forecasts also changed
between checks. The original assessment, newer results and normalized replay
snapshots are kept locally under ignored `evaluation/*-live-check.json` paths.

For the wind follow-up, replay that saved snapshot without an API key or network:

```sh
bun scripts/replay-calibration.ts /path/to/GPX \
  ../evaluation/2026-10-11-sunshine-live-check.json \
  ../evaluation/2026-10-11-sunshine-snapshot-live-check.json \
  ../evaluation/sunshine-profile-v4.json \
  ../evaluation/2026-10-11-wind-calibration-live-check.json
```

The tool validates route hashes and snapshot structure, reproduces the baseline
ranking and saved candidate scores, then changes only the profile's preferences.
Append `09:00 13:00` to replay a whole-ride window; this also records the
unrestricted result under the same profile for comparison. It retains the
original provider, statistics, day, speed and evaluation clock;
the profile's weather selection is deliberately not used to relabel a captured
forecast. It records all candidate departures and before/after results in an
ignored report. It refuses missing routes, unmatched evidence or baseline drift.
This is an offline algorithm comparison, not a fresh forecast or new HTTP test.

## Production deployment

The API is hosted at **https://ride-on-api.barclaysd.workers.dev**; its first production
release was v0.3.0 on 10 October 2026. The importer/shortlist release was v0.4.0.
The session-only authentication release was v0.6.0, and climbing preferences
arrived in v0.7.0 (`comfort-v0.5`). Preferred distance was v0.8.0 (`comfort-v0.6`).
Apple Weather was v0.9.0 (`comfort-v0.7`). Multi-day planning and preference presets
arrived in v0.10.0 with algorithm `comfort-v0.8`. Ride history and recent-route
preferences are v0.11.0 (`comfort-v0.9`). Planned snapshots, next-window suggestions
and route-history summaries are v0.12.0. Safari extension sign-in is v0.13.0;
the single Met Office choice is v0.14.0 (algorithm unchanged at `comfort-v0.9`).
`GET /health` reports the running API `version`, `algorithmVersion` and Git
`revision` (null for an untagged local/manual build). The canonical custom domain is
`https://api.ride-on.cc`. Both Met Office credentials and `AUTH_CONFIG_JSON` are
Worker secrets. Apple Weather uses the separate `APPLE_WEATHER_CONFIG_JSON` secret.
The obsolete `API_KEYS_JSON` secret is no longer used. Provider
activation is described in
[authentication](authentication.md). Never commit their values or put Met Office
credentials in a client.

The production `ride-on-routes` D1 database is in Western Europe. Its ID is recorded
in `wrangler.jsonc`. Apply all migrations, including `0004_identity.sql`, before
publishing the authentication-enabled Worker. No new database migration is
required for v0.6.0 through v0.10.0. v0.11.0 requires additive migration
`0005_rides.sql` before deployment. v0.12.0 additionally requires
`0006_ride_plans.sql`. v0.13.0 and v0.14.0 need no migration. Neutral preferences preserve existing scores;
legacy geometry upgrades are described in [ride history](ride-history.md).
The additive authentication migration preserves route facts, shortlists and user profiles. Earlier Worker versions remain compatible with the added columns.
`preview_database_id: "ROUTES_DB"` preserves the existing local-only database used
by `wrangler dev --local`; production data and local data are separate. The
existing KV namespace is bound as `WEATHER_CACHE`, with the new weather key
prefix. Legacy classification cache entries remain untouched.

Dan's saved profile was copied through the production user API and is now linked
to his Apple login. The one-time claim was completed on 10 October 2026; extension
and app clients must use normal sign-in without repeating it. Existing GPX
imports remain local: upload routes to production to obtain production route IDs.
A short synthetic route verified GPX ingestion, database persistence, saved-profile
resolution, time-window planning and real recommendations from both Met Office
Global Spot and BPF. The temporary route was then removed. Health and unauthenticated
access checks passed. BPF still reports its documented unknown model-run age;
retrieval freshness is explicitly selected. This is a functional deployment
check, not a full-library load test. Its report is kept in the ignored
`evaluation/production-api-live-check.json` file.

Cloudflare accepted the configured 5,000 ms CPU ceiling; startup took 50 ms for
the initial deployment. Network wait is separate from CPU time. The full comparison
workload requires Workers Paid limits, particularly for weather subrequests.
No subscription or plan was changed. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

CI checks and bundles the Worker on pull requests, with Node 24 and Bun 1.4.0.
Changes to `worker/**` or its deployment workflow merged to main automatically
run checks, apply pending D1 migrations, and publish the Worker. Deployment uses
the GitHub `CLOUDFLARE_API_TOKEN` secret, which needs Workers deployment (including
its custom domain and KV binding) and D1 migration permissions for the configured
Cloudflare account. No repository-variable setup gate is required.

The deployment tags the Worker version with the commit SHA. Its smoke checks
verify that exact revision and algorithm version at `https://api.ride-on.cc/health`
and require an unauthenticated `/routes` request to return 401. These checks do not
call a weather provider. A failed check, migration, deployment or smoke check
makes the workflow fail visibly. Use `gh workflow run worker-deploy.yml --ref main`
to retry a deployment; manual runs on other branches are skipped. Production
deployments are serialized and an in-progress deployment is not cancelled.

For an authorized manual deployment from `worker/`:

```sh
bun run check
bun run build:check
bun run migrate:remote
bun run deploy
WORKER_URL=https://ride-on-api.barclaysd.workers.dev bun test test/smoke.test.ts
```

The migration and deployment commands above target production. Use
`bun run migrate:local` and `bun run dev` for local work. Existing clients calling
`/classify` or `/strava/*` need migration to the new API.

## Errors

Malformed inputs: 400; invalid/missing token: 401; unknown or another owner's route:
404; duplicate profile, stale profile/route/selection version or unversioned changed import: 409; oversized body: 413; unsupported media type: 415; unsupported route source, invalid GPX or too many
weather locations or an invalid/out-of-range pause date (`PAUSE_DATE_OUT_OF_RANGE`): 422; missing access configuration: 503. Errors use
`{ "error": { "code": "...", "message": "..." } }`. Weather/provider problems are
represented in a successful assessment response with explicit unavailable data,
not hidden behind a generic error or a fabricated best ride.
