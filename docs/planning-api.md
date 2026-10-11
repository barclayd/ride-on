# Multi-day planning and preference presets

API **v0.10.0**, algorithm **comfort-v0.8**. This is the implemented contract;
[brief v2](extension-api-brief-v2.md) remains a record of proposals. The short
[design decisions](extension-api-v2-decisions.md) explain the deliberate differences.
Existing single-date requests, owner/session isolation, provider selection,
scoring weights and standards-first ordering remain supported. No D1 migration.

## Search dates and optional preview

`POST /recommendations` accepts exactly one of `date` or `days`. Both/neither is
400. `days` is a preset (`today`, `tomorrow`, `weekend`, `next`) or an inclusive
range of one to seven consecutive dates. Dates use the effective IANA timezone.

```json
{
  "routeIds": ["YOUR_ROUTE_UUID"],
  "days": { "kind": "preset", "preset": "next" },
  "previewDays": 7,
  "riding": { "window": { "start": "09:00", "end": "13:00" } },
  "preferenceLevels": { "sunshine": "important", "rain": "light-ok" }
}
```

`next` considers today through today+4 at most. `weekend` means the upcoming
Saturday–Sunday, current Saturday–Sunday on Saturday, or Sunday alone on Sunday.
These resolve calendar intent first; dates demonstrably beyond returned forecast
coverage are excluded from a multi-date selection, not replaced with other dates.
A provider error remains an explicit unavailable result, not an inferred horizon.
A range partly in the past retains its remaining dates. A fully expired range
returns `expired: true`, `range: null`, empty rankings/unranked/days and no weather
calls, even when preview was requested. There is never a fallback to `next`.

`previewDays` optionally adds today through today+N−1, with N from 1 to 7. Omit it
for no extra evaluations. Preview dates cannot change the selected recommendation.
The API evaluates the sorted union of selected and preview dates (bounded by 14).
Only the explicitly selected dates contribute to route rankings. Each whole ride
must fit both daylight and any custom window; elapsed slots are never recommended.
Ambiguous/nonexistent custom times, including DST transitions on evaluated dates,
return 400 before weather calls. Overnight custom windows remain unsupported.

Response additions:

- `date`: the legacy requested date, or null for a multi-date search.
- `range`: resolved `{start, end, preset, fallback: false}`, or null when expired
  or all selected dates are demonstrably beyond available forecast coverage.
- `expired`: distinguishes expired selections from future/unavailable forecasts.
- `previewRange`: requested preview calendar range, or null.
- `days`: the sorted evaluated union. Use `previewRange` for the seven-tile strip;
  `selected` identifies dates included in ranking after coverage resolution.
- `rankings[].best.date` and alternatives' `date`: local departure dates.
- `recommendation`: `{routeId, kind: "best_pick" | "best_available"}`, or null
  when no comparable departure is assessable. Existing `recommendedRouteId` remains.
- `resolvedMinimumTemperatures`: date-keyed resolutions of monthly/fixed limits.
  Use this for multi-day searches; the legacy singular field describes the first
  evaluated date only.

Across dates the API reuses the existing ordering: confirmed minimum-condition
matches first, then score, then earlier departure; route IDs break remaining ties.
Alternatives may span dates. Clients must not merge or re-sort daily results.

## Day tiles, actual coverage and explanations

Each day includes `availability: full | partial | none`, `availabilityReason`,
`availabilityBasis: required_windows_for_feasible_routes`, `until`, `daylight`,
`temperatureMaxC`, `quality`, `recommendedRouteId`, `minimumStandardsStatus` and
per-route `coverage[].intervals` with UTC start/end instants.

Availability checks essential measurements, their native intervals and location
constraints throughout the effective windows of routes with feasible departures.
Unknown sunshine symbols do not remove otherwise usable hours: sunshine is a
preference factor, with unknown sections contributing neutral comfort (0.5) to
the score. Each departure's `sunshineAssessment` reports `complete`, `partial`
or `unavailable` and `unknownDistanceFraction`; it is null when sunshine is not
requested. Temperature, wind, gusts, precipitation and explicitly requested cloud
cover remain strict. Sunshine category shares and the sunshine factor stay null
when any evaluated section lacks a symbol; neutral scoring is not forecast data.
It is temporal evidence coverage, not confidence, weather quality, or proof that a
ride meets minimum standards. A fully covered window may still have no comparable
score because climbing evidence is missing. Likewise, some complete rides can fit
inside a partially covered window.

