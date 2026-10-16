# Extension API brief v7: route outline and wind stretches

Implemented in API **0.29.0**, algorithm **comfort-v0.17**.

## Review decisions (16 October 2026)

- Dan chose to **preserve actual wind sections**. The proposed 2% sliver absorption
  below is superseded: no section changes its effect to match a neighbour. The UI
  may omit tiny labels, but must still colour each section accurately and retain
  the section containing the strongest adverse gust. There can be up to 1,000
  entries (the route-leg limit), rather than approximately 50.
- Legacy legs store midpoints only. The fallback uses the actual endpoints from
  `weatherLocations` at distance zero and the route end, with leg midpoints between
  them. If usable endpoints are absent, return null rather than inventing them.
- Stored geometry has already been simplified. Outline chainage is computed along
  that path and scaled to the route distance, then retained during the 64-point
  simplification. It is approximate display geometry. Whole-metre rounding makes
  its last distance `Math.round(route.distanceM)`; wind stretch bounds retain the
  exact route distance.
- Wind is sampled even with zero wind scoring weight. Such rides still carry wind
  stretches. No additional weather calls or cache invalidation are needed.
- Gust directions are estimates from the prevailing wind. `effect` describes the
  section's sustained wind, not an independently forecast gust direction. Clients
  must not claim a precise gust direction or exact peak time from these fields.
- The immutable tracked-plan and logged-plan snapshots retain the new sections;
  historical snapshots are not back-filled. Storage/request bounds accommodate
  up to 1,000 sections while the existing per-owner storage quota remains.

The original proposal follows for context; these review decisions take precedence.

The wind redesign replaces the raw gust chip on Journeys tiles and Rides cards
with a wind pill (`10 mph tailwind`) that opens a "Wind along the ride" dropdown,
like the sky dropdown. At the top of the dropdown is a small north-up route
sketch: the route outline with no basemap, coloured by wind effect (tailwind,
crosswind, headwind, light), with chevrons for direction of travel, a start dot
and one wind arrow ("Wind from SW, then W"). Under it is a bar of ride hours
labelled with compass points, a legend and a gusts row.

The bar, legend, pill and gusts row can be built from data the API already returns:
`conditions` and `rideHours[].conditions` (`windDistanceFractions`,
`windFromDegrees`, the average components, `gustExposure`). The sketch can't.
Recommendations carry no route shape, and per-hour shares don't say *where* on the
route each effect falls. `GET /routes/:id/geometry` is one request per tile and
returns the full path, so it's too heavy for a popup with eight tiles.

This is an additive change: no scoring, ranking, or algorithm-version change.

## 1. `outline` on each ranked and unranked route

Add a small, simplified outline next to `distanceM`/`ascentM` in the route summary
that `recommend` emits (`rankings[]` and `unranked[]`).

```json
"outline": {
  "version": 1,
  "points": [
    [51.0632, -0.3271, 0],
    [51.0711, -0.3104, 1840],
    [51.0802, -0.2911, 3920]
  ]
}
```

- Each point is `[latitude, longitude, distanceM]`, where `distanceM` is the
  distance along the route, from 0 to `distanceM`. The client uses it to colour the
  line by `windStretches` and to place direction chevrons.
- Use 5 decimal places for coordinates and whole metres for distance.
- Build it from `route.geometry` when present: decode it, then simplify with
  Douglas–Peucker in projected metres until there are **at most 64 points**. Keep
  the first and last point, and keep each surviving point's original
  along-route distance. When `geometry` is null, fall back to the leg midpoints
  (`route.legs[].coordinate`, with `(fromM + toM) / 2`), plus the start of the
  first leg and the end of the last, simplified the same way.
- `outline` is `null` only when the route has fewer than two usable points.
- Compute it once per route and cache it with the route summary if that's simpler.
  It doesn't depend on the departure or the weather.
- Don't add elevation or any basemap data. The sketch is north-up and drawn
  from these points alone.

## 2. `windStretches` on each departure

Add `windStretches` to every departure object that carries `rideHours`:
`best`, `alternatives[]`, `partialAssessment`, the day winners, and the
next-window winners. Put it next to `rideHours`.

