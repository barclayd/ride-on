# Extension API brief v4 — condition chips

Proposed against API **0.14.0**, algorithm **comfort-v0.9**. For the API agent.

The Journeys page tile (design 11b) replaces the grey "At ride time: …" sentence
with three chips, always in this order: **temperature · wind · rain**. Each chip
is green when the condition is fine and amber when it lowers the score:

| Chip | Example | Amber when |
|---|---|---|
| Temperature | `10–11°C` | Outside the rider's comfort range |
| Wind, under 10 km/h | `3 km/h` | Never |
| Wind, 10 km/h or more | `12 km/h tailwind`, `15 km/h crosswind`, `15 km/h headwind` | Crosswind or headwind |
| Rain | `Dry`, or the forecast, e.g. `Light showers` | Any rain |

The design names the wind direction only if one direction covers **most of the
route**, and names the rain by its **forecast type**. `best.conditions` can't
answer either question today, so two additive fields are needed. Nothing else
changes: no scoring, ranking or algorithm-version change.

## 1. `conditions.windDistanceFractions`

```ts
windDistanceFractions: { headwind: number; tailwind: number; crosswind: number }
```

The share of the route's distance where each wind component dominates, weighted
by distance like the other `summarize` fields:

- For each observation row, `along = headwindKph` (signed, already computed in
  `engine.ts`) and `cross = crosswindKph`.
- If `|along| >= cross`, the row counts as `headwind` when `along > 0`, otherwise
  `tailwind`. If `cross > |along|`, it counts as `crosswind`.
- Round to 2 dp, as `round()` does elsewhere. The three should sum to 1 (±0.01 from rounding).

Why the averages aren't enough: `averageTailwindKph: 12` with
`averageCrosswindKph: 4` can come from a route that is half tailwind and half
crosswind. The design needs "covers most of the route", which is a distance
share, not a speed.

This is not `assistedDistanceFraction`. That field has a 3 km/h floor and needs
the tailwind to beat the crosswind; this one classifies every row, whatever the
speed. The client applies the 10 km/h threshold to `averageWindSpeedKph` before
naming any direction.

Client rule, for reference: name the direction when `averageWindSpeedKph >= 10`
and one fraction is `> 0.5`. Otherwise show the speed only.

## 2. `conditions.precipitationSummary`

```ts
precipitationSummary:
  | 'dry' | 'possible'
  | 'drizzle' | 'light_showers' | 'showers' | 'heavy_showers'
  | 'light_rain' | 'rain' | 'heavy_rain'
  | 'sleet' | 'hail' | 'snow' | 'thunder'
```

The single worst wet weather expected along the ride, so the chip can say
`Light showers` rather than `Rain`.

- **Forecast type first.** Map each row's provider weather type into this
  vocabulary, then take the most severe across the ride. Severity, low to high:
  `drizzle < light_showers < light_rain < showers < rain < heavy_showers < heavy_rain < sleet < snow < hail < thunder`.
  - Met Office: `significantWeatherCode` 9–30 (see `met-office-symbols.ts`).
  - Apple: `conditionCode` (see `apple-weather.ts`).
  - Today the existing sky-condition vocabulary collapses all of these to
    `skyConditions.precipitation`, and the descriptor is only requested when the
    sunshine weight is above 0. This field needs the weather-type descriptor on
    every recommendation request, mapped to the finer vocabulary above. Keep
    `skyConditionDistanceFractions` unchanged.
- **No wet type on any row** (or the provider has no type):
  - any row with `precipitationRateMmH >= 0.1` → by the maximum rate:
    under 0.5 is `light_rain`, under 4 is `rain`, 4 or more is `heavy_rain`;
  - otherwise `maximumPrecipitationProbability >= 0.3` → `possible`;
  - otherwise `dry`.

The thresholds (0.1 / 0.5 / 4 mm/h, 30%) and the severity order are suggestions;
finalise them with the providers' own bands and document them in `docs/api.md`.

The client shows `possible` as `N% chance of rain`, using
`maximumPrecipitationProbability`.

## 3. Where the fields appear

- Required on every newly computed `Conditions` object: `rankings[].best.conditions`,
  `best.rideHours[].conditions`, and anywhere else `summarize()` output is
  returned. Both come out of `summarize`, so this is one change.
- **Optional** in `conditionsSchema` for parsing. `POST /rides` validates
  `plan.conditions` with the same strict schema. Plans saved before this change
  lack the fields and must stay readable, and new clients will start sending
  them inside `plan` as soon as recommendations include them. If the fields were
  required, or the schema stayed strict without them, either old reads or new
  writes would fail.
- Suggested version: API **0.15.0** (additive). The algorithm version is unchanged.

## 4. Not needed from the API

- **Temperature colour.** The client compares the rounded `temperatureC` range
  with `preferences.temperature.comfortMinC` / `comfortMaxC`.
- **Wind colour.** The client applies amber to crosswind and headwind.
- **°F / mph conversion.** The client converts on display (see section 7). Keep
  every API value in °C and km/h.

## 5. Client behaviour until this ships

The extension already reads both fields as optional (`extension/lib/types.ts`):

- No `windDistanceFractions` → the wind chip shows the speed only, e.g. `15 km/h`.
- No `precipitationSummary` → `Dry` when `maximumPrecipitationProbability` is
  under 10%, otherwise `N% chance of rain` (amber).

So deploying in either order is safe.

## 6. Tests to add

- `summarize`: fractions for an all-tailwind route, an all-crosswind route, and
  a half-and-half route (no majority); rounding still sums to 1 ± 0.01.
- `precipitationSummary`: picks the most severe type across rows; rate fallback
  bands; `possible` at 30%; `dry` below.
- `POST /rides`: a plan without the new fields is still accepted, and a plan
  with them round-trips unchanged.

## 7. `settings.units` (design 12a)

The Preferences tab now has a **Units** card: temperature `°C | °F` and wind
speed `km/h | mph`, two independent switches. Riders set them once, so they
should follow the rider to every device and the iOS app.

```ts
settings.units?: { temperature: 'C' | 'F'; windSpeed: 'kmh' | 'mph' }
```

- Optional on `GET /users/me` and accepted by the existing settings `PATCH`
  (same `expectedVersion` rule). Absent means the client picks a default.
- Display only: no scoring, preference or response values change. Keep every
  `*C` and `*Kph` field in °C and km/h.
- Consider adding the distance unit here too (`distance: 'km' | 'mi'`). The
  extension also keeps that one locally today.

**Client behaviour until this ships:** the extension stores units in
`browser.storage.local`. The default comes from the browser region: °F and mph
for the US, °C and mph for the UK, °C and km/h elsewhere. Once the rider picks,
their choice is kept. When `settings.units` appears, the client will read it
and send changes through the settings `PATCH`.

## Decisions

- **Wind-direction threshold:** 10 km/h confirmed. It stays in km/h internally
  whatever the display unit.
- **Wind unit:** follows the rider's wind-speed setting (section 7), e.g.
  `9 mph crosswind`.
- **Rain thresholds and severity order:** accepted as written in section 2.