Reasons are `available`, `partial_coverage`, `outside_forecast_horizon`,
`provider_unavailable`, `missing_data`, `not_evaluated`, `no_feasible_departure`, or
`no_remaining_window`. Only `outside_forecast_horizon` warrants “Not yet”.
Provider failures need an unavailable/retry state. No fit and elapsed windows
must remain distinct. When there is no feasible departure anywhere in the request,
no forecasts are fetched just to decorate tiles.

`until` is a full UTC timestamp, present only for partial coverage that forms one
continuous prefix from each relevant window's start. Interior gaps return null;
use the actual intervals instead. With no cutoff, explain that some weather
details or hours are missing along the routes, rather than implying the provider
stops forecasting that date. Format timestamps using response `timeZone`.
Daylight is the conservative shared sunrise/sunset interval across route samples;
it can be null. `quality` is the score of that day's best assessed route, not a
probability or forecast confidence. `temperatureMaxC` describes that same
recommended departure, not the hottest point across unrelated routes. Both are
null when there is no ranked recommendation for that date.

Route additions:

- `verdict: {status, code, reason}`. Statuses are `meets`, `below_minimums`,
  `doesnt_fit`, `incomplete`. Codes distinguish `minimums_met`,
  `minimums_not_configured`, `minimums_failed`, `unresolved_minimums`,
  `missing_elevation`, `missing_weather`, `no_feasible_departure`.
  “No minimums configured” must not be presented as proof that minimums were met.
- `coverage: {basis: "feasible_departure_slots", tested, assessed, unknown,
  assessedFraction, intervals}` describes departure options. The fraction is null
  when no departure is feasible. Intervals contain inclusive `firstDepartureAt`
  and `lastDepartureAt` on the configured departure grid. It is not a partially
  scored ride or a confidence percentage. Every ranked ride has full required
  weather evidence for its entire estimated journey.
- `departuresWeatherAssessed` counts slots with usable weather, independent of
  whether missing elevation prevents a combined score.
- Missing elevation with active climbing stays in `unranked`, with `best: null`.
  Where weather is assessable, `partialAssessment` supplies the best weather-only
  candidate, its weather score, distance factor and conditions, but `score: null`
  and `status: partial`. Do not merge this into the ordinary ranking. With no
  usable weather, `partialAssessment` is null.
- Minimum-standard failures now include `at`, `date`, `timeZone`, `positionKm`.
  `at` is the estimated encounter time at the section with the worst forecast
  value (earliest section on ties); it is not the first failing section or a live
  observation. Existing `actual`, `limit`, affected distance and section evidence
  remain available for client-localized drawback text.

## Saved planning and display

`settings.planning` defaults to:

```json
{ "days": { "kind": "preset", "preset": "next" }, "window": "daylight" }
```

Patch `planning.days` and/or `planning.window`; each supplied subvalue replaces
that whole subvalue. Use the existing window shape: `"daylight"` or `{start,end}`.
There is no additional `time.mode` representation. Older stored profiles read
these defaults without rewriting the database or changing their version.
`settings.display.unit` is `km` or `mi`, default `km`. It affects presentation only;
API distances remain metric. Save all fields through `PATCH /users/me` with the
current `expectedVersion`. Conflicts remain 409.

For multi-day requests, an omitted `riding.window` uses the effective saved
planning window. Legacy `date` requests retain their original daylight default.
The date selection is always explicit in the request: clients read the saved
planning choice and send `days`. Browsing another window must not silently save it.

## Functional preference levels

Create/update profile settings accept `preferenceLevels`; recommendations accept
the same field at the top level for a temporary override. They map to raw weights
before validation and are never independently persisted. Omitted controls and
unrelated raw values are preserved. Each user response includes derived
`user.preferenceLevels` next to `user.settings`; recommendation responses include
resolved `preferenceLevels`.

| Control | Write value | Underlying weight |
| --- | --- | --- |
| Sunshine: Don't mind | `dont-mind` | sunshine 0 |
| Sunshine: Nice to have | `nice` | sunshine 0.12 |
| Sunshine: Important | `important` | sunshine 0.25 |
| Rain: Don't mind | `dont-mind` | dryness 0 |
| Rain: Prefer dry | `light-ok` | dryness 0.20 |
| Rain: Strongly prefer dry | `avoid` | dryness 0.40 |

These are relative coefficients, not fixed percentages of the final score. Only
the controlled weight changes; other weights and all minimum standards survive.
All-zero weather weights still fail validation. `light-ok` remains the agreed wire
identifier for compatibility with the brief; the display label is “Prefer dry”.

