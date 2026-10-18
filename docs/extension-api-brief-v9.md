# Extension API brief v9: temperature and rain along the ride

Implemented in API **0.35.0**, algorithm **comfort-v0.17**, against API 0.34.0.
The five recommended decisions below are adopted. Dan approved fractional-minute
finish/extreme offsets so exact timing and extrema survive; the regular grid stays
at ten minutes. See [the shipped contract](api.md#temperature-and-rain-along-the-ride-v0350)
for section-boundary discontinuities, missing-value behavior and precision.

Design handoff v7 turns the temperature chip and the rain chip on Journeys tiles into
buttons that open a detail panel, like the sky panel (17a):

- **Temperature (24a).** A chart of air temperature and feels like over the ride,
  against the rider's ideal range and the usual temperature for the month there. A
  headline (`3° warmer than usual`), a sentence about when the ride feels outside
  the ideal range (`Feels cooler than your range (down to 6°C) until about 09:30, then
  in your range to the finish.`) and a footnote with the month's average high and low.
  The chip turns amber when the ride **feels** outside the range for more than half
  its length.
- **Rain (25b).** One card per ride hour with the chance of rain and the amount in mm,
  plus a headline and a sentence (`Rain likely from about 10:30, easing by about 12:00.
  Heaviest around 11:30: moderate, 2.4 mm in the hour, 70% chance.`). The rain chip
  replaces the static `Dry` chip, and calls light rain `Drizzle` when the heaviest
  hour is under 1 mm.

What the API already gives, per departure:

| Need | Today |
| --- | --- |
| Air temperature range over the ride | `conditions.temperatureC` |
| Chance of rain per ride hour | `rideHours[].conditions.maximumPrecipitationProbability` |
| Rain rate per ride hour | `rideHours[].conditions.maximumPrecipitationRateMmH` |
| Air temperature **over time** (chart, crossing times, mean) | Missing. `rideHours` has only a min and max per hour, with no times |
| Feels like | Missing. Apple and Met Office global spot supply it, but the API drops it. The Met Office (`met-office-bpf`) choice has none |
| Rain **amount** in mm per hour | Missing. Apple and global spot supply an hourly amount; BPF has only a rate |
| Usual temperature for the month | Partly. The bundled HadUK-Grid data is the mean daily **maximum** only, and is looked up only when `seasonalTolerance` is `cooler-winters` |

This is an additive, display-only change: no scoring, ranking or algorithm-version
change. Feels like doesn't enter comfort scoring.

## 1. `temperatureAlongRide` on each departure

Every departure that carries `rideHours` (best, alternatives, day winners,
next-window winners, partial assessments, as with `windStretches`) also carries:

```json
"temperatureAlongRide": {
  "points": [
    [0, 7.4, 5.1, 10.1],
    [10, 7.8, 5.6, 10.4],
    [20, 8.2, 6.0, 10.6],
    …
    [265, 15.2, 14.8, 14.4]
  ],
  "feelsLikeBasis": "provider",
  "usual": { … }
}
```

Each point is `[minutesFromDeparture, airC, feelsLikeC, usualC]`, a fixed tuple like
`outline`, so a ride costs well under 1 KB.

| Element | Meaning |
| --- | --- |
| `minutesFromDeparture` | Minutes after `departureAt` (fractional at finish/extrema). The first point is `0`, the last is the finish (`finishAt`) |
| `airC` | Air temperature where the rider is at that time, to 0.1°C, using the v0.23 timing: linear interpolation between hourly readings for the route section the rider is on. At a section boundary, use the section being entered; at the finish, the last section's exit |
| `feelsLikeC` | Feels like, interpolated the same way (§2), or `null` when it isn't known for that point. Never fall back to air temperature silently |
| `usualC` | The estimated usual temperature at that local time of day (§4), or `null` when `usual` is `null` |

**Which points:**

- one every 10 minutes from departure (`0, 10, 20, …`), plus the finish;
- plus the time of the lowest and highest `airC`, and of the lowest and highest
  `feelsLikeC`, so the chart's extreme marker and the chip's range are exact;
- sorted by time, with one point per distinct offset.

The client finds crossing times by interpolating between points and rounds them to
10 minutes, so it doesn't need anything finer.

**Consistency:** the lowest and highest `airC` in the trace equal
`conditions.temperatureC.minimum` and `.maximum` for that departure. A gap the engine
treats as unknown (missing bracket, gap over an hour) is a point with `airC: null`
rather than a guess. The client breaks the line there.

`feelsLikeBasis` is `provider`, `derived` (§2), `mixed` (some locations each), or
`null` when no point has a feels-like value.

## 2. Feels like

- **Apple Weather:** `temperatureApparent`.
- **Met Office global spot:** `feelsLikeTemperature`.
- **Met Office (`met-office-bpf`):** the ensemble summary has no feels-like. Derive it
  from air temperature and the 10 m mean wind speed it already returns:
  - wind chill (JAG/TI, the formula the Met Office and Environment Canada use) when
    air is 10°C or lower and wind is above 4.8 km/h;
  - otherwise the air temperature. There's no humidity input, so no heat-index term.
    UK cycling temperatures make that a small loss.
  - Mark it `feelsLikeBasis: "derived"`.

Feels like is the forecast value for someone standing still. It doesn't include the
rider's own airflow (see decision 2).

If cached forecast snapshots don't keep these series today, bump the forecast cache
key rather than mixing snapshots with and without them.

## 3. Rain amount per ride hour

Add two fields to every newly computed conditions object, next to
`maximumPrecipitationRateMmH`, so they appear on each `rideHours[].conditions` and on
the departure's overall `conditions`:

```json
"maximumPrecipitationAmountMm": 2.4,
"precipitationAmountBasis": "hourly-accumulation"
```

- **`maximumPrecipitationAmountMm`**: for each observed route section, the provider's
  precipitation amount for the forecast hour containing the section's arrival time
  (sampled at the same points as rate and probability today). Take the maximum over
  the sections in scope, to 0.1 mm. This is "how much falls in an hour where the
  rider is", using the same "worst along the ride" convention as the maximum rate and
  probability. It isn't the total the rider gets wet with.
  - On the overall `conditions` it's the heaviest hour anywhere on the ride, which
    the client uses for `Drizzle` (under 1 mm).
- **`precipitationAmountBasis`**:
  - `hourly-accumulation`: the provider's hourly amount (Apple `precipitationAmount`,
    global spot hourly total);
  - `rate-estimate`: no amount from the provider, so rate × 1 hour (BPF's
    `lwePrecipitationRate` p50);
  - `mixed`: some of each.
