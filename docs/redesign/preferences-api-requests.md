# Preferences: API requests

What the iOS Preferences tab, Ideal Temperature and Comfortable Wind (`docs/redesign/README.md`
§5–7) still need from the API. The screens are otherwise live. They read `GET /users/me` and save
each edit with `PATCH /users/me` after a short pause, and Rides re-ranks once the save lands.

Seven requests, in priority order:

1. Strava connection status, last sync and average speed.
2. Points lost per factor, for "so it loses 2 points".
3. A decision on the gust limit: `comfortableGustKph` or `maximumGustKph`.
4. Crosswind Sensitivity as a preference level.
5. The sign-in provider in `/auth/me`, for "Apple Account".
6. Vary by Month as a seasonal floor the API works out.
7. A question about distance units.

## Already used (please keep stable)

| Field | Used for |
|---|---|
| `GET /users/me` → `user.version` | `expectedVersion` on every save |
| `user.settings.riding.averageSpeedKph` (5–50) / `departureStepMinutes` | Average Speed stepper, Try Departures Every |
| `user.settings.preferences.temperature.comfortMinC` / `comfortMaxC` | Ideal Temperature range and the "How Your Routes Fit" rows |
| `user.settings.preferences.wind.comfortableHeadwindKph` / `comfortableCrosswindKph` / `crosswindSensitivity` | Comfortable Wind envelope, sliders and picker |
| `user.settings.preferences.recentRides {mode, lookbackDays}` | Recently Ridden ("Prefer Variety", "Routes you rode in the last 28 days…") |
| `user.settings.preferences.climbing.preference` | Climbing menu |
| `user.settings.preferences.distance` (`{minKm, maxKm}` or `null`) | Distance screen. The app sends `null` to turn it off |
| `user.settings.preferences.minimumStandards` | Deal-Breakers. The app sends `null` to remove a limit and never sends `maximumPrecipitationRateMmH`, so it stays as saved |
| `minimumStandards.maximumPrecipitationProbability` (0–1) | Chance of Rain menu: Any, 20%, 40%, 60%, 80%. Any other saved value is kept and shown |
| `user.settings.units {temperature, windSpeed}` | Units section. The app writes both together |
| `user.preferenceLevels {sunshine, rain}` | Sunshine and Rain menus. The app never sends `custom`, so weights set elsewhere survive |
| `user.weatherProviderId` | Weather credit in the footer |
| `PATCH /users/me` deep merge, explicit `null` removes, 409 on a stale version | The app re-reads and re-sends once on 409 |
| `POST /recommendations` → `best.conditions.temperatureC`, `maximumHeadwindKph`, `maximumCrosswindKph`, `maximumGustKph` | "How Your Routes Fit" rows on both detail screens |

## 1. Strava connection

**Why.** The Connections section shows Strava "Connected" with "Routes and rides synced 08:10", and
Riding offers "Use My Strava Average, 21.4 km/h" when that differs from the saved speed. The API
has no Strava connection, so live accounts show "Not Connected" and no button. The old on-device
Strava client (`LiveStravaClient`, `StravaTokenManager`) never had a real client ID. The connection
should live in the API so the extension and the app share it.

**Shape.** Two read fields first. The connect flow can come later, and the app needs it before it
can offer a Strava screen.

```jsonc
// GET /users/me
"user": {
  // …existing fields
  "connections": {
    "strava": {
      "status": "connected",               // "connected" | "needs-reauthorisation"; the key is absent when never connected
      "athleteName": "Dan Barclay",         // optional, for a future Strava screen
      "lastSyncAt": "2026-10-14T07:10:00.000Z",  // or null before the first sync
      "averageSpeedKph": 21.4,              // or null when there aren't enough rides
      "averageSpeedRides": 23               // how many rides it came from
    }
  }
}
```

- **Average speed.** Total distance over total moving time for `Ride` and `GravelRide` activities in
  the last 90 days. Leave out virtual rides, e-bike rides, commutes, and rides under 10 km or under
  20 minutes. Return `null` with fewer than 5 rides. Don't write it into
  `riding.averageSpeedKph`: the rider chooses.
- **Later.** `POST /connections/strava` returns `{authorizeUrl}` for `ASWebAuthenticationSession`.
  `DELETE /connections/strava` disconnects. Synced routes go through the existing `strava` route
  source, and activities go into ride history.

**What the app does.** Today it hides the row's status and the button. Once this ships, it shows "Connected" or "Reconnect", and the subtitle "Routes and rides synced
08:10". It shows the average button only when the two speeds differ by more than 0.05 km/h. Tapping
it sets `riding.averageSpeedKph`, which saves as usual.

**Test.** Three 30 km rides in 1 h 30 min moving each, plus one 5 km ride. Expect
`averageSpeedKph: null` (only 3 qualifying rides). Add two more of the same and expect `20`.

## 2. Points lost per factor

**Why.** Ideal Temperature's footer reads "Hilly Loop reaches 27°, 3° over your range, so it loses 2
points." Comfortable Wind's footer does the same for wind. The app has `best.factors` (0–100 per
factor) but not how much each one costs the combined score. The weights and the distance and
climbing shares make that hard to work out in the app, so it stops at "so it scores a little lower".

**Shape.** One optional field on each `best` and each `alternatives[]` departure:

