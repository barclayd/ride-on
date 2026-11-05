# Taiwan CWA weather

Research and public payload inspection: 5 November 2026.

The `cwa` adapter implements `ForecastProvider` for Taiwan's Central Weather
Administration township forecasts. It is registered internally, but is not a
public picker option or Taiwan's automatic default yet. The existing recommendation
engine requires hourly gusts and precipitation rates, neither of which this feed
supplies. Requests for those fields fail before spending CWA quota. Existing
provider selections and recommendation scoring remain unchanged.

## Product research

The [368-township specification](https://www.cwa.gov.tw/Data/data_catalog/1-1-1.pdf)
describes representative points at township offices, three-hour wind and rain
probabilities, shorter-range hourly temperatures, and coarser weekly forecasts.
Scheduled publication is four times daily. Mountain routes may be far from the
representative point or have materially different conditions.

Use the three-day county datasets `F-D0047-001`, `005`, …, `085`.
`F-D0047-061` covers Taipei; `041` covers Hualien. The national `089` and `091`
datasets use county-level representatives, so they are unsuitable substitutes for
township coverage. `093` is a cross-county query endpoint requiring dataset IDs,
with at most five datasets per request. These parameters and the title-case
`LocationName`/`ElementName` filters were checked against the
[current API definition](https://opendata.cwa.gov.tw/apidoc/v1).

The [weekly feed FAQ](https://opendata.cwa.gov.tw/faq) says rain probability is
limited to the first three days. The weekly product therefore cannot extend our
rain assessment to seven days. The coastal `F-D0047-095` product is also three-hourly
and does not replace land-route evidence. Observed rain/gust feeds describe past
conditions; typhoon-only quantitative precipitation products cannot supply routine
multi-day forecasts.

The checked public samples contain some forecast times beyond the nominal
three-day horizon. The adapter reports actual returned bounds and conservatively
advertises 72 hours; it never promises future availability from one sample.

## Contract mapping

| CWA field | Internal descriptor | Handling |
| --- | --- | --- |
| `Temperature` | deterministic air temperature, Celsius | Native `DataTime` |
| `ApparentTemperature` | deterministic feels-like temperature, Celsius | Native `DataTime` |
| `WindSpeed` | deterministic wind speed, m/s | Native `DataTime`; not gusts |
| `WindDirection` | meteorological direction from, degrees | Eight named compass directions; unknown directions remain null |
| `ProbabilityOfPrecipitation` | probability of precipitation amount >= 0.1 mm | Percent divided by 100; full three-hour event bounds retained |

The [CWA data standard](https://opendata.cwa.gov.tw/opendatadoc/insrtuction/CWA_Data_Standard.pdf)
defines the 0.1 mm precipitation event. This is a distinct descriptor from the
generic unspecified occurrence event and the Met Office > 0 mm event. Probabilities
are not divided by three, summed into whole-ride risk, or converted into rain rates.

Offset timestamps become UTC. No interpolation or fabricated hourly series is
introduced. Empty strings, sentinels, unknown directions and inequality wind values
such as `>= 11` remain unavailable; lower bounds are not exact speeds. Cloud cover,
gusts, precipitation amount/rate and weather-symbol inference are not advertised.
The datastore does not expose a model-run timestamp: data version and issue time
remain unknown, and callers must explicitly choose retrieval-time freshness.

The adapter checks the request, dataset identity, geocode, returned coordinates,
native timing, duplicate records, missing values and displacement. Requests for
hourly wind/rain retain `insufficient-resolution`; unsupported scoring fields
return `unsupported-variable`. No missing evidence becomes dry or calm weather.

## Location catalogue and requests

`api/src/weather/cwa-locations.json` contains the 368 representative points from
CWA's public XML examples, retrieved on the research date. Only identifiers,
names and coordinates are retained; forecast values are not checked in. Source:
the XML examples linked by each county's dataset page, starting with
[Yilan](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-001) and ending with
[Kinmen](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-085).

Resolve route samples to the nearest representative point within the caller's
distance limit. This is not administrative boundary containment. Batch selected
township names into one request per county, deduplicate repeated route points,
and retain a result for every requested ID. Verify the returned point again, so
catalogue coordinates cannot bypass the displacement check. Catalogue maintenance
must retain all 368 unique geocodes and be checked against CWA source metadata.

Transport uses the official HTTPS datastore API, an `Authorization` header, bounded
responses, cancellation and timeouts. Redirects are not followed with credentials.
HTTP errors are sanitised; 429 retains `Retry-After` and stops further county calls.
The normalised snapshots fit the existing cache schema. The recommendation cache
and evaluator still assume hourly coverage; this integration does not claim that
their coverage/scoring logic can consume three-hour evidence unchanged.

## Credentials, allowance and attribution

The [CWA setup guide](https://opendata.cwa.gov.tw/devManual/description) requires a
free account with a valid email address. After signing in, obtain the key under
Member Information → API Authorization Code. Header authentication is supported,
so keys need not appear in URLs.

The [FAQ](https://opendata.cwa.gov.tw/faq) lists the ordinary member allowance as
20,000 requests per 24 hours and 2 GB daily; advanced membership raises it to
300,000 and 20 GB. Download and datastore usage are counted separately. Reuse
forecasts and align refreshes with publication times rather than polling every
route point. Confirm actual usage after authenticated testing.

The [platform terms](https://opendata.cwa.gov.tw/about/rules) permit derivative
applications under Taiwan's Open Government Data License with source attribution.
The adapter retains the agency, dataset and licence notice in provenance. This
does not imply CWA endorsement.

For the explicit local probe, put `CWA_API_KEY` in the ignored `api/.dev.vars`, then:

```sh
cd api
bun --env-file=.dev.vars scripts/probe-cwa.ts
```

The probe prints sanitised diagnostics only. Do not paste the key into chat, command
arguments, source files or PRs. A deployed integration needs the `CWA_API_KEY`
Worker secret. It remains optional here so existing deployments do not require a
credential for an unavailable public choice. Wrangler's current `secrets.required`
list excludes optional keys from local `.dev.vars` loading; the direct Bun probe
loads the file explicitly. Add CWA to that list and regenerate bindings as part of
activation once the secret is configured, following the existing deployment workflow.

## Default activation decision

Automatically selecting this adapter under today's scoring contract would remove
Taiwan recommendations. A useful CWA default needs an explicit product decision:

* Support native three-hour evidence and a separately labelled assessment with
  unknown gust/rain-intensity checks, including scoring, cache, saved plans and
  client contracts; preserve user overrides
* Or define a composite provider with per-field provenance and an authorised
  supplemental source; the current one-source-per-comparison policy does not allow
  silently filling CWA gaps with Apple Weather

Regional selection must use route coordinates and handle mixed-country comparisons
and outlying islands; the user's time zone alone is insufficient. Key creation,
authenticated datastore validation and Taiwan default activation are outstanding.
Public preview inspection is not an authenticated API or Workers live check.
