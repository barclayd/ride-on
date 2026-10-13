# Experimental ground assessment — phase 3

Introduced in API v0.22.0. This explicit diagnostic estimates ground conditions
along a ride from the [phase 2 evidence cache](ground-evidence-api.md). It does
**not** change recommendation scores, rankings, preferences or extension cards.
The weather algorithm remains `comfort-v0.11`.

The model is `ground-experimental-v0.1`, with `calibrationStatus: uncalibrated`.
Its coefficients and class boundaries are engineering hypotheses to test, not
validated trail measurements. Do not enable a score deduction from this release.

## Request and limits

Authenticated `POST /ground-assessment`:

```json
{
  "routeIds": ["11111111-1111-4111-8111-111111111111"],
  "departureAt": "2026-10-14T09:00:00Z",
  "averageSpeedKph": 20
}
```

- Supply 1–12 distinct owned routes and a UTC departure at or after the request
  time. Unknown fields are rejected. The example date must be updated when used.
- Speed is optional, 5–50 km/h; otherwise use the saved riding speed, then the
  existing API default of 20 km/h. Speed is returned so comparisons are reproducible.
- Every ride must finish by 23:00 UTC on today + six days. Provider coverage may
  end sooner; those sections become unknown. Invalid windows return 400 before
  any provider request. This endpoint cannot replay historical rides.
- Maximum 12,000 exposed section/leg intersections per request; request fewer
  routes if this limit is exceeded (400). Each section uses its own midpoint
  arrival, with constant speed and no breaks, matching the weather timing model.
- The same session, owner checks, `GROUND_EVIDENCE_MODE=non-commercial` switch,
  12-cell cap, refresh leases and global daily budget apply as for `/ground-evidence`.
  Both endpoints share the same cache. Changing departure or speed recalculates
  locally from fresh cached evidence, with no extra provider calls.
- Fully paved/non-cycling routes are `not-applicable` and need no ground weather.

## Timing and missing information

The model starts 28 days before the last completed UTC hour at request time. It
carries this initialized state forward to each section's arrival. Historical
weather remains modelled weather; retained forecasts never become observations.

Hourly accumulations are indivisible. For arrival 14:35, use intervals ending at
14:00 or earlier. **Never use the interval ending 15:00**, even proportionally,
because it includes rain after passage. `evidenceThrough` and
`unassessedMinutesBeforeArrival` disclose the remaining partial hour (under 60
minutes). Sub-hour storms and pauses are limitations of this first model.

All five variables, fresh day provenance and all hours from initialization to
that cutoff are required. Missing or stale evidence makes the section unknown;
it is never converted to zero rain. A gap later in the forecast cannot invalidate
an earlier section. A cell omitted by the spatial cap stays unknown. Evidence
retrieved after the assessment's issue time is rejected by the pure model.

## Provisional model

Run three parallel storage scenarios each hour:

```text
storage = clamp(storage × 2^(−1 / drainageHalfLifeHours)
                + rainMm − referenceEt0Mm × et0Factor, 0, 60)
wetnessIndex = storage / 60 × 100
```

The index is a wetness proxy: **higher means wetter, not a better ride score**.
It is neither soil volumetric water content, mud depth nor probability.

| Scenario | Initial storage (proxy mm) | Drainage half-life | ET₀ multiplier |
| --- | ---: | ---: | ---: |
| Lower wetness | 0 | 36 h | 1.2 |
| Central | 30 | 72 h | 0.8 |
| Upper wetness | 60 | 168 h | 0.4 |

Initial conditions span dry to saturated; the central scenario starts halfway.
The 28-day warm-up retains antecedent wetness instead of assuming dry at day −14.
The bounds express scenario sensitivity, **not statistical confidence limits**.
They do not guarantee the real path lies within them. Drainage, soil and shade
are unmeasured, and no route-specific value is claimed for these coefficients.

