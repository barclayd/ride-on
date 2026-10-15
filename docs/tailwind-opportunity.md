# Tailwind opportunity preference

API v0.27.0 / algorithm `comfort-v0.17` adds an explicit preference for taking
advantage of favourable sustained wind on a predominantly one-way route.
It affects recommendation order, separately from the 0–100 Conditions score.
It estimates alignment with this forecast, **not historical rarity**.

## Preference contract

`settings.preferences.wind.prioritiseTailwindOpportunities` is a boolean, default
`false` for new and legacy profiles, including existing `preferTailwind: true`
profiles. Resolving a missing field does not rewrite the profile or its version.

Read through `GET /users/me`; save through the existing optimistic update:

```json
{
  "expectedVersion": 24,
  "settings": {
    "preferences": {
      "wind": {
        "preferTailwind": true,
        "prioritiseTailwindOpportunities": true
      }
    }
  }
}
```

Use the actual last-read version, not the example value. Creation accepts the same
setting. Omitted fields preserve saved choices; explicit `false` disables the
preference. Invalid types (including null) and unknown fields return 400; stale
writes return 409 without modifying anything.

The opportunity preference is active only when **both** wind booleans are true.
Choosing Calm (`preferTailwind: false`) suspends it without erasing the saved
choice. UI controls should make this dependency clear. Suggested label:
**“Prioritise favourable tailwind opportunities”**; supporting text:
“Give one-way rides extra priority when the wind helps for most of the route.”

`POST /recommendations` (single-day or multi-day) and
`POST /recommendations/next-windows` accept temporary overrides at
`preferences.wind.prioritiseTailwindOpportunities`. Resolution remains defaults →
saved profile → request overrides, with the result in `resolvedPreferences.wind`.
Overrides never persist themselves. This preference is independent of the wind
comfort weight; it is explicit opportunity intent, not inferred from that weight.

## Results and presentation

Every assessed departure, including alternatives and day/next-window winners,
adds these fields:

```json
{
  "score": 72.76,
  "recommendationPriority": 75.93,
  "tailwindOpportunity": {
    "enabled": true,
    "maximumPoints": 5,
    "priorityPoints": 3.17,
    "basis": "route-leg-bearings-and-sustained-wind",
    "routeDirectionality": 1,
    "alignment": 0.63,
    "opposingExposure": 0.04,
    "reason": "Favourable tailwind opportunity."
  }
}
```

- `score`, `baseScore`, `weatherScore`, `pointsLost`, `windAssistance` and weather
  facts retain their existing meanings. Opportunity adds no comfort points.
- `recommendationPriority = score + tailwindOpportunity.priorityPoints`, rounded
  to two decimals. Its range is 0–105. It is an ordering value, **not a score out
  of 100**. Continue showing `score` for Conditions and progress bars.
- Use the API's rankings, recommendation IDs, best departures and alternatives
  in their supplied order. Show the separate reason when points are positive;
  do not re-sort by Conditions. Existing extension/iOS lists already preserve
  API order; new controls and explanation rendering remain client work.
- Minimum-standards precedence remains first, then priority descending, Conditions
  descending, potential physical assistance descending, earlier departure, and
  stable route ID for remaining route ties. Opportunity never clears a failed
  limit or fills missing weather/elevation evidence.
- Disabled preferences return zero points and a null reason, while retaining
  alignment diagnostics. Incomplete elevation assessments have null priority
  and null opportunity and remain unranked.
- Weather caches are reusable: changing this preference needs no provider refresh.
  Existing recommendation results on a client require a new API request. Algorithm
  and resolved preferences are already part of previous-score baseline keys;
  score-change badges continue comparing Conditions, not priority.

## Bounded calibration

All calculations use unrounded distance shares, equivalent to time shares at the
current model's fixed riding speed. Thresholds below are preference calibration,
not physiological limits or a claim about historical wind frequency.

1. Sum each route leg's bearing vector weighted by its length; divide the net
   vector length by total route length. Convert that progress ratio to a 0–1
   directionality multiplier: zero at/below 0.2, linear to full credit at 0.5.
   This uses the same stored route facts as wind projection, without requiring
   full GPX geometry or guessing from names. Loops/out-and-backs cancel; the dead
   band tolerates residuals from simplified bearings. Winding one-way rides qualify.
2. For each forecast section, forward assistance ramps from zero at 5 km/h to
   full opportunity credit at 8 km/h. Average those credits by section length to
   get `alignment`. Gusts never earn credit.
3. Require a majority to benefit: multiply by `clamp((alignment - 0.5) / 0.1)`.
   This transitions continuously from zero at 50% effective coverage to full at
   60%. Weak breezes cannot suddenly unlock a whole-route bonus.
4. `opposingExposure` is the distance-weighted mean of headwind strength ramped
   from zero at 5 km/h to one at 13 km/h. Tolerate up to 10% effective opposing
   exposure, then reduce the opportunity multiplier linearly to zero at 30%.
5. Priority points are `5 × directionality × alignment × consistency × opposing
   multiplier`. They cannot exceed five. Physical headwind, crosswind and gust
   discomfort still applies separately in Conditions.

A comfortable 90% tailwind / 10% crosswind one-way ride earns 4.5 priority points.
A 60% tailwind / 40% headwind route earns none. Mostly sideways wind, a circular
route, a route name or gust peaks alone cannot create an opportunity.

## Checked preference comparisons

Synthetic tests preserve these choices with the interviewed wind/sunshine settings:

- Calm with continuous sunshine beats 90% helpful tailwind / 10% manageable
  crosswind with sunny intervals throughout.
- Three hours of full sunshine then one hour of sunny intervals, with the same
  helpful wind, narrowly competes on Conditions and wins more strongly when the
  route offers a one-way opportunity.
- A 72-point assisted ride can outrank a 75-point alternative, but the five-point
  maximum cannot overturn an 82-versus-72 comfort gap.
- Missing forecasts/elevation and failed hard limits retain their existing status.

The private replay uses the saved 15 October Met Office forecast for 17 October,
not a new upstream request. All **61 departures** keep identical Conditions,
factors, point-loss explanations and weather facts with the preference on/off.
The new preference changes selection/order only:

| Route | Selected local departure, enabled | Conditions | Opportunity points | Priority |
|---|---|---:|---:|---:|
| Horsham (Road) | 09:00 | 72.76 | 3.17 | 75.93 |
| Richmond | 09:00 | 72.54 | 0 | 72.54 |
| Potters Bar | 08:00 | 65.67 | 0 | 65.67 |
| Braintree | 08:00 | 58.18 | 0 | 58.18 |

Without the new preference, Horsham's highest Conditions departure is 08:30 at
72.82. Opportunity makes 09:00 narrowly preferable overall. The explicitly
calibrated 08:00-versus-10:00 choice still holds: priority 75.41 versus 75.30
(Conditions 72.69 versus 71.85). Those close margins are specific to this forecast;
new weather can legitimately change the preferred departure.