Reads return `custom` when a stored value differs from every preset by more than
1e-9. `custom` is read-only. Sending both a level and its controlled raw weight is
400, even when their values agree. Dan's calibrated 0.25/0.20 values read as
`important`/`light-ok`; existing custom profiles are not coerced. There are no
climbing/wind aliases and no ineffective tailwind toggle. Direction-aware wind
assessment remains always active, without a separate stronger-tailwind bonus.

## Provider capabilities, caching and attribution

`GET /weather-providers` now includes `forecastHorizonHours`: Apple 240, Global
Spot 48, BPF 120. These advertise product capability, not available evidence or a
promise measured from the current clock. Unknown providers have no guessed horizon.
Provider selection still applies the complete compatible `recommendedSettings`.

Registered providers prefetch their advertised hourly horizon once per unique
upstream location in a cold request. Normalized snapshots are keyed by source,
coordinate, descriptors, spatial/temporal quality limits, freshness basis and
horizon length. The moving fetch range includes one preceding hour but is **not**
part of a horizon cache key: crossing the clock hour never invalidates a snapshot.
Evidence is retained for 12 hours, with freshness checked on every read according
to the nearest selected ride date in the rider's timezone:

| Selected ride date | Refresh after retrieval |
|---|---|
| Today | 3 hours |
| Tomorrow | 6 hours |
| Two or more days away | 12 hours |

These are on-demand refresh thresholds, not scheduled background calls. Selecting
a closer date tightens freshness immediately without changing the cache key.
Provider-declared expiry always takes precedence; model-run policies additionally
retain the six-hour model-age limit. Keeping an older snapshot never guarantees
that its trailing hours cover a newly available date; actual coverage remains
authoritative until the next refresh.

Preview dates do not force a distant selection to refresh at today's frequency.
A preview whose evidence is too old for its date is unassessable; selecting that
date triggers the appropriate refresh. `weather.quality.refreshAfterSeconds`
describes the selected dates' retrieval threshold, while `maxAgeSeconds` applies
to the reported freshness basis. BPF also shares cached forecasts by resolved
forecast site across different routes and requests, preserving the original
retrieval timestamp and each query point's actual distance from the site.

Changing preferences/windows can reuse evidence; changing required measurements,
provider, freshness basis or expired data can require new calls. Fallback checks
the requested comparison's coverage, rather than penalizing unused prefetched hours.

This removes per-date fan-out inside a multi-day comparison. KV is not a global
request lock: simultaneous cold requests can still duplicate upstream work.
Clients should replace the old seven parallel calls with one multi-day request,
debounce controls and discard stale results. This release does not add a paid plan,
automatic fallback or a claim that quota is unlimited.

BPF still needs two forecast requests per distinct uncached site for the current
assessment (percentiles and precipitation probabilities). At 28 sites that is 56
forecast calls, plus a catalogue request if its 24-hour cache is cold. Caching
cannot make that initial load fit a 55-call allowance. This change introduces no
hard daily quota limiter, reduced route sampling or silent provider substitution.
`weather.cache` counts coordinate snapshot hits/misses, not upstream calls: a
coordinate miss may still reuse the BPF site cache without contacting Met Office.

`weather.attribution` deduplicates the actual source metadata, including Apple
logos/legal link/derived-data notice. `weather.retrieval.oldestAt/latestAt` gives
the retrieval span across the returned evidence, with nulls when none is available.
Neither timestamp is the model-run time. Per-location provenance remains. Display
`weather.selectedSource`, not the first source of a fallback policy.

## Validation and performance

Unit and MSW 3 tests cover date validation, timezones/DST, presets, expiry, saved
planning/display, custom levels and conflicts, actual scoring changes, partial
coverage/gaps, missing elevation, standard breaches, multi-day ordering, provider
errors and cache reuse across dates, windows and Worker restart.

Run `node scripts/benchmark-planning.ts` from `worker/` for a synthetic benchmark
using the real local Worker/D1/KV with mocked upstream HTTP and ephemeral signing
keys. On 10 October 2026, 12 roughly 100 km routes (201 GPX points each), five days
and 720 departure candidates took 1,429 ms cold and 957 ms warm. There were 144
forecast calls cold and zero warm; the JSON response was about 335 KB. These are
local end-to-end wall times, not production CPU measurements or real provider
network latency. The configured 5-second CPU ceiling remains unchanged; these
numbers do not establish worst-case production capacity.
