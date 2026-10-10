# Weather providers for the API MVP

Researched and live-checked 9–10 October 2026. Apple Weather, Global Spot hourly and
BPF v2 UK adapters implement the same provider contract. GPX ingestion, D1 storage,
forecast caching and recommendation evaluation are verified in the Workers runtime.
See [Apple Weather](apple-weather.md) for its mapping, setup and attribution, and
the API guide for deployment state.
See [the API contract](api.md) for the current request/response and scoring policy.

## Decision

Keep TypeScript, Hono and Cloudflare Workers. The recommendation engine consumes
our own weather contract through an injected provider. Provider response formats,
credentials and HTTP calls stay inside adapters. Dan's UK policy is Met Office
only. Other riders can select a
provider or explicitly allow an ordered fallback list.

From v0.9.0, new profiles and requests without saved settings default to **Apple
Weather** (`apple-weather`), deterministic values and retrieval-time freshness.
Existing saved source selections are preserved. Cloud-aware Met Office profiles can
explicitly select **BPF v2 UK** (`met-office-bpf`) with `ensemble-summary` assessment
and `retrieval-time` freshness. Both keys have been authenticated locally. Neither
feed has been established to match the Met Office consumer app exactly. Providers
are never silently combined or substituted.

### Cloud requirement discovered in human grading — 10 October 2026

Dan identifies low total cloud coverage as a major comfort preference. In an otherwise
equal, dry, comfortable-wind comparison, he prefers 14°C with 10% cloud to 17°C with
80% cloud. This belongs in a personal profile, not a mandatory global weight. It also
means departure selection must balance clearer skies against warmth along the ride;
the observed preference for earlier departures is not a universal morning bonus.

A single authenticated Global Spot hourly field inspection on 10 October returned
`significantWeatherCode` but **no numeric cloud-cover field**. Its local, ignored
diagnostic is `evaluation/2026-10-10-cloud-fields-live-check.json`; no raw forecast or
credential is stored there. A weather symbol can support a separately labelled
categorical sky assessment, but it cannot supply an invented cloud percentage.

