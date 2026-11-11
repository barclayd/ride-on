# Cycling comfort: evidence and scoring decisions

Reviewed 11 November 2026. Implemented temperature algorithm: `comfort-v0.19`.
This is an evidence register and decision record, not a validated physiological
model. Research supports the mechanisms below; it does **not** establish our
0–100 scale, factor weights, quadratic coefficients or heat score ceilings.

## Evidence register

| Source and evidence read | Finding relevant to Ride On | Applicability and limitation |
| --- | --- | --- |
| [IOC consensus, Racinais et al., 2023](https://bjsm.bmj.com/content/57/1/8) — consensus text/excerpts | Heat strain depends on temperature, humidity, radiation, airflow, exertion, clothing and acclimation; cycling airflow helps, but the advantage diminishes uphill and when air is hotter than skin | Strong basis for treating heat as more than preference mismatch; no universal air-temperature cut-off or comfort score |
| [UCI practical WBGT guide, 2024](https://assets.ctfassets.net/761l7gh5x5an/716JED6hjzxjx4NJarMGnF/dd351ea31195ade0da04858b44d9e176/HIGH_TEMPERATURE_DURING_ROAD_CYCLING_EVENTS.pdf) — full six-page guide | Uses a physical WBGT estimate with temperature, humidity, radiation and airflow; calls for mitigation based on heat stress and route context | Race-event guidance, not a recreational recommendation formula. Its cycling-speed assumptions must not be copied into slower riding. WBGT degrees are not air-temperature degrees |
| [ACSM cold-exercise consensus, Castellani et al., 2021](https://pubmed.ncbi.nlm.nih.gov/34752434/) and [publisher text](https://doi.org/10.1249/JSR.0000000000000907) — abstract and accessible excerpts | Cold exposure depends on wind, wetness, clothing, activity and individual characteristics | Supports joint exposure modelling; does not establish a universal unsafe distance below a rider's preferred midpoint |
| [Pezzoli et al., 2012, Analysis of thermal comfort in cycling athletes](https://doi.org/10.1016/j.proeng.2012.04.074) — abstract | Field measurements include apparent wind, clothing, metabolic heat, humidity and temperatures; cycling motion matters to thermal indices | Cycling-specific experimental method; not validation of a temperature-only score or of PMV/PET for every rider |
| [Teunissen et al., 2012, Wind cooling during a self-paced cycling time trial](https://research.vu.nl/en/publications/wind-cooling-during-a-self-paced-cycling-time-trial/) — conference abstract | Ten men at 28°C/80% RH had better thermal comfort and performance with imposed airflow | Small chamber experiment and conference abstract. Demonstrates cooling benefits, not the net outdoor benefit of riding into a headwind |
| [Ito et al., 2013, rain during cold exercise](https://pubmed.ncbi.nlm.nih.gov/23371827/) — abstract | Seven men running at 5°C under 40 mm/h rain had greater cooling and metabolic demand than dry conditions | Supports a cold–wet interaction. Running and very heavy rain cannot directly calibrate cycling in drizzle |
| [Schmitt et al., 2023, weather conditions for urban cyclists](https://doi.org/10.1002/met.2164) — full article sections on comfort thresholds | Uses route exposure, accumulated rain and directional wind; explores relative air speed and thermal indices | Urban commuter simulations. Rain thresholds include authors' experience rather than a validated dose-response relationship; do not transplant them as universal comfort thresholds |

## Temperature decisions

The saved range remains a band of equal **personal preference**. A single shared
base curve penalises cold and heat outside it. With midpoint `m`, half-width `h`,
and distance `d` beyond the relevant boundary:

```text
loss(d, h) = d / 10
           + (max(0, h + d - 10)^2 - max(0, h - 10)^2) / 20^2
```

`h + d` is distance from the midpoint. The linear term never saturates; the
quadratic term increases the marginal penalty at larger midpoint distances.
Subtracting the boundary term keeps the curve continuous even for wide bands.
Zero-width ranges also work without division by the range width. A warmer
midpoint therefore increases cold loss even if the lower boundary stays fixed.
The 10°C linear scale retains the previous model's moderate-temperature scale;
the 20°C quadratic scale is a provisional product calibration, not a measured
human response. Research does not prove this exact curve or symmetry.

Explicit `cooler-winters` still reduces cold distance by at most 6°C using local
seasonal normals. Explicit `high` cold sensitivity retains the additional
`0.8 × (1 − exp(−d / 1.2))` penalty and distance-weighted exposure, without a
second worst-section penalty. Standard cold and heat retain the existing
75% mean / 25% worst-section blend. Only the displayed factor and final weather
score are bounded; underlying temperature losses continue beyond full loss of
the temperature share. Counterfactual temperature points include the whole loss.

This increases warmth's influence in close comparisons. With the existing
cold-sensitive October fixture, 12°C sunny intervals now narrowly beats 8°C sun.
The standard-sensitivity interview comparisons remain in their previous order.
In the synthetic town-weather replay, the warmer Horsham noon departure now
narrowly beats 10:00 (89.35 versus 89.13); Richmond's earlier choice is retained.

## Absolute heat screen

A very hot preferred range must not imply that extreme heat is an ideal outing.
Pending humidity/radiation inputs, apply a conservative air-temperature screen
using the **unrounded maximum along the ride**, including section entry/exit
extrema. It applies independently of temperature weight, preference range,
tailwind benefits and climbing/distance bonuses:

```text
score ceiling = 100 / (1 + (max(0, maximumAirC − 35) / 5)^2)
```

| Maximum air temperature | Overall score ceiling |
| --- | ---: |
| 35°C or below | 100 |
| 38°C | 73.53 |
| 40°C | 50 |
| 42°C | 33.78 |
| 45°C | 20 |

The 35°C onset, 5°C scale and numerical ceilings are **conservative product
policy**, not UCI/ACSM thresholds, WBGT estimates, medical probabilities or claims
that lower temperatures are safe. The policy reflects Dan's explicit request
that 40°C+ should strongly suppress recommendations even within a wide range.
It is smooth and can only lower a score. A short hot section can constrain the
whole ride; this is deliberate screening, not an estimate of cumulative strain.
No new automatic hard-standard failure or fabricated humidity value is created.

`pointsLost.temperature` includes the ceiling even when preference weight is
zero. Other factor counterfactuals retain it. `factors.temperature` is no higher
than the ceiling, and `drawbacks` explains the heat screen and missing context.
`weatherScore` remains the pre-screen weighted weather score; `baseScore` and
`score` include the screen (and the latter includes history). User-set hard
temperature standards remain independent.

## Wind and rain: next evidence-led changes

The current wind model separates headwind, crosswind, gusts and optional
tailwind assistance. These represent effort/control preferences; their existing
coefficients are not established by the papers above. Wind also changes thermal
comfort: airflow can help in heat and worsen cold. Adding a generic extra wind
penalty would miss this reversal and could count the same effect twice.

The rain model currently combines local probability (80%) and bounded rate
(20%), then uses the weather blend. These coefficients are product choices.
Rain likelihood is not exposure duration or wetness. The next model should
retain each provider's period/probability semantics, integrate amount over time,
and distinguish prolonged wetting from a brief shower. A cold–wet interaction
is supported qualitatively, but this review cannot justify its numerical size.

Before replacing these curves:

1. Add validated optional humidity and radiation inputs with source, units and
   temporal semantics. Missing inputs must remain unknown.
2. Evaluate a physical heat model such as Liljegren WBGT against published
   reference cases, documenting radiation, shade and apparent-airflow assumptions.
   Do not label air temperature, feels-like or heat index as measured WBGT.
3. Model rider-relative airflow using speed and direction, and keep thermal
   cooling distinct from mechanical effort and gust/control discomfort.
4. Collect paired rider comfort reports with clothing, exertion, duration,
   acclimation and wetness where practical; use held-out rides for calibration.
   Ridership counts and laboratory exhaustion times are not comfort labels.
5. Compare dry/cold, wet/cold, dry/hot and humid/hot cases; short versus prolonged
   exposure; uphill versus fast airflow; missing inputs; seasonal climates; and
   zero preference weights. Retain hard limits and clear explanations.

Wind/rain scoring changes are deferred until those inputs and calibration exist.
The research accumulated here is the rationale and implementation direction,
not evidence that arbitrary new multipliers have been validated.

## Route-specific gradient, elevation and exposure

The API currently retains section positions, distances and headings, and total
ascent. Its climbing preference uses ascent per kilometre; it does not measure
section gradient or rider effort. Weather arrival times assume constant speed,
so distance weighting currently stands in for time weighting. Imported GPX
altitudes are used for ascent but are not retained on recommendation legs.
The app's elevation display is not evidence that the API already scores those
local slopes.

The next route-aware model should:

1. Retain a versioned elevation profile with source and missing-data status.
   Smooth elevation over distance before estimating grade; reject isolated
   spikes, and preserve genuine sustained climbs. Missing elevation must not
   silently mean flat ground.
2. Estimate section speed and arrival time using gradient, heading, wind and
   rider-specific pace or power evidence. A steeper climb does not by itself
   prove greater metabolic power: riders may maintain effort and slow down.
   Do not infer watts, fitness or body mass from gradient alone.
3. Sample weather at those revised arrival times and weight thermal/wetness
   exposure by time. A slow climb deserves more exposure weight than a fast
   descent of the same distance. Recalculate departure-window feasibility too.
4. Calculate apparent airflow from rider velocity and the wind vector. Use it
   for thermal exchange separately from headwind effort and crosswind control.
   A hot slow climb and a cold wet descent need different treatment; avoid a
   single generic hill multiplier or double-counting climbing preference.
5. Add shade, altitude weather corrections and surface/control interactions
   only when their evidence is available. Elevation does not establish shade,
   road wetness, ice, grip or actual local wind; avoid correcting temperature
   twice if the forecast already accounts for terrain.

The [UCI heat guide](https://assets.ctfassets.net/761l7gh5x5an/716JED6hjzxjx4NJarMGnF/dd351ea31195ade0da04858b44d9e176/HIGH_TEMPERATURE_DURING_ROAD_CYCLING_EVENTS.pdf)
explicitly identifies reduced cooling during slower uphill cycling. For a
mechanical speed/power foundation, [Martin et al., 1998](https://pubmed.ncbi.nlm.nih.gov/28121252/)
validated a road-cycling power model against measurements, including aerodynamic,
air-velocity, gradient and rolling-resistance parameters (abstract reviewed).
Its accuracy with known parameters does not transfer automatically to an app
with estimated rider inputs, and mechanical power is not itself thermal comfort.

Validate against recorded segment times and, where available, measured power;
then test matched-distance routes with different slope distributions, reversed
routes, sustained versus brief climbs, pauses, noisy/missing elevation and
weather changes during a slow climb. This work is a follow-up design, not an
implemented claim of `comfort-v0.19`.

## Verification and limits

`api/test/temperature-comfort.test.ts` covers continuity, symmetric preference
loss, increasing marginal base loss, midpoint dependence, no plateau for high
cold sensitivity, severe final-score reductions, heat-screen independence,
counterfactual attribution and hard limits. It includes a synthetic 51 km,
sunny/dry/calm November route near Braintree with −1/1/2°C sections and explicit
16–32°C, high-sensitivity, seasonal-tolerance settings. It is not a replay of
Dan's screenshot or a fresh production forecast. Algorithm version changes
invalidate scoring baselines through the existing versioned keys.

That synthetic November example scores **64.81**, compared with approximately
73 under the former capped cold curve. The screenshot's actual preferences,
route sections and cached weather were not retrieved in this task.
