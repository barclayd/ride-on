# Ride On API MVP

Implemented locally on 9 October, with sky and wind calibration on 10 October 2026. TypeScript, Hono and Cloudflare Workers;
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

`.dev.vars` contains `MET_OFFICE_API_KEY`, `MET_OFFICE_BPF_API_KEY` and `API_KEYS_JSON`. The latter is a JSON
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
thin high cloud. The current experimental profile is
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

The provisional v4 profile uses sensitivity 5 and a comfortable crosswind of
5 km/h (about 3.1 mph), with the weights above. Light winds below this threshold
remain comfortable whatever the route direction. Sustained crosswinds beyond it
carry more weight relative to sunshine. Other riders retain their own settings;
route names, locations and ranks never enter the scoring formula.

This calibration replays the same forecasts as v3. Braintree stays first and East
Anglia moves from second to sixth after all 86 departures are re-evaluated. These
are fitted results on one reviewed day, not validation on unseen weather. The
middle ordering and exact settings still require human grading. Earlier profiles
remain available for comparison; no seasonal minimum temperatures were invented.

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
| `best.score`, `best.factors` | Provisional comfort score and temperature/wind/dryness/clear-sky/sunshine factors. These are not probabilities. |
| `best.conditions`, `best.rideHours` | Derived overall/per-ride-hour temperature range, average sustained wind and components, maximum headwind/crosswind/gust, total cloud mean/maximum fractions (or null), precipitation risk/rate, categorical sky-condition distance fractions and assisted-distance fraction. |
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

## Algorithm v0.4

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
factors are evaluated at the expected arrival time, including hourly cloud or weather symbols. Final
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
It retains the original provider, statistics, day, speed and evaluation clock;
the profile's weather selection is deliberately not used to relabel a captured
forecast. It records all candidate departures and before/after results in an
ignored report. It refuses missing routes, unmatched evidence or baseline drift.
This is an offline algorithm comparison, not a fresh forecast or new HTTP test.

## Deployment status

This rebuild is local and has not replaced the existing deployed Worker. Before
its first deployment, create the remote D1 database, copy its ID into
`wrangler.jsonc`, apply its migration, and provision the required Worker secrets.
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