The official [BPF v2 parameter mapping](https://datahub.metoffice.gov.uk/downloads/bpf-v2-parameter-name-changes)
lists `cloudAreaFraction`, separately from `lowTypeCloudAreaFraction`, and
`probabilityOfCloudAreaFractionAboveThreshold`. It also lists
`durationOfSunshineSumPt24h`, whose whole-day accumulation must not stand in for
hourly cloud conditions along a ride. The [Met Office median guidance](https://datahub.metoffice.gov.uk/mo-bpf-deterministic)
suggests the 50th percentile for a representative site forecast. Preserve its
percentile descriptor in the generic contract and make this statistic selection
explicit in the evaluator; do not relabel it as a deterministic source forecast
or interpret a cloud fraction as a probability of sunshine.

The BPF v2 key was supplied and verified on 10 October. The UK collections' live
metadata and representative responses confirmed the units, dimensions and periods
listed below. The original Global Spot key is separate and remains configured.

The cloud-aware calibration retains source identity for the whole comparison, exposes
hourly cloud and wind evidence, and leaves cloud unknown if required data is unavailable.
Compare equivalent locations, validity times, model runs and statistics when checking
the consumer website. In particular, sustained/mean wind and maximum gusts are distinct:
the original review highlighted peak gusts while Dan quoted average winds in mph.
Display both with clear labels and consistent units before diagnosing a disagreement.

### Clarification: visible sunshine is the actual priority

Dan subsequently chose **visible sunshine**, even through thin high cloud, over
minimizing total cloud. The cloud-only experiment is therefore superseded for his
profile. At a London diagnostic site BPF returned hourly `weatherCodePt01h = 3`
(partly cloudy / sunny intervals) alongside high total cloud. This demonstrates why
`1 − cloudAreaFraction` must not stand in for visible sunshine.

Both adapters now support a provider-neutral categorical sky descriptor. BPF reads
`weatherCodePt01h`, validates its one-hour bounds and retains a categorical summary
rather than treating the axis label `50` as a numerical percentile. Global Spot
reads `significantWeatherCode` (unit `1`) at nominal hourly validity. The
[official code definitions](https://datahub.metoffice.gov.uk/definition-of-codes)
identify sunny and partly-cloudy day separately from cloudy and overcast; the
[forecast symbol guide](https://weather.metoffice.gov.uk/guides/what-does-this-forecast-mean)
labels the partly-cloudy day symbol as sunny intervals. Night symbols remain
separate, and unknown codes remain unavailable.

The engine assigns explicit, provisional comfort values to these categories. It
never turns a symbol into a cloud fraction or sunshine probability. Daily
`durationOfSunshineSumPt24h` remains unsuitable for timing sunshine along an hourly
ride. Neither live UK collection advertised an hourly sunshine-duration or direct
solar-radiation field in the inspected metadata. Weather symbols are therefore a
coarser but relevant current proxy, not a measurement of visible sunlight.

### Verified integration

The local ignored report (`evaluation/met-office-live-check.json`) records 18 sample
points: the start, nearest vertex to half the route distance, and end of each of
the six supplied routes. The adapter made 17 requests after deduplicating the
London Loop's identical endpoints. An earlier single request verified access.
All 18 samples supplied eight required series without missing values for
10 October, 08:00–18:00 UTC. This is a diagnostic window, not an agreed definition
of daytime. Forecast-location distances ranged from 129 to 3,391 metres.

The probe allowed a 10 km location displacement and six-hour model age. These are
explicit diagnostic settings, not adopted product or rider defaults. This verifies
sample retrieval and normalisation, not complete route coverage, forecast accuracy
or recommendation quality. Its recorded local latency is not a Workers benchmark.

## Available Met Office APIs

The current service is [Weather DataHub](https://www.metoffice.gov.uk/services/data/met-office-weather-datahub).
DataPoint [retired on 1 December 2025](https://www.metoffice.gov.uk/services/data/datapoint/datapoint-retirement-faqs).

| Product | Relevant forecast coverage | Free allowance | First paid tier |
|---|---|---:|---:|
| Global Spot | Hourly to 48 hours; three-hourly to seven days | 360 calls/day | £9/month for 900 calls/day |
| Blended Probabilistic Forecast v2 | UK hourly to about five days, then three-hourly to about eight days; availability varies by parameter | 55 calls/day | £9/month for 550 calls/day |

Global Spot provides a deterministic forecast in GeoJSON. BPF provides probability
and percentile data in CovJSON. Both resolve coordinate queries to supported
forecast locations. Preserve the actual location rather than imply precision at
every GPX point. See the [product overview](https://datahub.metoffice.gov.uk/docs/f/category/site-specific/overview).
Prices exclude VAT; quotas are subscription limits, not a per-rider allowance.
See [current pricing](https://datahub.metoffice.gov.uk/pricing/site-specific).

The new adapter uses v2: BPF v1 retires on **11 November 2026**, and v2 requires its own
subscription key. See the [migration notice](https://datahub.metoffice.gov.uk/support/changes-and-updates).

### Implemented BPF v2 mapping

The [v2 API guide](https://datahub.metoffice.gov.uk/docs/f/category/site-specific/type/probabilistic-forecast-feature/api-user-guide)
documents this base URL:

```text
https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0
```

Discover collections, forecast instances and locations. A position request uses
`POINT(longitude latitude)`. Filter the requested parameters and time range to
reduce payload size. Read each coverage's declared units, axes, shape and time
bounds; do not hardcode one array layout or assume every variable is hourly.
The documented air-temperature example uses Kelvin, requiring conversion to °C.
Representative UK responses were checked before implementing these mappings.

Authentication uses the `apikey` header after registration and product
subscription. Use a Worker secret when deploying. The [FAQ](https://datahub.metoffice.gov.uk/support/faqs)
documents authentication, quota errors and the attribution “Powered by Met Office
data”. Both supplied subscription keys have been verified, each against its own product.


The adapter uses `uk-spot-percentiles` and `uk-spot-probabilities`, instance
`blended`. The site catalogue is validated and cached for 24 hours; locations
resolving to the same nearest site share one pair of calls within a comparison.
The actual returned site must match the requested ID and remain within the 10 km
quality limit, also checked against each evaluated route section.

| Field | Meaning and conversion |
|---|---|
| `airTemperature1p5m` | p50 Kelvin → °C |
| `weatherCodePt01h` | hourly categorical weather symbol, native interval; not a percentile |
| `cloudAreaFraction` | p50 total cloud fraction, 0–1; not low cloud or sunshine probability |
| `windSpeed10m` | p50 m/s; reported separately from gusts |
| `windFromDirection10mMean` | degrees FROM; ensemble mean, verified from `realization: mean` metadata |
| `windSpeedOfGust10mMaximumPt01h` | p50 of the maximum gust over the previous hour, m/s |
| `lwePrecipitationRate` | p50 m/s → mm/hour by multiplying by 3,600,000 |
| `probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt01h` | fraction for precipitation amount > 0 metres over the previous hour; normalized threshold 0 mm |

CoverageJSON dimensions are decoded from `axisNames` and `shape`; array order is
not assumed. Parameter keys, units, selected statistics, coordinates and interval
bounds are checked. Missing medians or invalid fractions remain missing. Native
hour bounds are retained. The wind-direction axis happens to label its single
value `50`, but the metadata identifies an ensemble mean: it is not relabelled as
a percentile. Combining marginal summaries does not create a joint scenario.

**Model age is unknown.** The inspected `blended` instance and forecast responses
do not expose a model-run or publication timestamp. `dataVersion` and `issuedAt`
remain null, `forecastRunAt` absent, with an `unknown-model-run` issue. Requests
requiring model-run freshness are rejected before spending quota. An explicit
`retrieval-time` policy can accept these forecasts, but proves only how recently
we fetched them; it cannot verify a six-hour model-age limit. Cache identities
include this policy and a hit cannot upgrade retrieval freshness into model age.

The BPF probability event (> 0 mm in the previous hour) is explicit. It differs
from Global Spot's unspecified occurrence threshold and centred interval. Do not
attribute every change in score or precipitation risk to the algorithm when the
weather product or retrieval time has also changed.

A full six-route comparison at the existing spatial sampling resolves to 50 UK
sites: about 100 forecast calls plus catalogue discovery. The supplied free plan
allows 55 calls/day. This is a capacity constraint, not a reason to reduce spatial
coverage silently. Larger live comparisons need a sufficient allowance. API tests
use synthetic MSW responses and consume no live quota.

### Implemented Global Spot mapping

The adapter calls `/sitespecific/v0/point/hourly` on the official API host. The
[API definition](https://datahub.metoffice.gov.uk/downloads/api-definitions/weathercloud2api_subscriber.json),
live parameter metadata and [hourly glossary](https://datahub.metoffice.gov.uk/docs/glossary?models=mo-spot-1hr&sortOrder=ALPHABETICALLY)
establish these mappings:

| Data | Source field | Normalisation / time interpretation |
|---|---|---|
| Air / feels-like temperature | `screenTemperature`, `feelsLikeTemperature` | °C, at validity time |
| Wind speed / direction | `windSpeed10m`, `windDirectionFrom10m` | m/s and direction from; mean over previous ten minutes |
| Gust | `max10mWindGust` | m/s, maximum over previous hour |
| Precipitation amount | `totalPrecipAmount` | mm accumulated over previous hour |
| Precipitation rate | `precipitationRate` | mm/hour at validity time |
| Weather symbol | `significantWeatherCode` | dimensionless categorical symbol at nominal hourly validity |
| Precipitation probability | `probOfPrecipitation` | Percentage converted to fraction; hour centred on validity time |

Precipitation includes more than rain. The occurrence probability's numeric
threshold is unspecified in this mapping; it must not be treated as probability
above an invented rainfall threshold. Model-run time is retained as data version
and used for freshness checks; publication/issue time remains unknown.

`validAt` preserves the source label separately from a statistic's period bounds.
Intervals overlapping the requested range retain their full bounds; an evaluator
must not silently prorate probabilities or accumulated amounts at day boundaries.

The [published terms](https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/data/met-office-weatherdatahub-terms-and-conditions.pdf)
allow data use in applications subject to attribution and other conditions, and
restrict redistribution in original form and replication of the upstream API.
Keep our weather interface internal and expose route assessments to our clients.
Retain attribution in the response metadata; check the applicable subscription
terms when finalising any public forecast display or data export.

See [multi-day planning](planning-api.md) for v0.10.0 horizon reuse, actual coverage
and the distinction between advertised capability and available evidence.

## Internal contracts

The types are in [`worker/src/weather/contracts.ts`](../worker/src/weather/contracts.ts).
Runtime request validation, adapter response validation and source selection
are now implemented beside them. Only the required envelope, units and selected
values are checked; unrelated new upstream fields are tolerated.

```text
Route samples + target day + resolved rider preferences
  → source policy and capability selection
  → ForecastProvider adapter + shared forecast cache
  → normalised forecast snapshot
  → deterministic recommendation evaluator
  → ranking, standards assessment, hourly variation and explanations
```

| Boundary | Responsibility |
|---|---|
| `WeatherSourcePolicy` | Strict source or explicitly allowed ordered fallback; independent of comfort weights |
| `ForecastProvider` | Capabilities and forecasts for requested locations and time range |
| `LocationForecastResult` | Complete, partial or unavailable data with source, location and issue details |
| `ClimateNormalsProvider` | Historical monthly baselines, separately sourced and versioned |

Factories return plain objects of functions; adapters implement the same shape.
The evaluator never imports a Met Office SDK, understands CovJSON or selects a
provider. Adding another adapter and registering it should leave the evaluator
unchanged when the new provider supplies the required capabilities.

Contract invariants for adapters and the service layer:

- Normalise temperature to °C, wind to m/s, direction to meteorological degrees
  **from** true north, rainfall amounts to mm and rates to mm/hour.
- Preserve deterministic values, percentiles and probabilities as different
  statistics. Retain a probability's event definition, threshold and time period.
  Rain and all precipitation are distinct quantities.
- Use UTC instants and explicit interval bounds. Resolve the requested local day
  and daytime policy before retrieval. Do not turn three-hourly forecasts into
  purported hourly evidence or daily maxima into all-day comfort.
- Return requested and resolved coordinates, their distance and the resolution
  method. Reject or flag excessive displacement under a declared coverage policy.
- Preserve source/product, adapter version, run or dataset version when available,
  issue/retrieval times and attribution. An unknown issue time stays unknown.
- Return a result for every requested location, including failures. Null or
  missing data never means dry, calm or comfortable. `complete` requires all
  requested evidence at the accepted temporal and spatial resolution.

Capabilities can differ by product, region, variable, forecast run and horizon.
Bind a provider instance to its configured regional collection/product, then
check location coverage on retrieval. A capability declaration is not proof that
every requested location has data. Less capable providers yield explicit gaps;
swapping adapters cannot create information they do not supply.

The evaluation layer chooses its supported statistics explicitly. A median is
not automatically the same as a deterministic forecast. Marginal percentiles do
not constitute a joint weather scenario, wind angles require circular handling,
and hourly rain probabilities cannot simply be added into a whole-ride risk.

## Source preferences and failures

Dan's cloud-aware profile uses `{ mode: 'strict', providerId: 'met-office-bpf' }`;
the new-user default is `apple-weather`; existing stored Met Office policies are
not rewritten. If a selected
source is unavailable, report unavailable evidence. Do not silently substitute
another provider. In particular, a forecast failure must not produce a claim that
all routes fail the rider's minimum standards.

For other riders, an ordered fallback is opt-in. Try only listed providers and
record the source actually used plus why fallback occurred. As the initial
policy, choose one provider for the comparison rather than filling individual
missing fields from different sources. Do not pick whichever provider predicts
the nicest weather. Product selection within one provider also has to satisfy
the declared evidence requirements and remain visible in provenance.

## Performance and quota design

Precompute route geometry on upload. Select useful weather samples and deduplicate
shared forecast locations across routes; the supplied GPX collection has 4,546
points, which must not become 4,546 upstream requests per recommendation.

The internal interface accepts multiple locations, but this does not promise an
upstream batch API. Adapters use bounded concurrency, cancellation, timeouts and
quota-aware retry behaviour. Avoid retry storms when a daily quota is exhausted.

The adapter deduplicates identical coordinates within a request. A KV-compatible
wrapper now caches normalized evidence for 20 minutes. Keys include source identity,
coordinates, descriptors, provider-horizon range and quality limits; cached values retain the model
run and resolved location. Both retrieval age and model age are checked on reuse.
Changing preferences or speed can rescore the same day snapshot. Nearby-site reuse
and cross-request coalescing remain future work. Cache writes are awaited so a
successful local repeated request can reuse them; KV propagation across regions
still follows Cloudflare's consistency behaviour.

## Historical temperature context

The Met Office publishes [location-specific long-term averages](https://www.metoffice.gov.uk/research/climate/maps-and-data/location-specific-long-term-averages),
including 1991–2020 station averages. A historical monthly average high is a
different dataset from a forecast. No suitable Weather DataHub endpoint for that
reference has been confirmed in this research.

Use `ClimateNormalsProvider` if climate-relative preferences are selected. Record
reference period, monthly statistic, location mapping and dataset version. Access
and ingestion still need selection; do not use a seven-day forecast as a climate
normal or silently change a rider's policy when the reference is missing.

## Implemented recommendation slice and remaining work

`POST /recommendations` now models progress at the request speed (default 20 km/h),
searches daylight departures, and evaluates six normalized measures along each
ride. Temperature/rate and short wind means use nearest hourly validity within
30 minutes; gust maxima and occurrence probabilities use their native periods.
The API returns assumptions, provenance and explicit missing coverage.

The local ignored API report (`evaluation/api-live-check.json`) covers six uploaded GPX
files and 55 weather locations in the real local Workers runtime. All 86 candidate
departures had complete usable evidence for 10 October 2026. The original cold
baseline was 605 ms; the optimized warm median was 29 ms over ten repeats, with
zero upstream misses. These are local measurements. Remote deployment and workload
validation on the selected Workers tier remain outstanding.

The live runtime check caught Workers rejecting `redirect: "error"`; the adapter
now uses `manual` and treats redirect responses as failures. It never follows
an upstream redirect with the API key. This behaviour is covered by transport tests.

Tests use synthetic fixtures for interval semantics, units, missing/invalid values,
freshness, spatial limits, transport limits and source policies, plus GPX parsing,
owner-scoped HTTP access, caching, daylight, arrival timing, route-relative wind,
personal standards and unknown outcomes. A second synthetic provider exercises
substitution without changes to the evaluator.

Next work includes comparative forecast calibration and climate-normal ingestion.
Global Spot hourly still reports
missing coverage beyond its horizon; no lower-resolution feed is substituted.

For an explicit live diagnostic, supply a JSON `ForecastRequest` and run from
`worker/` (this consumes API quota):

```sh
bun --env-file=.dev.vars scripts/probe-weather.ts request.json report.json
```

The script writes diagnostic metadata, not raw forecast values, and is separate
from `bun run check` and CI. The key stays in `.dev.vars`, which is gitignored and
has owner-only permissions. The committed example contains a placeholder only.
