# Taiwan weather — API 0.43.0

Taiwan rides can use the complete scoring contract through **CWA + Apple Weather**
(`taiwan-weather`, product `cwa-township-apple-hourly`). CWA is preferred for the
fields it supplies; Apple provides hourly gusts, rainfall and missing coverage.
This is an explicitly identified composite, not a claim that CWA supplies hourly
gusts or rainfall. The underlying strict `cwa` adapter remains available internally
and still rejects unsupported fields or invented hourly resolution.

## Selection and coverage

New profiles and requests without saved settings default to **Automatic**
(`weatherProviderId: "automatic"`). A comparison uses the Taiwan product when all
route weather samples and leg midpoints are inside Taiwan land boundaries;
otherwise it uses Apple. The rule includes Penghu, Kinmen, Matsu, Green Island and
Orchid Island, and does not classify nearby mainland locations by station distance
or by the rider's time zone. Coastal boundary uncertainty conservatively keeps the
global provider. A mixed-country comparison uses one global product throughout.

Existing saved Apple or Met Office selections are preserved. Select Automatic to
activate geographic selection, or explicitly select `taiwan-weather` to request
the composite. The latter reports outside coverage for foreign locations. Both
recommendation endpoints, tracked-ride refreshes and the persistent forecast cache
use the same policy. [Provider-choice contract](weather-provider-choices.md).

The advertised composite horizon is up to 240 hours through Apple. CWA's township
product normally contributes the first three days. Actual available periods,
distance and freshness still determine whether a ride can be assessed. No source
is extrapolated to fill a missing horizon. Mountain routes beyond the 10 km
representative-point limit use Apple where valid; an unavailable supplement leaves
the affected ride unassessable. No missing value becomes zero, dry or calm weather.

## Field mapping and scoring

| Field | Preferred source | Handling |
| --- | --- | --- |
| Air/apparent temperature | CWA township | Celsius; bounded linear interpolation of adjacent instants at most three hours apart |
| Sustained wind | CWA township | m/s; bounded linear interpolation; direction interpolates on the shortest compass arc |
| Wind direction | CWA township | Meteorological direction **from**; wind speed and direction fall back together; opposite directions are ambiguous and use Apple |
| Rain probability | CWA township | Probability of at least 0.1 mm over the native three-hour period; percent divided by 100, never divided by three |
| Maximum gust | Apple hourly | Native hourly maximum, converted from km/h to m/s |
| Rain amount/rate | Apple hourly | Native liquid-equivalent hourly amount in mm and its hourly average in mm/h |
| Cloud and sky condition | Apple hourly | Existing numeric cloud and categorical sunshine contracts |
| Missing CWA fields/periods | Apple hourly | Original Apple probability event and periods remain identified in field evidence |

Hourly resampling is confined to the composite adapter. The raw CWA adapter retains
its native times. Neither six-hour rainfall totals nor observed station rainfall
are substituted for an hourly future forecast. The composite precipitation
probability descriptor explicitly identifies the two native event definitions.
The scorer applies each probability through its event interval, including all
three hours of a CWA event. The highest encountered local probability is not a
whole-ride precipitation probability. Existing comfort weights remain unchanged.

Each series carries `evidence`: source/product/adapter identity, retrieval and
expiry time, actual representative location, original descriptor, native interval,
method (`native`, `linear-interpolation`, `circular-interpolation`) and used periods.
Responses expose this as `weather.locations[].fieldEvidence` and in each candidate's
`forecastDetails.locations[].fieldEvidence`. Composite coordinates do not bypass
checks of component distance from the route. Cache reads retain evidence and rebind
only the requested route-point ID. CWA and Apple have no verified model-run time;
retrieval-time freshness is explicit, and the earliest used expiry governs reuse.
Attribution includes the sources actually used. CWA failures can result in entirely
Apple-backed evidence; the product name remains CWA + Apple Weather. An Apple quota
failure is not retried by the whole-product quota fallback.

## CWA product research

