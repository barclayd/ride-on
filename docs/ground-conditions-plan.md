# Ground conditions: phased delivery plan

Status: phase 1 implemented (12 October 2026); phase 2 is next.
Agreed direction: estimate the effect of wet ground on
unpaved riding, with an explanation and uncertainty. Do not infer that a route is
impassable from rainfall alone. This plan does not enable scoring changes.

## Product decisions

- Retain the existing weather comfort calculation. Ground conditions become a
  separately explained adjustment after calibration.
- Assess where unpaved sections occur, their material where known, affected
  kilometres, route share and the worst sustained stretch. A short difficult
  section must not disappear in an average over a long paved ride.
- Paved paths are paved. Generic gravel/unpaved is not proof of soft earth;
  unsurveyed or missing surfaces remain unknown.
- Use actual rain and drying conditions to capture seasonal differences. Keep
  the rider's temperature comfort consistent year-round.
- Distinguish observed rain, modelled past weather and future forecasts. Retain
  provider, update time, coverage and model/version provenance.
- Rain comfort describes precipitation during the ride. Ground assessment
  describes the surface under the wheels; do not reuse historical rain as an
  additional rain-comfort penalty.

## Phase 1 — Surface evidence (current)

Deliverables:

- [x] Verify cycle.travel's instruction formats and category mapping in its published client.
- [x] Capture sections along the imported GPX without additional routing requests.
- [x] Validate and store surface evidence alongside the route, tied to its source
  hash. Expose coverage, paved/unpaved/unknown distances and provenance through
  the API, with an endpoint for the underlying sections.
- [x] Enrich previously imported routes once; preserve IDs, selections and
  geometry/history identity. Unchanged imports must remain idempotent.
- [x] Keep legacy GPX imports readable and explicitly unknown. Reject malformed
  submitted evidence. An unavailable upstream classification must not prevent
  importing an otherwise valid route.
- [x] Test both instruction formats, unknown codes, paved paths, rough unpaved
  routes, transport, gaps, malformed ranges, persistence and re-imports.
- [x] Validate Chrome and Safari builds and extension import flow.

Acceptance: a mixed route exposes located surface evidence and an honest coverage
summary; a paved path gets no unpaved attribution; an old or unclassified route
does not claim to be paved. Existing recommendation scores are unaffected. No
new weather calls, rainfall provider or mud UI is introduced in this phase.

