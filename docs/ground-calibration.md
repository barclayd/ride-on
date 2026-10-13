# Ground-condition calibration

Status: model mechanics and an offline historical comparison tool implemented;
real-world validation and score calibration remain pending.

## Collect evidence before tuning

Use voluntary observations of `firm`, `soft`, `muddy` and `difficult`. A ride may
have several labels on different stretches. Do not label the entire route muddy
because a few sections were muddy, or infer section labels from total rainfall.

For each case, retain locally:

- GPX identity/hash, ride date and timestamps, observed section intervals or
  landmarks where remembered, and confidence in the recollection.
- Surface evidence tied to the same geometry. GPX positions alone do not establish
  materials. Keep unknown material unknown; do not label every off-road metre gravel.
- Weather source, product, units, accumulation boundaries, retrieval/model issuance
  times, full coverage and whether values are observed, modelled history or forecasts.
- Model version and parameters, predictions before tuning, speed/timing assumptions,
  observations and whether the case belongs to development or held-out validation.

Personal tracks, snapshots and feedback belong under the gitignored
`evaluation/ground-calibration/`, never in public fixtures. Tests use synthetic
routes and weather. Do not record authentication tokens or upstream credentials.

## First supplied example

On 13 October 2026, Dan described a Shipwrights Way ride on 7 June with some firm
sections and some soft/muddy sections. The supplied GPX is titled **South Downs
Spectacular**; its timestamps confirm **7 June 2026**, and its track is about
171 km. It has timestamps but no surface fields.

Record the observation as **mixed conditions**; later tentative landmark feedback
is retained with the private case record, not promoted to exact section labels. Do not
assume all 171 km are Shipwrights Way or assign mud to invented landmarks. The
original file remains local and unchanged. This is a development example, not
independent validation once it has influenced parameters.

Next work for this example:

1. Locate the relevant off-road stretches using verified surface evidence tied to
   the supplied geometry; ask for remembered muddy stretches if available.
2. Obtain suitable historical rainfall/drying evidence for the preceding 28 days,
   keeping it separate from current forecast cache and with explicit provenance.
   The phase 2 rolling endpoint cannot provide June history in October.
3. Use retrospectively reconstructed weather only to test the ground mechanism.
   Label that exercise **hindcast**; do not claim it reproduces the forecast that
   was available before the ride. Forecast validation requires archived predictions
   and evidence available at the original issue time.
4. Compare section estimates to the mixed observation, without forcing an exact
   numerical match to this single ride. A firm-only result over verified soft/muddy
   sections would identify a deficiency; absent section labels limit that conclusion.

## Offline historical comparison

The local tool accepts a timestamped GPX (one track/segment, up to 20 MB), preserves
actual passage times and samples 2–12 positions in a chosen distance interval.
This does not change the API's 5 MB upload limit or enable historical API requests.

```sh
cd worker
bun scripts/calibrate-ground.ts \
  --gpx /path/to/recorded-ride.gpx \
  --out ../evaluation/ground-calibration/example \
  --from-km 65 --to-km 95 --samples 8 --live
```

`--live` explicitly permits cache misses to call the public Open-Meteo
[Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api).
Omit it to replay local snapshots without network access. A missing or invalid
snapshot fails explicitly; no silent source substitution or automatic refresh.
The prototype remains non-commercial under the previously agreed provider terms.

The source is fixed to `ukmo_seamless` and the same five validated variables and
units used by the live evidence adapter. Retrieve 28 background days plus the
ride dates, at most 12 unique 0.05° request cells. Nearby samples share a cell.
Requests are sequential, time/size bounded and cached separately from D1. The
provider's native coordinates, original retrieval date and exact query are saved.
Requests spanning more than 14 days have a larger estimated billing weight.

This archive stitches model runs; it is neither a rain-gauge observation nor the
forecast known at the original ride start. The result is explicitly `hindcast`
with `historicalForecastValidation: false`. The live model retains its rule that
evidence must have been retrieved by the assessment issue time. The offline entry
point keeps the genuine later retrieval date, runs the same provisional model,
and excludes weather after each sample's completed-hour cutoff. Missing weather
and freeze/thaw uncertainties still suppress estimates.

Outputs are `hindcast.json`, `hindcast.md` and private raw archive snapshots. The
report retains unknown materials and displays conditional gravel/compacted versus
earth/grass sensitivity. Sparse samples do not establish affected route kilometres
or a percentage. They do not identify the actual surface or calibrate thresholds.
Use verified, geometry-bound surface intervals and located feedback before making
section-level accuracy claims. Current cycle.travel surface summaries can change
when directions are refreshed, so record when and how they were obtained and
never transfer a whole-route percentage onto a different recorded geometry.

The first private run sampled eight positions in seven weather cells, then replayed
the same snapshots offline. Its provisional predictions were retained before
tuning. Parameters and production scores remain unchanged; a second ride and
held-out wet/dry examples are still needed.

## Build a small, varied evaluation set

Seek wet/dry pairs on familiar routes, different materials, stronger/weaker drying,
summer/winter conditions and forecast lead times. Hold out entire routes and dates
before adjusting thresholds; nearby overlapping tracks share weather and are not
independent samples. One mixed ride does not establish seasonal performance.

Use a section-level class confusion table, distance-weighted error, the rate of
false-firm estimates on observed muddy/difficult sections, and coverage/unknown
rates. Inspect the longest difficult stretch as well as route totals. Compare with
simple recent-rain baselines; complexity should earn its place through better
held-out results. Group results by material and season, without manufacturing a
seasonal preference change. Require extra winter validation of freeze/thaw/snow.

Record every parameter change with its model version and rerun untouched held-out
cases. Do not count synthetic scenarios or retrospectively fitted cases as real
forecast accuracy. Agree acceptable errors and sample sufficiency with Dan before
phase 4 rather than presenting an arbitrary target as an established standard.

## Scoring gate

- Complete the signed-in surface compatibility spot-check from phase 1.
- Validate rainfall coverage and accumulation timing across multiple locations.
- Compare the model with located observations and held-out wet/dry examples.
- Agree ground penalties and incomplete-evidence behaviour using those examples.
- Keep a weather-only fallback and explicit unknown coverage in both browsers.

No score penalty, hard exclusion or automatic UI rollout is enabled by phase 3.