- The probability stays `maximumPrecipitationProbability` (a fraction). The client
  shows chance and amount side by side, because they often disagree.
- Persisted ride-plan conditions accept both fields optionally, as with the v0.15
  summaries: old snapshots stay readable and new ones round-trip.

## 4. Usual temperature for the month

```json
"usual": {
  "month": 10,
  "averageHighC": 15.1,
  "averageLowC": 8.2,
  "bandHalfWidthC": 2.5,
  "differenceC": 1.8,
  "method": "monthly-diurnal-estimate",
  "coveredDistanceFraction": 1,
  "source": {
    "version": "…",
    "referencePeriod": "1991-2020",
    "statistics": ["maximum", "minimum"],
    "attribution": "Contains Met Office data licensed under the Open Government Licence v3.0.",
    "source": "…",
    "licence": "…"
  }
}
```

### Data

- Add the HadUK-Grid **monthly mean daily minimum** (`tasmin`) to the bundle, from the
  same dataset version, 1991–2020 period and 12 km cells as the existing maximum.
  That's 12 more values on each of the 1,707 cells. Extend the bundling script and
  `docs/seasonal-temperature.md`.
- Look it up **for every recommendation**, whatever `seasonalTolerance` is. It's
  display only. With `seasonalTolerance: "none"`, scores must not change.
- Containment only, as today. No nearest-cell guesses outside the grid.

### Fields

| Field | Meaning |
| --- | --- |
| `month` | Calendar month (1–12) of the departure's local date, in the recommendation's resolved time zone |
| `averageHighC`, `averageLowC` | That month's mean daily maximum and minimum, to 0.1°C. A distance-weighted mean over the route sections inside the grid. Use the **raw month value**, not the mid-month interpolation scoring uses, so it matches the "October average" label |
| `coveredDistanceFraction` | Share of route distance inside the grid |
| `bandHalfWidthC` | The band the client draws is `usualC ± bandHalfWidthC`. `2.5` for now |
| `differenceC` | Time-weighted mean of `airC` over the ride minus the time-weighted mean of `usualC`, to 0.1°C. The client rounds it for the headline: `n° warmer` above +1, `n° colder` below −1, otherwise `About usual` |
| `method` | `monthly-diurnal-estimate` (below). Lets real hourly normals replace it later without a contract change |
| `source` | The existing `climateSource`, now naming both statistics. The client must show the attribution wherever it shows `usual` |

`usual` is `null` when no route section is inside the grid. That includes every
route outside the UK. The client then leaves out the band, headline, sub-line, legend
item and footnote.

### The daily curve (`usualC`)