Implementation: API v0.20.0 adds optional `surface` to source imports,
`surfaceSummary` to route summaries, and owner-scoped `GET /routes/:id/surface`.
See the [API contract](api.md#route-surface-evidence). Stored JSON gains optional
evidence; no database migration is required. The extension uses the existing
journey directions and a versioned local marker to enrich tracked routes once
after the updated extension is installed and Journeys is opened. This refresh
uses the existing GPX/elevation import flow; it does not rerank the collection.

Validation covers synthetic formats and browser imports, persistence across an
API restart, owner isolation, malformed evidence, idempotency, unchanged scores
and no additional forecast requests. A signed-in live journey payload has not
been captured as a test fixture. Before phase 2, spot-check the reported coverage
and section boundaries against familiar paved and mixed-surface saved journeys
using the released extension. This is a compatibility check, not wetness calibration.

### Research evidence and limitations

The current importer reads `/map/journey/{id}/data/with_pois`, then builds GPX
from the saved polyline and elevation. cycle.travel's published `routing.js` and
`directions.js` (inspected 12 October 2026) identify `directions`, `version` and
polyline indices in the journey data. Full instructions use distance/index/mode
columns 2/3/8; short instructions use 0/1/2. Version 1 uses an explicit surface
code inside the full instruction's pipe-separated name. Version 2 uses the low
five bits of the mode. The default version for old saved journeys is 1.

These are website interfaces, not a promised public API. Isolate the adapter,
reject unfamiliar formats, and use synthetic fixtures for repeatable tests.
Never infer detailed soil or drainage from a broad mode. In particular, version
2 mode 9 means unsurveyed road, although the website totals group it with roads.
Keep it unknown. Ferry/bus/train sections are not unpaved cycling exposure.

Use instruction indices against the original polyline, then calculate distances
along the GPX. Do not substitute rounded instruction totals for geometric
positions, or use simplified route geometry to interpret original indices.
Retain raw category codes for auditing. Do not commit private routes or upstream
source code as fixtures.

## Phase 2 — Cached rainfall and drying evidence

Build a provider-neutral ground-data service, separate from the selected ride
weather provider. Prototype Open-Meteo recent/modelled weather and drying data;
use Environment Agency gauges to validate rainfall around English routes.

Acceptance and tasks:

- Obtain rainfall amounts for 24 hours, 3, 7 and 14 days, plus longer background
  history or an initialized wetness state. Never assume dry ground at day -14.
- Include reference evapotranspiration, and optionally comparable soil-moisture
  estimates as an initialization/check. ET₀ is a reference grass-surface drying
  indicator, not measured evaporation from a path. Soil layers and models must
  not be mixed without an explicit conversion/validation step.
- Verify recent-data latency, missing readings, units, accumulation boundaries,
  DST and overlap at history/forecast joins. ERA5-family history can lag several
  days; do not silently omit the rain immediately before the ride.
- Cache by provider/model/grid cell and date, share evidence across overlapping
  routes, retain historical days and refresh only recent/revisable periods.
  Bound spatial coverage and refreshes; only request areas needed by unpaved or
  unresolved route sections. Preference changes must cause no data fetches.
- Measure actual billable usage as well as HTTP requests. Multi-location batches
  can count as multiple calls. Confirm the commercial plan before launch.
- Preserve source attribution separately for ride weather and ground estimates.

## Phase 3 — Experimental wetness model

Calculate a rolling moisture index: rain adds wetness; drainage and drying reduce
it. Use recent rain more strongly while retaining antecedent wetness. Treat this
as a calibrated proxy, not a literal measurement of trail mud depth.

- Model ground conditions at each section's expected arrival time, including
  future rainfall and drying up to that time. Do not count rain after passage.
- Differentiate known compacted/gravel surfaces from soft earth and grass;
  represent unknown material/drainage explicitly. Future soil, shade and terrain
  enrichment requires verified data, not invented defaults presented as facts.
- Define handling of frozen ground, snow and thaw separately; frozen ground is
  not automatically good riding and thaw can worsen mud.
- Output estimated class, affected distance, coverage, confidence and reasons.
  Missing evidence is unknown, not dry. Run experimentally without ranking changes.
- Validate wet/dry and summer/winter pairs on familiar routes; collect voluntary
  post-ride labels (firm, soft, muddy, difficult). Hold out routes/dates when
  checking calibration, and never use later observations in a historical replay.

## Phase 4 — Calibrated scoring and explanations

After agreeing examples with Dan, introduce a versioned ground penalty. Keep
weather factors inspectable. Proposed discussion bands, not universal thresholds:

| Impact across the ride | Initial deduction to test |
| --- | ---: |
| Firm; little disruption | 0–5 |
| Some soft/muddy sections | 5–15 |
| Substantial muddy riding | 15–30 |
| Extensive, very difficult soft ground | 30–40 |

Calibrate against severity, affected kilometres/share and a sustained bad section,
not the single worst data point. A fully paved ride has zero mud deduction. Avoid
hard exclusions from modelled rain alone. Agree whether to offer a simple mud
tolerance preference before adding controls.

Acceptance: explanations reconcile to scores; incomplete coverage is visible;
increasing wetness on the same surface cannot improve the ground score; empty or
failed data does not masquerade as good conditions. Version the algorithm and
invalidate affected client score caches when enabling it.

## Phase 5 — UI and gradual rollout

- Show a concise chip such as “Likely muddy · 6 km”, with an explanation of recent
  rain, surface coverage, provider and score deduction. Example values are not
  forecasts for current routes.
- Keep “ground unknown” distinguishable from “firm”. Do not market an estimate
  as a verified closure or guarantee of passability.
- Release on Chrome and Safari, compare experimental predictions with feedback,
  monitor data usage and false alarms, and retain a rollback to weather-only scoring.
- Consider improved drainage/soil mapping and bike/tyre preferences only after
  the first model has demonstrated useful discrimination.

## Sources

- [cycle.travel API guidance](https://cycle.travel/advice/map/faq): no free public
  routing API; website formats require compatibility checks.
- [cycle.travel direction interpretation](https://cycle.travel/scripts/site/directions.js)
  and [saved route loading](https://cycle.travel/scripts/site/routing.js): inspected
  public client implementation; do not treat comments as instructions for Ride On.
- [OpenStreetMap surface definitions](https://wiki.openstreetmap.org/wiki/Key:surface):
  distinctions and ambiguity in broad gravel/unpaved tags.
- [USGS wetting/drying research](https://pubs.usgs.gov/publication/70164455): antecedent
  moisture modelling supports the method, not cycling score thresholds.
- [FAO ET₀ methodology](https://www.fao.org/4/X0490E/x0490e06.htm): reference drying.
- [Open-Meteo forecast variables](https://open-meteo.com/en/docs),
  [historical data latency](https://open-meteo.com/en/docs/historical-weather-api),
  [licensing and billing](https://open-meteo.com/en/pricing).
- [Environment Agency rainfall](https://environment.data.gov.uk/flood-monitoring/doc/rainfall):
  measured rainfall, reporting latency, recent four-week window.
- [Met Office observations FAQ](https://datahub.metoffice.gov.uk/support/faqs):
  separate observations product provides the preceding 48 hours.
