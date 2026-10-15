# Seasonal temperature comfort (API v0.26.0)

`comfort-v0.16` adds two independent, explicit preferences under
`settings.preferences.temperature`:

| Field | Values | Default | Intent |
|---|---|---|---|
| `coldSensitivity` | `standard`, `high` | `standard` | How much being below the comfortable range matters. |
| `seasonalTolerance` | `none`, `cooler-winters` | `none` | Accept cooler temperatures when the local seasonal daytime reference is cooler. |

Neither is inferred from an ideal range, sunshine weight, location, account or
month. Existing profiles resolve to the defaults without a database rewrite.
An unrelated partial edit preserves both choices. Invalid values (including
null) are rejected. A temporary recommendation override does not save a choice.

For a rider who has explicitly chosen both:

```json
{
  "expectedVersion": 4,
  "settings": {
    "preferences": {
      "temperature": {
        "coldSensitivity": "high",
        "seasonalTolerance": "cooler-winters"
      }
    }
  }
}
```

Send this to `PATCH /users/me`, using the actual current version. The same
preferences object is supported by recommendation and next-window requests.
Read resolved choices from the existing user/settings and `resolvedPreferences`
responses. Clients should present separate choices, explain that seasonal
coverage is limited, and save only an explicit selection. They must not change
these fields when editing the ideal range or monthly minimum standards.

## Climate source and coverage