```jsonc
"best": {
  // …existing fields
  "pointsLost": {            // how much higher `score` would be if this factor were 100, all else equal
    "temperature": 2.1,
    "wind": 0.4,
    "dryness": 0,
    "clearSkies": 0,
    "sunshine": 0,
    "climbing": null,        // null when the factor is off
    "distance": null
  }
}
```

- Work it out by re-scoring with that one factor at 100. Don't multiply the gap by the weight, so
  that it stays right if the combination stops being linear.
- `recentRides.penaltyPoints` stays as it is.

**What the app does.** Once this ships, it rounds to whole points and adds ", so it loses 2 points" when the value is
at least 1. Below 1 it says "so it scores a little lower".

**Test.** Give a 10–22° range and a ride that peaks at 27° with every other factor at 100. Expect
`pointsLost.temperature` to equal `100 - score`, give or take 0.05.

## 3. The gust limit

**Why.** The design has one Gusts control. It's the dashed ring on the wind envelope, and a route
over it is "marked Below your minimums". So the app edits `minimumStandards.maximumGustKph`. The
engine also has `wind.comfortableGustKph`, the soft penalty, which has no control. Ride detail quotes
it: "Gusts reach 32 km/h, over your 25 km/h limit". A rider who sets Gusts to 55 can still read
"over your 35 km/h limit".

**Ask.** Please decide one of:

- **A (preferred).** When a patch sets `maximumGustKph` and doesn't mention `comfortableGustKph`,
  set the comfortable value to 80% of the limit, rounded to whole km/h. With no limit, leave it
  alone. The API keeps the relationship, and the app keeps one control.
- **B.** The app writes both: `comfortableGustKph = maximumGustKph × 0.8`. Tell me and I'll do it.

Either way, Ride detail will quote `maximumGustKph` when one is set.

**Test (A).** PATCH `{minimumStandards: {maximumGustKph: 50}}`, then expect
`wind.comfortableGustKph: 40`. PATCH `{minimumStandards: {maximumGustKph: null}}` and expect it to
stay at 40.

## 4. Crosswind Sensitivity as a level

**Why.** The design offers Low, Normal and High. The API takes a number from 0 to 10, and Dan's saved
value isn't one the app offers, so the picker shows "Custom". Sunshine and Rain already have
`preferenceLevels` for exactly this.

**Shape.**

```jsonc
"preferenceLevels": {
  "sunshine": "nice",
  "rain": "light-ok",
  "crosswind": "normal"      // "low" | "normal" | "high"; reads "custom" for anything else
}
```

- Proposed mapping: `low` = 0.5, `normal` = 1 (the default), `high` = 2. The v4 profile's 5 reads
  as `custom`. Change the numbers if the calibration says otherwise. The app only uses the words.
- Writing a level sets `wind.crosswindSensitivity`. Writing `custom` is rejected, as it is for
  sunshine and rain.

**What the app does.** It reads and writes `preferenceLevels.crosswind` in place of the number.
Until then it writes 0.5, 1 or 2, and shows "Custom" for anything else.

**Test.** PATCH `{preferenceLevels: {crosswind: "high"}}`, then expect
`wind.crosswindSensitivity: 2`. Set the number to 5 directly and expect `crosswind: "custom"`.

## 5. Sign-in provider

**Why.** The Account row reads "Apple Account · Signed In". `/auth/me` returns the Better Auth user
with no provider, so the app shows plain "Account".

**Shape.**

```jsonc
// GET /auth/me
"user": {
  // …existing fields
  "providers": ["apple"]     // linked account providerIds: "apple" | "google" | "passkey"
}
```

**What the app does.** Once this ships, it shows "Apple Account" when the list has `apple`, then "Google Account",
then "Account".

**Test.** For a user with an Apple account row and a passkey, expect `["apple", "passkey"]` in that
order (oldest link first).

## 6. Vary by Month

**Why.** The Never Colder Than deal-breaker has a "Vary by Month" switch, which accepts colder
starts in winter. The API only takes a full `monthly` table. The app guesses at one: the summer value
from April to October, 2° lower in March and November, and 4° lower from December to February. That
guess assumes the northern hemisphere, and the extension can't make the same table.

**Shape.** A third `minimumTemperature` kind, worked out per route from its latitude:

```jsonc
"minimumTemperature": { "kind": "seasonal", "valueC": 6 }   // valueC is the summer floor
```

- Proposed offsets: the summer floor in the warm half of the year, 2° lower in the shoulder months,
  4° lower in the three coldest. Flip by hemisphere. Within 15° of the equator, use `valueC` all
  year.
- `resolvedMinimumTemperature` should show the month's value and say it came from `seasonal`.

**What the app does.** Once this ships, it writes `{kind: "seasonal", valueC}` when the switch is
on and `{kind: "fixed", valueC}` when it's off. Until then it writes its guessed `monthly` table.
It reads `monthly` as on either way, with the warmest month as the summer value.

**Test.** Give `valueC: 6` and two rides on 15 January, one in London and one in Melbourne. Expect a
floor of 2° in London and 6° in Melbourne.

## 7. Question: distance units

The app's Wind Speed control (km/h or mph) also sets distances (km or mi). The API keeps these apart:
`units.windSpeed` and `display.unit`. Unless you object, the app will write `display.unit` with the
same choice, so the extension shows the same units.
