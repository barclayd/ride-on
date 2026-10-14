# Ride detail: API requests

What the iOS Ride detail screen (`docs/redesign/README.md` §2) still needs from `POST /recommendations`.
The screen is otherwise live. It reads the multi-day response the Rides tab already loads
(`routeIds`, `days`, `previewDays: 7`, `riding.window`), so every request below concerns that
response. No new endpoint is needed.

Three requests, in priority order:

1. Wind direction, for "Wind from the west-south-west."
2. The previous score, for "▲ 4 since 07:00".
3. A decision on the four factors the design shows but the scorer doesn't have.

## Already used (please keep stable)

The app now builds its own notes and factor sentences from these fields, so structured drawbacks
aren't needed. Please don't rename or drop these in the multi-day response:

| Field | Used for |
|---|---|
| `resolvedPreferences.temperature.comfortMinC` / `comfortMaxC` | "Starts at 11°, 5 degrees under your ideal range." / "Your ideal range is 16–24°." |
| `resolvedPreferences.wind.comfortableHeadwindKph` / `comfortableCrosswindKph` / `comfortableGustKph` | "Headwind for the last 9 km.", "Gusts reach 32 km/h, over your 25 km/h limit." |
| `weather.attribution[] {text, url}` | The footer: "Powered by Met Office data", or "Apple Weather · Other data sources" |
| `best` / `alternatives[]` → `conditions.maximumHeadwindKph`, `maximumCrosswindKph`, `maximumGustKph`, `gustExposure.maximumAdverseKph`, `windDistanceFractions`, `precipitationSummary`, `maximumPrecipitationProbability`, `temperatureC` | Notes, the Wind/Rain/Temperature sentences, the verdict chips |
| `rideHours[] {start, end, conditions}` | The forecast grid and the wind strip under the elevation profile |
| `recentRides.penaltyPoints` | "You've ridden these roads recently, so it loses 3 points." |
| Route result `distanceFit {status, deviationKm}` | "6 km longer than your preferred distance." |
| `drawbacks[]` | Fallback only, when `resolvedPreferences` is missing |

## 1. Wind direction

**Why.** The forecast card ends with "Wind from the west-south-west." Today the app hides the line
because conditions carry no direction. The engine already fetches `windDirection` (it's in
`requiredWeather`, and BPF gives an ensemble mean), but it only uses it to split the distance into
head, tail and crosswind.

**Shape.** Add one optional field to `conditionsSchema` (`worker/src/recommendations/conditions.ts`),
so it appears on every departure's `conditions` and on every `rideHours[].conditions`:

```jsonc
"conditions": {
  // …existing fields
  "windFromDegrees": 248   // 0–359, meteorological "from" direction, true north; null when calm or unknown
}
```

- Use the distance-weighted circular mean of the samples along the ride: average the unit vectors,
  then `atan2`. Don't take the arithmetic mean of the degrees, because 350° and 10° must average
  to 0°, not 180°.
- Return `null` when the mean vector is short (resultant length under about 0.3, meaning the wind
  swings round), or when the average wind is under about 3 km/h. The app then hides the line.
- Round to whole degrees.

**What the app does.** It maps degrees to a 16-point compass word (248° → "west-south-west") and
shows "Wind from the west-south-west." under the grid for the selected departure. Per-hour values
aren't shown yet. They're cheap to include, though, and would let the grid's wind column get an
arrow later.

**Test.** Give a fixture with winds of 350° and 10° along the ride. Expect `windFromDegrees: 0`, not 180.

## 2. Previous score

**Why.** The verdict card shows "▲ 4 since 07:00 · last ridden 29 Sep". It tells the rider whether the
forecast is moving for or against the ride. The API keeps no earlier result today, so the app hides
the badge.

**Shape.** Add one optional field to each route result's `best` (and to `days[].best`):

```jsonc
"best": {
  // …existing fields
  "previous": { "score": 81.7, "generatedAt": "2026-10-14T06:00:00.000Z" }  // or null
}
```

- **What to compare.** The same user, the same route, and the same calendar day of departure. The
  departure time can differ, so if the best slot moved from 09:00 to 09:30 it still counts.
- **Which earlier result.** The earliest recommendation generated today (in the response
  `timeZone`) that contains that route and day. That gives "since 07:00" when the rider first
  looked at 7 am, and it stays stable across reloads. Otherwise every refresh would show "▲ 0
  since a minute ago".
- **When to return `null`.** When no earlier result exists today, or when the user's preferences or
  ride window changed since that result. A change there means the scores aren't comparable.
- **Storage.** The in-progress `recommendation_snapshots` table (migration `0008_ride_learning.sql`)
  looks like the natural place to read from. The app only needs the score and time, not the
  snapshot.

**What the app does.** It rounds both scores. It shows "▲ N since HH:mm" (or "▼ N") when the
difference is at least 1, and hides the badge otherwise.

## 3. Factors the design shows but the scorer doesn't have

**Why.** "Why It Scored 87" should explain the actual score. The app shows one row per non-null
`factors` key (distance, climbing, sunshine, clearSkies, temperature, wind, dryness). The design
also lists four factors the engine doesn't score:

| Design factor | Design sentence | What exists today |
|---|---|---|
| Time budget | "About 3 hours. You're back by 12:00, long before sunset at 18:04." | A hard constraint only: a departure that doesn't fit the window is `no_feasible_departure`. There's no score. |
| Surface match | "Sealed roads all the way, right for your road bike." | The route has `surfaceSummary`. There's no bike type in preferences and no score. |
| Intent | "You wanted a steady ride. 640 m of climbing makes it a harder one." | There's no intent concept in preferences. `climbing` partly covers it. |
| Novelty | "You rode it 15 days ago, on 29 September." | The `recentRides.penaltyPoints` penalty. The app now shows it as a note. |

**Decision needed** (product, not just API). One of:

- **A. The design drops them** *(recommended for now)*. The app keeps showing the API's seven factors.
  Novelty is already explained by the recent-rides note, and Time budget is already enforced.
  Nothing is needed from the API.
- **B. The API scores some of them.** Each one becomes a 0–100 entry in `factors` with a weight in
  preferences, the same as the existing ones. Novelty is the cheapest, because `recentRides` already
  computes it. Surface match needs a bike type in user settings first. Time budget and Intent need
  new preference concepts. Tell me which to add and the app will show them with no other API work.

## Not needed

- **Structured drawbacks.** The app builds its notes from `resolvedPreferences` and the conditions.
- **Start and finish temperatures.** These come from the first and last `rideHours`.
- **Display units.** The app formats with the device locale for now. If `settings.display`
  (°C/°F, km/h/mph) should win over the locale, that's a client change.