The bundled source is Met Office **HadUK-Grid v1.1.0.0**, **1991–2020** monthly
means of daily maximum air temperature, on its **12 km UK grid**. It is obtained
from the Met Office's public [Climate Data Portal dataset](https://www.arcgis.com/home/item.html?id=30bbaca9dbbd4f849252043788f37f41)
([source catalogue](https://catalogue.ceda.ac.uk/uuid/652cea3b8b4446f7bff73be0ce99ba0f)).

**Contains Met Office data licensed under the Open Government Licence v3.0.**
The [licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
and provenance accompany the bundled data and API assessment. Source citation:
Met Office; Hollis, D.; McCarthy, M.; Kendon, M.; Legg, T. (2022), HadUK-Grid
Gridded Climate Observations on a 12km grid over the UK, v1.1.0.0 (1836–2021).

Each route section uses its containing grid cell. There is no nearest-cell
extrapolation: outside the dataset (including coastal gaps), the section receives
no seasonal relaxation. Partial coverage is reported. Grid values are an
approximate local reference; this release does not interpolate between cells or
correct for route elevation. Monthly values interpolate between the 15th of each
month, including year boundaries and leap years, using the ride's local date.

These are **daytime seasonal references**, not hourly normals. A forecast of
7°C at 8am must not be described as unusually cold simply because the monthly
mean daily maximum is around 15°C. The model uses the baseline to express
seasonal tolerance, not to apply a second weather-anomaly penalty.

No extra weather requests, climate service dependency, or forecast-cache expiry
are required. `worker/scripts/import-seasonal-climate.ts` is an explicit
maintenance command, not a build/CI step. It validates the source's 1,707 cells,
records the downloaded response hash, and rounds coordinates to six decimals
and temperatures to three. Review data updates and increment the algorithm/data
version before release. The climate version participates in score-baseline keys.

## Calculation

Let `L` be the saved ideal minimum and `N` the local seasonal reference in °C.
With `cooler-winters`, lower the effective cold threshold by
`min(6, max(0, (L − N) / 2))` °C. Without an opt-in or usable climate cell, the
adjustment is zero. Never lower a hard minimum standard. The saved ideal band
and heat treatment are unchanged: every temperature inside the band is equally
comfortable, and cooler winters cannot make excessive heat acceptable.

For deficit `d = max(0, effectiveMinimum − forecastTemperature)`:

- `standard` retains the original linear cold loss `min(d / 10, 1)` and the
  existing 75% mean / 25% worst-section combination.
- `high` uses cold penalty `min(d / 10, 1) + 0.8 × (1 − exp(−d / 1.2))`.
  This applies an earlier loss of comfort as temperatures leave the ideal band,
  while retaining a gradual penalty for deeper cold. The loss is continuous.
  Average it across section distances and multiply by the normalized temperature
  weight and 100. At the model's constant speed this is also time weighting.
  Remove cold from the worst-section blend so a brief cold start is not counted
  again. Heat, rain, wind and sunshine keep their existing treatment.

The high setting can lose up to 1.8 times the normalized temperature share;
it deliberately increases cold importance without changing other saved weights.
Its displayed temperature comfort is `1 − coldPenalty / 1.8`, bounded 0–1;
the heat loss can still dominate. `factors.temperature` remains a 0–100 comfort
indicator, not a percentage of the final score. Zero temperature weight removes
all temperature score effects, while hard standards still apply. Final weather
scores remain 0–100. `pointsLost.temperature` recomputes the same departure with
both cold and heat idealized, including caps, route shares and ride history.

These constants are a versioned preference calibration, not a physiological
model. They are not inferred for other riders. No score is hardcoded for a
named route, month or departure time.

## Result explanation

Each assessed candidate adds `temperatureAssessment`:

- `coldSensitivity`, `seasonalTolerance`: the resolved choices.
- `idealRangeC: {minimum, maximum}`: the unchanged saved band.
- `effectiveMinimumC: {minimum, maximum}`: the range of adjusted thresholds
  across the route; uncovered sections retain the saved minimum.
- `seasonal.status`: `disabled`, `complete`, `partial` or `unavailable`.
- `seasonal.coveredDistanceFraction`: 0–1; zero when disabled.
- `seasonal.normalMaximumC`: the range of available seasonal references, or
  null with no coverage/disabled. This is not an observed forecast range.
- `seasonal.source`: version, reference period, statistic, source URL, licence
  and attribution; null when disabled.

Actual `conditions.temperatureC`, forecast details and hard-standard failure
evidence always retain the forecast temperatures. UI score explanations should
use `pointsLost`, with the assessment describing why seasonal tolerance applied.

## Calibration evidence

The saved 14 October route-wide forecast replay, with the interviewed 16–32°C
band, temperature/wind/dryness/sunshine weights 0.15/0.40/0.20/0.25 and explicit
tailwind preference, gives:

| Saved example | Legacy score | High cold sensitivity + cooler winters |
|---|---:|---:|
| Horsham, 17 October, 08:00 | 83.67 | **72.15** |
| Horsham, 17 October, 10:00 | 82.36 | **71.78** |
| Richmond, 17 October, 09:00 | 82.86 | **71.93** |
| Identical Horsham 08:00 weather moved to 17 January | — | **80.74** |

These are cached replay results, not a fresh production forecast or a claim to
reproduce the later screenshot exactly. The January comparison shifts the same
weather to the same local departure time; it is not a January weather prediction.
Horsham stays ahead of Richmond, and its best October departure remains 08:00.
The January target concerns that same 08:00 ride, not the best January departure.

Synthetic tests also preserve: 8°C sunny over 12°C sunny intervals; 14°C sunny
intervals over 8°C sunny; equal comfort within 16–32°C; and a four-hour ride with
30 minutes at 7°C followed by 3½ hours at 13°C over four hours at 10°C. Raw private
route/forecast snapshots are not committed.

A second replay on 15 October used the current production route records and 31
cached forecast snapshots (32 route locations), with no upstream weather calls:

| Current route | Legacy best | Seasonal best | Best local departure |
|---|---:|---:|---|
| Horsham (Road), 90.4 km | 84.19 | **72.82** | 08:30 |
| Richmond | 83.50 | **72.54** | 09:00 |
| Potters Bar | 76.83 | **65.67** | 08:00 |
| Braintree | 69.64 | **58.18** | 08:00 |

For this newer Horsham snapshot, 08:00 scores **72.69**, still ahead of 10:00 at
**71.85**; 08:30 is narrowly better. Moving its identical 08:00 weather to January
scores **81.77**. The original order is preserved. Integer cards can still show
Horsham and Richmond both as 73; the unrounded scores determine the order.

Validation: 257 unit tests and 184 real Worker/D1/KV integration tests pass;
the earlier cached legacy replay retains all 31 departure results. A local
synthetic 12-route, five-day benchmark evaluated 720 candidates in 2.25s cold /
1.70s warm, with zero upstream requests when warm. These are end-to-end local
wall times, not production CPU measurements.
