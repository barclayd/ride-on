# Extension API brief v6: sky shares that survive a forecast gap

Proposed against API **0.27.0**, algorithm **comfort-v0.17**. For the API agent.

Design handoff v4 (sunshine wording) adds a sky chip and an "Expected conditions
along the ride" timeline to the Journeys tiles and Rides cards. Each ride hour is a
bar segment, sized by distance and coloured sunny, sunny intervals, or not forecast
yet. The legend shows each category's share of the ride (`~55%`). When the forecast
stops before the finish, the chip reads `Sunny where forecast` if every forecast
part is sunny.

Complete forecasts already work: `conditions.skyConditionDistanceFractions` exists
both overall and on every `rideHours[].conditions`. The gap appears when any
sampled row has no sky symbol. `summarize` then returns
`skyConditionDistanceFractions: null` for the whole summary. As a result:

- `best.conditions` loses every sky share, so the legend can't show the sunny and
  sunny intervals shares beside `Not forecast yet`;
- the ride hour that crosses the forecast horizon loses its known part too. The
  client can't tell whether the forecast part is all sunny (`Sunny where forecast`)
  or how much of that hour to colour.

`sunshineAssessment.unknownDistanceFraction` gives the overall unknown share, but
not how the known part is split, or where the gap falls.

This is an additive change: no scoring, ranking, or algorithm-version change.

## 1. `conditions.skyConditionShares`

Add it next to `skyConditionDistanceFractions` in `summarize`, so it appears on
`best.conditions`, alternatives, day and next-window winners, and every
`rideHours[].conditions`.

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

- Keys: every `skyConditions` category plus `unknown`. Each value is that
  category's share of the summary's own sampled distance: the whole route for
  `best.conditions`, that hour's distance for a ride hour. `unknown` covers rows
  with no sky symbol.
- Use the same distance weighting and `round` as `skyConditionDistanceFractions`.
  Rounded values may sum to 0.99–1.01.
- It is never null just because some symbols are missing. If none are known,
  `unknown` is 1.
- It is null or absent in exactly the cases where the summary would have no sky
  data at all for reasons other than missing symbols (for example, if sky isn't
  sampled when sunshine has zero weight). Keep that consistent with
  `sunshineAssessment: null`.
- Leave `skyConditionDistanceFractions` unchanged, null semantics included. The
  extension and the iOS app already read it.

## 2. Docs and tests

- In `docs/api.md`, add the field to the sunshine section (around "each ride hour
  shows how much sampled route distance received each category") and to the
  `best.conditions` / `best.rideHours` table row.
- Add one test with a forecast that ends mid-ride. Check that `best.conditions`
  and the boundary ride hour carry sunny / unknown shares matching
  `sunshineAssessment.unknownDistanceFraction`, and that
  `skyConditionDistanceFractions` stays null.

## Extension follow-up (client work, not API)

The extension reads `skyConditionShares` when it's present. Until then it falls
back to `skyConditionDistanceFractions` for complete forecasts and to
`sunshineAssessment.unknownDistanceFraction` for the gap. An incomplete forecast
shows the dashed chip with whatever the complete ride hours support.