Reference ET₀ describes well-watered reference grass, not path evaporation.
The multipliers are provisional. Rain adds moisture and stronger drying reduces
it monotonically for the same initial state. There is no calendar/month bonus:
seasonal differences arise from rain and drying inputs. Temperature is used for
freeze/thaw cautions, not to change the rider's temperature preferences.
See [FAO's definition of reference evapotranspiration](https://www.fao.org/4/X0490E/x0490e06.htm).

Classify the central scenario and lower/upper scenarios with these provisional
storage boundaries; equality enters the wetter class:

| Recorded surface | Response group | Firm | Soft | Muddy | Difficult |
| --- | --- | ---: | ---: | ---: | ---: |
| Compacted, gravel | Granular | <8 | 8–<20 | 20–<40 | ≥40 |
| Earth, dirt, grass | Soft | <3 | 3–<10 | 10–<25 | ≥25 |
| Sand, rough-unpaved, generic unpaved, unknown | Unresolved | No central condition | No central condition | No central condition | No central condition |

The material distinction changes susceptibility, not an invented measured
drainage rate. Unknown material can expose a sensitivity range (granular lower,
soft upper), but has null `condition` and is excluded from estimated distances.
Even granular surfaces can have puddles or a soft substrate; we do not promise
that all gravel behaves alike. `Difficult` means a provisional response class,
never a verified closure, impassability statement or safety rating.

### Snow and freeze/thaw

Any snowfall in the initialized window suppresses liquid-only classification:
snowpack depth and melt are not modelled. Sub-zero or zero air temperature at the
cutoff flags freezing risk; a positive value after freezing within 72 hours flags
thaw risk. These return `freeze-thaw-uncertain`, null condition and null index.
Frozen ground never earns a firm classification just because liquid rain is low.

This is deliberately conservative. Air temperature is not soil temperature;
positive air cannot prove a thawed or ice-free path, and snow predating the window
is unmeasured. The 72-hour thaw window is another provisional guard, not a claim
that thaw has completed. Add validated soil/snow evidence before winter rollout.

## Response

Top level: `schemaVersion`, `experimental: true`, `scoringApplied: false`, model
version/calibration status, issue/departure time, speed, timing assumptions,
provider attribution, request lattice, cell coverage, usage and `cells[].days`
provenance. Full hourly data remains available through `/ground-evidence`.

Each route has:

- `routeId`, `sourceHash`, estimated `finishAt`, status and confidence.
- `coverage`: route distance, ground exposure, estimated/unknown distance,
  excluded paved/non-cycling distance, unresolved material, freeze/thaw uncertainty,
  omitted-cell distance and fraction of exposure estimated. Some uncertainty
  subcategories overlap; do not add them together. Estimated + unknown = exposure.
- `estimatedDistanceM`: metres in each central condition class. Unknown metres
  are separate and must not be displayed as firm.
- `muddyOrDifficultM`: lower/central/upper scenario distances across assessable
  sections. These are not bounds for the entire route when coverage is incomplete.
  Divide by `routeDistanceM` for the route share; use `exposureM` for ground share.
- `longestEstimatedMuddyStretch`: start, end and metres of the longest contiguous
  central muddy/difficult stretch, or null. Paved, firm, soft and unknown gaps break
  continuity. This preserves substantial difficult stretches on otherwise paved rides.
- `sections[]`: distance interval, recorded surface, response group, cell, arrival
  and cutoff times, weather coverage, status, `condition`, scenario `range`, wetness
  index, confidence and machine-readable `reasons`.

Confidence is always low for a usable estimate while the model is uncalibrated;
failed evidence is unknown. Route confidence is unknown when no exposed section
has a central estimate. `not-applicable` is separate from both.

Reason codes currently include `uncalibrated-model`, `drainage-unmeasured`,
`surface-response-unknown`, `cell-or-time-unavailable`, `incomplete-weather`,
`stale-weather`, `evidence-retrieved-after-assessment`, `includes-forecast`,
`snowpack-and-melt-unmodelled`, `freezing-risk`, `thaw-risk` and
`scenario-disagreement`.

## Calibration before phase 4

Synthetic tests establish monotonicity, time cutoffs, material differences,
coverage and isolation. They do **not** establish that these numerical boundaries
predict real mud. Follow [the calibration protocol](ground-calibration.md) and
agree real examples before changing the weather score.
