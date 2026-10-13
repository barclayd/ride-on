# Ground evidence API — phase 2

Introduced in API v0.21.0. This is an experimental evidence service, independent
of the rider's selected weather provider. It does not estimate mud, change scores,
add preferences or trigger automatically from the extension. Algorithm version
remains `comfort-v0.11`. The [phased plan](ground-conditions-plan.md) records the
remaining validation before automatic use.

## Request

`POST /ground-evidence` requires the same session as `/routes`:

```json
{ "routeIds": ["11111111-1111-4111-8111-111111111111"] }
```

Supply 1–12 distinct, owned route IDs. Unknown input fields are rejected. Missing
or foreign routes return `404 ROUTE_NOT_FOUND` before any provider requests;
unauthenticated requests return 401. `GROUND_EVIDENCE_MODE=non-commercial` enables
the endpoint; another value, including `off`, returns `503 GROUND_EVIDENCE_DISABLED`.
The current deployment enables this explicit diagnostic for non-commercial use.
Before commercial operation, configure a permitted customer endpoint/subscription
and verify its metering; the current adapter intentionally supports only the free
non-commercial endpoint.

## Evidence and coverage

The response includes:

- `schemaVersion: 1`, `experimental: true`, `scoringApplied: false`.
- `asOf`: the last completed UTC hour. Trailing totals end here, not at a future
  departure. The separate [phase 3 assessment](ground-assessment-api.md) calculates
  wetness at each section's arrival.
- `source`: provider `open-meteo`, model policy `ukmo_seamless`, adapter version,
  attribution and `modelRunAt: null`. Retrieval time is not model issuance time.
  UKMO seamless combines UK and global model products; it is not a guaranteed
  single model run or uniform native resolution.
- `requestGrid`: a versioned 0.05° lattice for sharing requests. Each coordinate
  represents the cell centre, not exact path conditions or native model cells.
- `routes[]`: source hash and ordered `{fromM, toM, surface, cellId}` exposure
  sections. Paved and non-cycling sections are excluded. Missing classifications
  and gaps remain `unknown`. Legacy imports therefore request unknown exposure;
  they do not claim that a route is unpaved. Locations use existing route legs,
  not every original GPX point. Fully paved routes return `not-applicable` and
  produce no new weather requests.
- `coverage`: required/requested cells, omitted IDs and the limit (12). Selection
  is stable by cell ID, independent of route request order. Each route's `omittedM`
  makes spatial truncation explicit. Do not infer route-wide coverage if this is
  nonzero. Cell requests can also fail independently.
- `cells[]`: request coordinate, refresh outcome, day provenance, summaries and
  hourly data. `refreshStatus` is `cached`, `refreshed`, `pending`,
  `budget-exhausted` or `provider-unavailable`. It is **not** a completeness rating.

Each cell has 35 UTC dates: today minus 28 days through today plus six days.
Data outside the model's available horizon stays missing. Each date has 24
hourly slots; `days[]` records retrieval/refresh times, returned grid coordinate
and a stale flag. The adapter rejects returned grid points more than 30 km from
the requested point. Provider failures retain older data, clearly marked stale;
missing days have null provenance and null values.

`hours[]` fields:

| Field | Meaning |
| --- | --- |
| `end` | UTC interval end |
| `rainMm` | UKMO rainfall accumulation in the preceding hour |
| `precipitationMm` | Total precipitation water equivalent, including snow; not extra rain to add to `rainMm` |
| `snowfallCm` | Snowfall amount in cm; never add cm directly to rainfall mm |
| `referenceEt0Mm` | FAO reference evapotranspiration for well-watered grass; a drying indicator, not measured path evaporation |
| `temperatureC` | Instantaneous 2 m temperature at `end`, for experimental freezing/thaw handling |
| `basis` | `modelled-past` or `forecast`, determined at retrieval |

Accumulation periods are `(end − 1 hour, end]`. Everything uses UTC elapsed time;
DST cannot add/remove an hour of rainfall. `basis` is retained in the cache: a
forecast does not become an observation when its valid time passes. Past values
from this endpoint are model estimates, not rain-gauge observations. There is no
separate archive/forecast splice and no substitution with zero for missing hours.

`history[]` contains 24, 72, 168, 336 and 672 hour windows. Each of `rain`,
`precipitation` and `referenceEt0` includes:

```json
{
  "totalMm": null,
  "knownTotalMm": 4.2,
  "availableHours": 23,
  "expectedHours": 24,
  "forecastHours": 0
}
```

`totalMm` is null unless the entire window is present; `knownTotalMm` is only the
sum of available intervals and is null if none exist. Consult day stale flags as
well as coverage. The 28-day background helps phase 3 initialize wetness;
it does not establish that ground was dry before that window. No soil, drainage,
shade or surface-moisture measurements are claimed.

## Cache and request limits

Shared D1 cache keys include provider, model policy, adapter version, request
cell and UTC date. No route IDs, user IDs or GPX geometry are saved in this cache.
Migration `0007_ground_evidence.sql` adds evidence, lease and usage tables only.

| Date relative to retrieval | Refresh after |
| --- | --- |
| Today / tomorrow | 3 hours |
| Previous two days | 6 hours |
| Two or more days ahead | 12 hours |
| Three or more days ago, with complete data | 90 days |
| Incomplete data, any date | 15 minutes |

The expiry is relative to retrieval, never the next clock hour. Old days are
retained for 90 days. Missing/stale dates are fetched in one bounded contiguous
range per cell; still-fresh intervening dates retain their original cached data.
Overlapping routes share this evidence. Changing preferences never requests it.
D1 leases coordinate concurrent refreshes, and a second cache read after acquiring
a lease avoids duplicate fetches. A pending refresh can return missing/stale data;
the client may retry later. There are no automatic retries inside a request.

At most 12 provider attempts are made per diagnostic, each with a 10-second
network timeout and a 2 MB response bound. Redirects are rejected. Daily atomic
reservations cap this integration at 400 conservative units across all users.
Failures count against that cap; it resets at UTC midnight. Other applications
or manual probes are outside this budget. Expired cache/lease rows and usage older
than 90 days are pruned during diagnostics.

`usage.httpRequests` counts attempted upstream HTTP calls for this request.
`estimatedWeightedCalls` uses `max(1, requestedDays / 14)` for the current five
variables, single model policy and one location per HTTP call. Reservations round
that estimate up per call. For example, an empty 35-day cell uses one HTTP request,
2.5 estimated weighted calls and three reserved units. Twelve new cells reserve
36 units, rather than implying that twelve HTTP requests mean twelve billable
calls. Cache hits use zero units.

The provider's free response does not report billing: `actualBillableCalls` is
null and `billingStatus` is `not-reported-by-provider`. These estimates are not
measured billing or a subscription guarantee. Check actual account usage before
commercial launch or raising the cap. No Met Office direct API allowance is used
by this service.

## Independent rain-gauge validation

Run the explicit diagnostic from `worker/`:

```sh
bun scripts/probe-ground-evidence.ts --live 51.5 -0.1
```

This makes up to eight public HTTP requests and writes a JSON comparison to
stdout. It is never run by normal tests, recommendation requests or CI. It checks
up to three nearby gauges within 15 km, skips clearly inactive ones, and compares
14 completed UTC dates at the selected gauge coordinate. HTTP counts and source
attribution are included. Gauge data and this live probe are not persisted in the
shared model cache.

EA provides 15-minute accumulated rainfall, often transferred only once or twice
per day. Missing intervals and conflicting duplicates invalidate totals. Empty
or unavailable gauges are explicit. A full response page fails rather than
silently claiming complete coverage. Metadata/reading URLs are constructed on a
fixed host; provider-supplied links are never fetched.

EA's public guide does not unambiguously define whether `dateTime` starts or ends
the accumulation interval. The diagnostic reports both interpretations, with
`timestampConvention: unverified`, and does not blend either into ground evidence.
Confirm this before exact boundary comparisons. Grid-to-gauge differences and
limited samples prevent using this diagnostic alone to calibrate mud severity.

## Sources

- [Open-Meteo forecast documentation](https://open-meteo.com/en/docs)
- [UKMO product coverage](https://open-meteo.com/en/docs/ukmo-api)
- [Usage weighting and non-commercial terms](https://open-meteo.com/en/pricing)
- [Environment Agency rainfall reference and attribution](https://environment.data.gov.uk/flood-monitoring/doc/rainfall)