Research and authenticated payload inspection: 5 November 2026. Sources are CWA's
[368-township specification](https://www.cwa.gov.tw/Data/data_catalog/1-1-1.pdf),
[current API definition](https://opendata.cwa.gov.tw/apidoc/v1),
[forecast schema](https://opendata.cwa.gov.tw/opendatadoc/Forecast/F-D0047-001_093.pdf)
and [data standard](https://opendata.cwa.gov.tw/opendatadoc/insrtuction/CWA_Data_Standard.pdf).

- Three-day county datasets `F-D0047-001`, `005`, …, `085` cover 368 township
  representative points. Taipei is `061`, Hualien `041`. Temperatures begin hourly
  and become three-hourly; sustained wind, direction and rain probability are
  three-hourly. An unfiltered authenticated Taipei response contained no gust or
  quantitative rainfall field. National `089`/`091` products use county-level
  representatives and cannot improve route resolution. Weekly rain probability
  is limited to the first three days, per the [FAQ](https://opendata.cwa.gov.tw/faq).
- **WRF 3 km (`M-A0064-000`…`084`)** distributes model GRIB2 through the file API.
  The [model specification](https://opendata.cwa.gov.tw/opendatadoc/Model/M-A0061.pdf)
  describes six-hour output intervals to 84 hours. Inspection of a live six-hour
  file found 78 messages, including accumulated rainfall, but no gust message.
  Its approximately 182 MB file and accumulated rainfall require a separate
  ingestion design; six-hour totals cannot establish hourly rain intensity.
- **QPESUMS (`F-B0046-001`)** supplies a quantitative next-hour rainfall forecast,
  updated every ten minutes. Its live 441 × 561 grid uses TWD67 coordinates and
  sliding forecast periods. It is useful for a future near-term nowcast layer,
  but not tomorrow's whole ride. [CWA specification](https://www.cwa.gov.tw/Data/data_catalog/3-6-9.pdf).
- **Typhoon wind (`F-C0034-005`)** includes gust Beaufort ranges in a forecast
  WindTable XML, but is published for land typhoon warnings, not routine daily
  coverage. [CWA specification](https://opendata.cwa.gov.tw/opendatadoc/Forecast/F-C0034-005.pdf).
  Typhoon rainfall `F-C0041-001`…`008` likewise supplies six-hour periods during
  warnings. [Dataset](https://opendata.cwa.gov.tw/dataset/forecast/F-C0041-002).
- **Station feeds (`O-A0001`, `O-A0003`)** provide observed gust/rain information,
  not future gusts for planned departures. CWA reports also describe AI gust
  research; no documented, routine public API was established during this review.

The model, nowcast and typhoon products above are researched alternatives, **not
implemented sources** in this release. The full routine scoring contract is
provided by the declared CWA/Apple combination.

## Location data and transport

`api/src/weather/cwa-locations.json` contains the 368 representative points from
CWA's public county XML examples, retrieved 5 November 2026. Sources range from
[Yilan](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-001) to
[Kinmen](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-085). The adapter batches
unique township names per county, checks returned dataset/geocode/coordinates,
retains native timing and rejects duplicates, sentinels and bounded wind strings
such as `>= 11` as exact measurements.

`api/src/weather/taiwan-boundaries.json` contains 589 polygons covering 22 counties
from Hualien County's public MOI county-boundary map layers:
[179 (Hualien)](https://map.hl.gov.tw/arcgis/rest/services/HuBaseMap/MapServer/179),
[180 (other counties)](https://map.hl.gov.tw/arcgis/rest/services/HuBaseMap/MapServer/180).
Retrieved 5 November 2026 UTC. Query each layer's `/query` endpoint using
`where=1=1`, `outFields=COUNTYNAME`, `outSR=4326`, `geometryPrecision=5`,
`maxAllowableOffset=0.0005`, `f=geojson`. Flatten each MultiPolygon into polygons,
retain all rings, and store each polygon's `[minLon,minLat,maxLon,maxLat]` bounds.
The containment check uses an even-odd rule so holes remain holes. No claim is made
about the source boundary vintage. The [MOI dataset catalogue](https://data.gov.tw/en/datasets/7442)
lists the Open Government Data License. On refresh, verify all 22 counties,
outlying-island tests and nearby mainland exclusions before replacing the bundle.

CWA transport uses HTTPS with the key in an `Authorization` header, bounded
responses, cancellation and timeouts. Redirects are not followed with credentials.
Errors are sanitised and 429 preserves backoff. Store `CWA_API_KEY` and
`APPLE_WEATHER_CONFIG_JSON` in ignored local `.dev.vars` and deployed Worker
secrets. CWA is now included in Wrangler's required-secret list and generated
bindings. Never commit credentials or print them in diagnostics.

The [setup guide](https://opendata.cwa.gov.tw/devManual/description) describes the
account and API authorisation code. The [FAQ](https://opendata.cwa.gov.tw/faq) lists
ordinary membership at 20,000 calls and 2 GB per day; downloads and datastore
allowances are separate. [Platform terms](https://opendata.cwa.gov.tw/about/rules)
permit derivative applications with source attribution under Taiwan's Open
Government Data License. Both CWA's notice and Apple's branding/notice survive
normalisation and caching.

## Verification

Controlled forecasts through the real local Worker, D1, KV and both adapters use
two synthetic Taipei river corridors (test geometry, not surveyed cycling tracks):

| Route | Distance | CWA representatives |
| --- | --- | --- |
| Northwest corridor | 9.30 km | Datong (1.34 km), Beitou (3.53 km) |
| East corridor | 7.96 km | Zhongshan (1.90 km), Nangang (2.07 km) |

Both routes score 100 in calm, dry 22°C conditions and 58 with 80% CWA rain
probability plus 2 mm/h Apple rain. Reversing east/west wind reverses the preferred
route; a 35 km/h gust limit rejects 38 km/h gusts on both routes. Three-hour rain
events apply through their full duration. Tests cover interpolation through north,
ambiguous directions, missing gusts, stale evidence, outlying islands, foreign
routes, saved choices, both recommendation endpoints and cache restart.

The live probe at **2026-11-05 23:58 UTC**, for **7 November in Taipei**, assessed
all 15 departures on each route with zero unknown departures. Northwest scored
88.50 with a 06:30 local departure; east scored 84.71 at 09:00. Both had real CWA
and Apple evidence. Four Apple requests and one CWA county request supplied the
comparison; restarting the Worker reused all forecasts and retained rankings.
These are timestamped integration checks, not independent forecast-accuracy claims.

```sh
cd api
node --env-file=.dev.vars scripts/probe-taipei.ts
```

The probe consumes provider quota and writes only local test storage. Its live
proxy forwards only provider authentication and Accept headers; forwarding all
local runtime transport headers caused Apple to reject the probe. The probe
prints sanitised diagnostics and fails on unassessable routes, unknown departures
or failed cache reuse. `scripts/probe-cwa.ts` separately checks the strict CWA feed.
