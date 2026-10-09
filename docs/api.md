# Ride On API MVP

Implemented locally on 9 October 2026. TypeScript, Hono and Cloudflare Workers;
D1 stores route facts, KV caches forecasts, and a deterministic evaluator ranks
route/departure combinations. This replaces the legacy classification and Strava
OAuth endpoints. The existing app clients have not yet been migrated.

## Run locally

Use Node.js 24+ and Bun 1.4.0. From `worker/`:

```sh
bun install --frozen-lockfile
# On a new checkout, copy .dev.vars.example to .dev.vars and fill its placeholders.
bun run migrate:local
bun run dev
```

`.dev.vars` contains `MET_OFFICE_API_KEY` and `API_KEYS_JSON`. The latter is a JSON
array of `{ "ownerId": "dan", "token": "a-random-token-at-least-32-characters-long" }`.
Use distinct, securely generated tokens per owner. The current local checkout is
already configured; do not overwrite its secrets. Secrets and local database
state are ignored by Git. Route IDs in the live report refer to this local database.

All endpoints except `GET /health` require `Authorization: Bearer <token>`.
The server resolves the owner from that token; callers cannot choose another
owner in a request. Responses use `Cache-Control: no-store`. Browser clients will
need an explicit origin/authentication design when they are introduced; no broad
CORS policy is enabled. Current tokens are for development/private API use.

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
    "warnings": ["MISSING_ELEVATION"]
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
Duplicate uploads currently create distinct IDs. `GET /routes` returns up to 100
of the owner's newest route summaries.

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
      "comfortableGustKph": 25
    },
    "weights": { "temperature": 0.3, "wind": 0.2, "dryness": 0.5 },
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
not switch off a configured minimum standard. Climate-relative temperature rules,
saved profiles and climbing preferences remain future extensions; unsupported
configuration is rejected rather than guessed.

### Result contract

The response includes:

| Field | Meaning |
|---|---|
| `recommendedRouteId` | Best assessable route, or `null` if none can be recommended. |
| `rankings` | Ordered routes; each has `best`, up to three tested alternative departures, duration, daylight, warnings and coverage counts. |
| `unranked` | Routes with `unassessable` weather or `no_feasible_departure`. |
| `best.departureAt`, `best.finishAt` | Suggested start and estimated finish. |
| `best.score`, `best.factors` | Provisional comfort score and temperature/wind/dryness contributions. These are not probabilities. |
| `best.conditions`, `best.rideHours` | Derived overall/per-ride-hour temperature range, headwind, crosswind, gust, precipitation risk/rate and assisted-distance fraction. |
| `best.standards` | `meets`, `below`, `unknown`, or `not_configured`, with structured failures. |
| `minimumStandardsStatus` | Collection-level `match_found`, `none_meet`, `unknown`, `not_configured`, or `no_feasible_departure`. |
| `message`, `best.drawbacks` | Readable conclusion and trade-offs. |
| `resolvedPreferences`, `resolvedMinimumTemperature`, `riding` | Exact effective settings and seasonal limit origin. |
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

## Algorithm v0.1

The duration model is distance / constant moving speed. Weather is matched to the
estimated arrival at each section midpoint; wind uses that section's heading.
No tailwind-home weighting or automatic route reversal is applied. Wind assistance
means the tailwind component exceeds 1 km/h; its fraction is distance-weighted.
Stronger aiding wind avoids a headwind penalty but still incurs crosswind/gust
penalties where relevant.

Each factor is a 0–1 comfort value. Temperature is 1 within the comfort band,
then decreases linearly to 0 at 10°C outside it. Wind discomfort is the sum of
50% headwind excess (over a 20 km/h span), 20% crosswind excess (20 km/h span),
and 30% gust excess (30 km/h span), with each excess clamped to 0–1. Dryness is
`1 − (0.8 × precipitationProbability + 0.2 × clamp(rateMmH / 2))`.
Per-section comfort is the normalized preference-weighted factor mean. Final
score is 100 × (75% distance-weighted mean comfort + 25% worst section comfort).
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
passing a percentile off as a deterministic value. Only Met Office Global Spot
hourly is configured today. Tests exercise a second synthetic provider.

`weather: { "mode": "ordered-fallback", "providerIds": ["met-office", "another-provider"] }`
allows that exact ordered list. The source-selection layer chooses one provider
for the entire comparison, with no field mixing or silent outside fallback.
The default is strict Met Office; this is not an inferred worldwide preference.

Quality limits: hourly resolution, model runs at most six hours old, resolved
weather location within 10 km of the query and evaluated section. Weather points
are sampled along the route every 10 km. These are engineering starting policies,
not a claim of kilometre-scale forecast accuracy.

KV stores normalized evidence for 20 minutes, keyed by provider/product/adapter,
coordinates, required descriptors, day range and quality limits. Retrieval and
model-run freshness are checked on every hit. Changing only preferences or speed
can reuse the same day snapshot. Changing the route collection's time range may
miss the cache. Exact duplicate coordinates are coalesced upstream; nearby-site
reuse is not yet implemented. Failed reads/writes do not turn into fabricated
weather. Concurrent requests can still fetch the same missing key: this MVP has
no distributed quota counter or request coalescer.

The provider uses concurrency four, a ten-second per-fetch deadline, and a
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
bun --env-file=.dev.vars scripts/evaluate-local.ts /path/to/GPX 2026-10-10 ../evaluation/api-live-check.json
# With existing route IDs, append --reuse; do not repeatedly re-upload.
```

The local ignored report (`evaluation/api-live-check.json`) covers all six supplied GPX
files, 55 weather locations and 86 tested departures. All departures were
assessable. The cold baseline was about 605 ms. After preparing forecast lookups
once per comparison, ten warm repeats had a median of 29 ms and a maximum/nearest-rank
p95 of 37 ms, all with 55 hits and zero misses. Small local samples are not deployed
latency or load guarantees. Full original forecast snapshots are not archived in
the report; deterministic reproduction uses the synthetic test fixtures.

## Deployment status

This rebuild is local and has not replaced the existing deployed Worker. Before
its first deployment, create the remote D1 database, copy its ID into
`wrangler.jsonc`, apply its migration, and provision both required Worker secrets.
The existing development KV namespace is reused with a new key prefix. Old cached
classification keys are untouched. See [D1 migration commands](https://developers.cloudflare.com/d1/wrangler-commands/).

The configured maximum workload needs Workers Paid: the six-route cold comparison
alone exceeds the Free plan's 50 external subrequests, and CPU must also be measured
on the deployed tier. Free has 10 ms CPU; network wait is excluded from CPU time.
See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
No plan changes, remote resources, deployments or purchases were made in this work.

CI checks and bundles the Worker on pull requests, with Node 24 and Bun 1.4.0.
Automatic deployment is gated by the repository variable
`API_MVP_DEPLOYMENT_READY=true`. Leave it unset until remote resources, secrets and
the Workers plan are ready; merging this foundation does not deploy it.
When enabled, deployment applies migrations
before publishing and runs health/auth smoke checks. Remote setup is required
before that workflow can succeed. Existing clients that call `/classify` or
`/strava/*` will need migration before they use this rebuilt backend.

## Errors

Malformed inputs: 400; invalid/missing token: 401; unknown or another owner's route:
404; oversized body: 413; unsupported media type: 415; invalid GPX or too many
weather locations: 422; missing access configuration: 503. Errors use
`{ "error": { "code": "...", "message": "..." } }`. Weather/provider problems are
represented in a successful assessment response with explicit unavailable data,
not hidden behind a generic error or a fabricated best ride.