The design estimates the usual temperature at each time of day from the monthly
high and low. Put it in the API so every client draws the same band and makes the
same "warmer than usual" claim:

```text
h    = local time of day in hours (e.g. 08:30 → 8.5), in the resolved time zone
d(h) = 0                                 when h < 5 or h > 21
       (1 − cos(π (h − 5) / 10)) / 2     when 5 ≤ h ≤ 15   (rises to 1 at 15:00)
       (1 + cos(π (h − 15) / 6)) / 2     when 15 < h ≤ 21  (falls to 0 at 21:00)
usualC = averageLowC + (averageHighC − averageLowC) × d(h)
```

The local time comes from the same zone as `month`, so a ride across the clocks
going back (25 October 2026, Europe/London) follows the local clock.

## 5. Version, cache, docs and tests

- API version **0.35.0**. Scoring stays **comfort-v0.17**.
- Bump the persisted ranking key so cached rankings without the new fields aren't
  served. There's no algorithm change.
- All new fields are absent on older responses and saved plans. Clients treat a
  missing field as "not available".
- `docs/api.md`:
  - add a "Temperature and rain along the ride (v0.35.0)" section after "Condition
    chip summaries";
  - add the new fields to the departure table;
  - add a version entry.
- `docs/seasonal-temperature.md`: the minimum series, the display-only lookup and the
  daily curve.

**Tests:**

- **Trace shape.** First point `0` at departure, last at the finish, strictly
  increasing minutes, a point every 10 minutes, and one point per minute.
- **Trace extremes.** Trace air min and max equal `conditions.temperatureC`, and
  feels-like extremes are present as points.
- **Interpolation.** A point between two hourly readings matches the v0.23
  interpolation. An unknown gap gives `airC: null`, not a guess.
- **Feels like by provider.**
  - Apple and global spot pass through provider values.
  - BPF derived: 5°C with 20 km/h wind gives about 1.1°C. 12°C with 20 km/h, and
    5°C with 3 km/h, stay at air temperature.
  - A missing provider value gives `null`, not air temperature.
- **Rain amount by provider.** Apple's hourly amount passes through with
  `hourly-accumulation`. BPF gives rate × 1 h with `rate-estimate`. The overall
  conditions value is the maximum of the hours.
- **Usual values.** A known UK cell returns the bundled October high and low.
  - The curve gives the low at 05:00 and 21:00, the high at 15:00, and the low at
    03:00.
  - `differenceC` is time-weighted.
- **Usual coverage.** A route outside the UK gives `usual: null` and null `usualC`. A
  half-covered route gives `coveredDistanceFraction` 0.5 and the covered legs' mean.
- **Scores unchanged.** With `seasonalTolerance: "none"`, `usual` is still returned
  and the golden scenarios still pass.
- **Clocks going back.** A ride on 25 October 2026 uses the local hour for `usualC`.
- **Saved plans.** Plans without the new conditions fields still validate, and plans
  with them round-trip.

## Decisions to confirm with Dan

1. **Feels like for the Met Office choice: derive it with wind chill.**
   *Recommended*, because the chip colour and the panel sentence are judged on feels
   like. The alternative is `null`, which leaves riders on the Met Office choice
   with no feels-like line and a chip judged on air temperature.
2. **Feels like leaves out the rider's own speed.** *Recommended*: it matches what
   weather apps show, so the number looks familiar. Adding riding speed to wind chill
   would read several degrees colder and need explaining.
3. **The usual curve: the API computes the design's estimate.** *Recommended* over
   real hourly normals, which need hourly history per location that HadUK-Grid
   doesn't have (e.g. ERA5), and over a client-side formula, which every client would
   have to copy. `method` leaves room to upgrade.
4. **Outside the UK there's no usual for now.** *Recommended* until there's a licensed
   global climatology. cycle.travel routes outside the UK show the panel without the
   band and headline.
5. **Rain amount is the heaviest hour along the route, not a total.** *Recommended*:
   it matches the intensity bands (mm in an hour) and the existing "maximum" fields.

## Client follow-up (not API)

**Extension** (build follows this brief; ships against the optional fields):

- Rain chip and panel work today from `maximumPrecipitationProbability` and, until
  `maximumPrecipitationAmountMm` arrives, `maximumPrecipitationRateMmH` × 1 h.
- Temperature chip opens its panel once `temperatureAlongRide` is present. Until then
  it stays the current chip.
- The panel shows the climate attribution in its footnote whenever it shows `usual`.
- Only one panel per tile is open at a time (sky, temperature or rain), and there are
  no panels while paused.

**iOS/macOS app:** not designed yet. The same fields serve it.
