# Ride On API MVP

Implemented on 9 October, calibrated and first deployed on 10 October 2026. TypeScript, Hono and Cloudflare Workers;
D1 stores route facts, source identities, shortlists and user profiles, KV caches forecasts, and a deterministic evaluator ranks
route/departure combinations. This replaces the legacy classification and Strava
OAuth endpoints. The existing app clients have not yet been migrated.

## Run locally

Use Node.js 24+ and Bun 1.4.0. From `worker/`:

```sh
bun install --frozen-lockfile
# On a new checkout, copy .dev.vars.example to .dev.vars and fill its placeholders.
bun run migrate:local
bun run dev:session
bun run dev
```

`.dev.vars` contains `MET_OFFICE_API_KEY`, `MET_OFFICE_BPF_API_KEY` and a separate
local `AUTH_CONFIG_JSON`. `dev:session` creates a 24-hour bearer session in local
D1 and saves it to ignored, owner-readable `.local-session.json`; it never accesses
production. Pass an existing local owner ID to reuse that local dataset. The
current checkout's weather secrets must not be overwritten. Secrets and local
database state are ignored by Git. Route IDs in local live reports refer to local D1.

Product endpoints require a session cookie or session bearer token. `/health`,
provider discovery and login entrypoints are public. Responses use
`Cache-Control: no-store`. Cookie writes and browser CORS use exact trusted origins.
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
"displayName": "Dan", "createdAt": "...", "updatedAt": "...", "settings": { ... } } }`
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
can continue using the original API defaults and per-request settings. Responses
include `savedUser: { "id": "dan", "version": 1 }` (or `null`) and the exact
resolved settings, so a result can be traced to the profile used. Date, route IDs
and the day's time window belong to the recommendation request, not the profile.

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
the stored record contains sampled geometry rather than the original GPX file.
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

- An identical GPX and effective name returns HTTP 200 with `outcome: "unchanged"`.
  The route ID, timestamps and version stay unchanged, including concurrent retries.
- To change the GPX or name, send the same source identity with `expectedVersion`
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
even if its geometry is equivalent. No automatic cross-source matching or ride-history
penalty is applied.

`GET /routes/<id>` returns one owned summary with source, version and timestamps.
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
      "comfortableHeadwindKph": 10,
      "comfortableCrosswindKph": 15,
      "comfortableGustKph": 25,
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
"model-run" }`. The ensemble summary explicitly selects marginal p50 temperature,
wind speed, gust, precipitation rate and cloud, ensemble-mean wind direction, and
hourly probability of precipitation > 0 mm. It is not a joint forecast scenario.
`weather.descriptors` returns these meanings. The selection is provider independent;
an adapter must supply the exact requested statistics to be used.

BPF does not expose model-run time in the verified responses. Retrieval freshness
must be chosen explicitly; `unknown-model-run` remains visible and `forecastRunAt`
is absent. Retrieval age never establishes model age. Unsupported combinations
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

### Personal crosswind sensitivity

`preferences.wind.crosswindSensitivity` scales the crosswind discomfort term
above `comfortableCrosswindKph`. It is a number from 0 to 10, default 1; 0 ignores
this scoring penalty, while 1 preserves the previous wind calculation. Headwind,
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
combined score and causes no weather requests. Known zero ascent is valid flat
terrain. An impossible time window still returns `no_feasible_departure` first.
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
- `maximumGustKph: 40`
- `maximumPrecipitationProbability: 0.2` (fraction, not percent)
- `maximumPrecipitationRateMmH: 0.5`

These are syntax examples, not adopted settings. A missing month uses the explicit
fallback or remains unknown. Equality meets a threshold; any sampled breach fails
it. Failure evidence includes the limit, worst actual value, affected distance,
route sections and their modelled observation times. A zero scoring weight does
not switch off a configured minimum standard. Climate-relative temperature rules
remain a future extension; unsupported configuration is rejected rather than guessed.

### Result contract

The response includes:

| Field | Meaning |
|---|---|
| `recommendedRouteId` | Best assessable route, or `null` if none can be recommended. |
| `rankings` | Ordered routes; each has `best`, up to three tested alternative departures, duration, daylight, effective window, warnings and coverage counts. |
| `unranked` | Routes with `unassessable` evidence (weather, or elevation when climbing matters) or `no_feasible_departure`. |
| `distanceM`, `ascentM`, `ascentMPerKm` | Route distance and estimated total/ascent-per-kilometre facts; ascent fields are `null` when elevation is incomplete. |
| `distanceFit` | `null` with no distance preference; otherwise `status` (`within_range`, `below_range`, `above_range`) and nonnegative `deviationKm`. Outside-range routes stay eligible. |
| `best.departureAt`, `best.finishAt` | Suggested start and estimated finish. |
| `best.score`, `best.weatherScore`, `best.factors` | Combined ride score, original weather-only score and temperature/wind/dryness/clear-sky/sunshine/climbing/distance factors. These are not probabilities. |
| `best.conditions`, `best.rideHours` | Derived overall/per-ride-hour temperature range, average sustained wind and components, maximum headwind/crosswind/gust, total cloud mean/maximum fractions (or null), precipitation risk/rate, categorical sky-condition distance fractions and assisted-distance fraction. |
| `best.standards` | `meets`, `below`, `unknown`, or `not_configured`, with structured failures. |
| `minimumStandardsStatus` | Collection-level `match_found`, `none_meet`, `unknown`, `not_configured`, or `no_feasible_departure`. |
| `message`, `best.drawbacks` | Readable conclusion and trade-offs. |
| `savedUser`, `resolvedPreferences`, `resolvedMinimumTemperature`, `riding` | Saved profile identity/version, exact effective settings and seasonal limit origin. |
| `algorithmVersion`, `generatedAt`, `assumptions` | How and when the assessment was made. |
| `weather` | Requested/selected provider, attempts, per-location provenance/issues, range, quality limits and cache hits/misses. |

A route known to meet every configured standard takes priority over a higher
scoring route that does not. Otherwise the highest comfort score is returned as
the best available. Each route is represented by its best departure under that
same rule. A high score never erases a failed standard.

`none_meet` means every assessable choice fails and no unresolved choice could
change that conclusion. If another route/departure lacks evidence, or a month
rule is unresolved, return `unknown` instead. No feasible departure is distinct
from bad weather. Missing data never becomes zero rain or zero wind.

## Algorithm v0.6

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

Instant forecasts and ten-minute wind means use the nearest hourly validity,
within 30 minutes. This is an approximation, not a forecast of every minute.
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
passing a percentile off as a deterministic value. Met Office Global Spot hourly and BPF v2 UK
are configured with separate secrets. Tests exercise a second synthetic provider.

`weather: { "mode": "ordered-fallback", "providerIds": ["met-office", "another-provider"] }`
allows that exact ordered list. The source-selection layer chooses one provider
for the entire comparison, with no field mixing or silent outside fallback.
The default is strict Met Office; this is not an inferred worldwide preference.

Quality limits: hourly resolution, model runs at most six hours old by default
(or retrieval age only when explicitly selected), resolved
weather location within 10 km of the query and evaluated section. Weather points
are sampled along the route every 10 km. These are engineering starting policies,
not a claim of kilometre-scale forecast accuracy.

KV stores normalized evidence for 20 minutes, keyed by provider/product/adapter,
coordinates, required descriptors, day range and quality limits. Retrieval and
the selected freshness basis are checked on every hit. Changing only preferences or speed
can reuse the same day snapshot. Changing the route collection's time range may
miss the cache, as can changing the required measurements (for example enabling
cloud scoring). Global Spot coalesces identical coordinates. BPF coalesces samples
that resolve to the same forecast site within each comparison and caches its site
catalogue for 24 hours. Failed reads/writes do not turn into fabricated
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
arrived in v0.7.0 (`comfort-v0.5`). Preferred distance is v0.8.0 with algorithm `comfort-v0.6`;
`GET /health` reports the running version. The canonical custom domain is
`https://api.ride-on.cc`. Both Met Office credentials and `AUTH_CONFIG_JSON` are
Worker secrets. The obsolete `API_KEYS_JSON` secret is no longer used. Provider
activation is described in
[authentication](authentication.md). Never commit their values or put Met Office
credentials in a client.

The production `ride-on-routes` D1 database is in Western Europe. Its ID is recorded
in `wrangler.jsonc`. Apply all migrations, including `0004_identity.sql`, before
publishing the authentication-enabled Worker. No new database migration is
required for v0.6.0, v0.7.0 or v0.8.0.
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
Automatic deployment remains gated by repository variable
`API_MVP_DEPLOYMENT_READY=true`; this initial production deployment used the
authenticated local Wrangler session. The gate remains unset. Before enabling it,
verify the GitHub `CLOUDFLARE_API_TOKEN` has access to both Workers deployment and
D1 migrations. When enabled, the workflow applies migrations before publishing
and runs health/authentication smoke checks.

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
weather locations: 422; missing access configuration: 503. Errors use
`{ "error": { "code": "...", "message": "..." } }`. Weather/provider problems are
represented in a successful assessment response with explicit unavailable data,
not hidden behind a generic error or a fabricated best ride.