```json
"windStretches": [
  {
    "fromM": 0,
    "toM": 21500,
    "startAt": "2026-10-18T09:30:00.000Z",
    "endAt": "2026-10-18T10:28:00.000Z",
    "effect": "tailwind",
    "windFromDegrees": 228,
    "averageWindSpeedKph": 17.4,
    "maximumAdverseGustKph": 8.1
  },
  {
    "fromM": 21500,
    "toM": 30500,
    "startAt": "2026-10-18T10:28:00.000Z",
    "endAt": "2026-10-18T10:52:00.000Z",
    "effect": "crosswind",
    "windFromDegrees": 236,
    "averageWindSpeedKph": 18.2,
    "maximumAdverseGustKph": 14.9
  },
  {
    "fromM": 30500,
    "toM": 46000,
    "startAt": "2026-10-18T10:52:00.000Z",
    "endAt": "2026-10-18T11:35:00.000Z",
    "effect": "headwind",
    "windFromDegrees": 262,
    "averageWindSpeedKph": 19.0,
    "maximumAdverseGustKph": 33.6
  }
]
```

Build it from the same `rows` (`Observation[]`) that `summarize` uses for that
departure:

1. **Classify each row.** A row is `light` when `windSpeedKph < 10`. Otherwise use
   the `windDistanceFractions` rule: `headwind` if `headwindKph > 0` and
   `|headwindKph| >= crosswindKph`; `tailwind` if `headwindKph <= 0` and
   `|headwindKph| >= crosswindKph`; `crosswind` if `crosswindKph > |headwindKph|`.
   The 10 km/h cut-off is the same one the client uses before naming a direction.
2. **Merge neighbours.** Merge adjacent rows that share an effect and an 8-point
   compass sector of `windFromDegrees` (N, NE, … NW, each 45° wide and centred on
   its point). `light` rows merge whatever their direction.
3. **Preserve short sections (reviewed).** Do not absorb short sections into
   neighbours or discard them below 5%. Only adjacent rows with the same effect
   and compass sector merge, as above. Tiny labels may be omitted by the client.
4. **Fill each stretch.**
   - `fromM`/`toM`: the stretch's bounds. Stretches are contiguous and together
     cover `[0, distanceM]` exactly.
   - `startAt`/`endAt`: ISO times at `fromM`/`toM` on the departure's linear time
     model, `departure + duration × m / distanceM`, the model `forecastDetails`
     uses.
   - `windFromDegrees`: `meanWindFrom` over the stretch's rows, rounded to whole
     degrees. It's `null` where `meanWindFrom` returns null (calm or variable).
   - `averageWindSpeedKph`: distance-weighted mean of `windSpeedKph`, rounded with
     the same `round` as `summarize`.
   - `maximumAdverseGustKph`: maximum `adverseGustKph` over the stretch's rows, with
     the same estimate as `gustExposure.maximumAdverseKph`. The largest value
     across all stretches must equal `conditions.gustExposure.maximumAdverseKph`.

When the departure has no rows, `windStretches` is `[]`. That includes a departure
that couldn't be assessed and a wind weight of zero, if that skips sampling.
Never emit a partial cover.

Persisted ride plans accept `windStretches` optionally. Old snapshots stay readable
and are never back-filled, and new snapshots round-trip without dropping it.

## 3. Version and cache

- Bump the API to **0.29.0**, as v6 did.
- If a recommendation-cache key includes the response shape, bump it so cached
  responses gain both fields. If it doesn't, the fields appear as entries expire.

## 4. Docs and tests

- `docs/api.md`:
  - Add `outline` to the recommendations response table and the route-geometry
    paragraph. Note that it's a display sketch, not navigation geometry.
  - Add `windStretches` to the table row for `best.conditions` / `best.rideHours`,
    and give it a short subsection under "Condition chip summaries". It should
    state the light threshold, the merge rules, preservation of short sections and the
    invariant on `maximumAdverseGustKph`.
- Tests:
  - An out-and-back fixture into a steady westerly. Check that `windStretches` is
    tailwind then headwind, covers `[0, distanceM]`, carries `startAt`/`endAt` on
    the time model, and that its max adverse gust equals `gustExposure`.
  - A wind that veers mid-ride from SW to W while the effect stays the same. Check
    that it splits into two stretches on the compass change.
  - A calm fixture. Check that every stretch is `light` and they merge into one.
  - Outline: at most 64 points, first and last points kept, `distanceM`
    non-decreasing from 0 to `distanceM`, the leg-midpoint fallback when
    `geometry` is null, and `null` when there are under two points.
  - Rankings stay identical before and after: no scoring change.

## Extension follow-up (client work, not API)

The extension builds the pill, the dropdown bar (with compass labels), the legend
and the gusts row from existing `conditions` and `rideHours`. It starts reading
`windFromDegrees`, which it doesn't type yet. The route sketch appears only when
both `outline` and a non-empty `windStretches` are present; until then the dropdown
opens straight onto the bar. The gusts row uses `windStretches` to name the stretch
with the strongest adverse gust ("Into your face on the way back, 11:00–11:40").
Without it, the row omits that clause.
