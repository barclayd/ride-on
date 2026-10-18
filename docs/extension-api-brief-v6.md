# Extension API brief v6: sky shares that survive a forecast gap

Against API **0.40.0**, algorithm **comfort-v0.17**. For the API agent. First
proposed against 0.27.0 and still not implemented; refreshed on 18 October 2026
for the current worker. Additive: no scoring, ranking or algorithm-version change.
Ship it as the next minor: **0.41.0** ([brief v13](extension-api-brief-v13.md)
shipped as 0.40.0).

Design handoff v4 (sunshine wording) adds a sky chip and an "Expected conditions
along the ride" timeline to the Journeys tiles and the popup's Rides cards. Each
ride hour is a bar segment, sized by distance and coloured sunny, sunny intervals,
cloud, or data unavailable. The legend shows each category's share of the ride
(`~55%`). When part of the ride has no sky symbol, the chip reads
`Sunny where forecast` if every known part is sunny. The extension has shipped all
of this; it is waiting on the data below.

## Why it's needed

Complete forecasts already work: `conditions.skyConditionDistanceFractions` exists
both overall and on every `rideHours[].conditions`. The gap appears when any
sampled row has `skyCondition: null`. `summarize` in
`worker/src/recommendations/engine.ts` then returns
`skyConditionDistanceFractions: null` for the whole summary.

A row's sky symbol can be missing while its essential weather is present, so the
departure is still scored (`sunshineAssessment.status: 'partial'`). Since Apple
Weather became a provider, the gap isn't only at the forecast horizon:
`appleSkyCondition` maps wind and heat codes (`Windy`, `Hot`…), and sun codes
whose daylight is unknown, to null, so the gap can fall mid-ride.
`worker/test/sunshine-coverage.test.ts` already covers partial sunshine for
scoring. As a result:

- `best.conditions` loses every sky share, so the legend can't show the sunny and
  sunny intervals shares beside `Data unavailable`;
- the ride hour that contains the gap loses its known part too. The client can't
  tell whether the known part is all sunny (`Sunny where forecast`) or how much
  of that hour to colour.

`sunshineAssessment.unknownDistanceFraction` gives the overall unknown share, but
not how the known part is split, or where the gap falls.

## 1. `conditions.skyConditionShares`

Add it next to `skyConditionDistanceFractions` in `summarize`, so it appears
wherever a summary does: `best.conditions`, alternatives, day and next-window
winners, and every non-null `rideHours[].conditions`.

```json
"skyConditionShares": {
  "sunny": 0.42,
  "sunnyIntervals": 0.18,
  "cloudy": 0,
  "overcast": 0,
  "obscured": 0,
  "precipitation": 0,
  "clearNight": 0,
  "partlyCloudyNight": 0,
  "unknown": 0.4
}
```

- **Keys:** every `skyConditions` category (`worker/src/weather/conditions.ts`)
  plus `unknown`.
  - Each value is that category's share of the summary's own sampled distance: the
    whole route for `best.conditions`, that hour's distance for a ride hour.
  - `unknown` covers rows with `skyCondition: null`.
- **Rounding:** use the same distance weighting and `round` as
  `skyConditionDistanceFractions`. Rounded values may sum to 0.99–1.01.
- **Missing symbols:** the field is never null because of them. If no symbol is
  known, `unknown` is 1.
- **When it is null:** exactly when `sunshineAssessment` is null, which means
  sunshine has zero weight. The engine doesn't sample sky then (`skyCondition` is
  null on every row), so `unknown: 1` would be misleading. `summarize` doesn't
  see the weights, so pass it a flag.
- **Leave these unchanged:**
  - `skyConditionDistanceFractions`, including when it is null. The extension and
    the iOS app (`RideBoardLoader.swift`) already read it.
  - `factors.sunshine`, which stays null whenever the fractions are.
- **Schema:** add the field to `conditionsSchema` in
  `worker/src/recommendations/conditions.ts`.
  - Make it optional, like `windDistanceFractions`. Ride plans saved through
    `worker/src/rides/plan.ts` store `conditions` in that strict schema, so
    historical plans must still parse.
  - Allow `unknown` as well as the eight categories.

Ride monitoring and alert triggers don't read sky conditions, so they need no
change.

## 2. Docs and tests

- In `docs/api.md`:
  - add the field to the sunshine section, after "show how much sampled route
    distance received each category";
  - add it to the `best.conditions`, `best.rideHours` row of the response table;
  - add a changelog line at the top.
- In `worker/test/sunshine-coverage.test.ts`, add one test with a ride whose sky
  symbols stop partway through. Check that:
  - `best.conditions` and the ride hour containing the boundary carry sunny and
    unknown shares;
  - the overall `unknown` matches `sunshineAssessment.unknownDistanceFraction`
    to rounding;
  - `skyConditionDistanceFractions` stays null;
  - with sunshine at zero weight, `skyConditionShares` is null.

## Extension follow-up (client work, not API)

The extension already reads the field: `skyKinds` in `extension/ui/format.ts`
takes `skyConditionShares ?? skyConditionDistanceFractions`, and `SkyShares` in
`extension/lib/types.ts` allows `unknown`. Until the API sends it:

- an hour with a gap counts entirely as `Data unavailable`;
- the overall shares are the ride hours' shares, weighted by distance.

Once it ships:

- add the field to the e2e mock;
- drop the "Before skyConditionShares" fallback note.

The legend calls the unknown share `Data unavailable`, not `Not forecast yet`,
because the gap can fall mid-ride. The iOS app's Ride detail uses the same label.
