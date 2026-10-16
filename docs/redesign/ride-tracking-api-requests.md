# Ride tracking: API requests

**Implementation update — API v0.28.0:** the agreed [ride tracking API contract](../ride-tracking-api.md) supersedes the original proposal below. Track/untrack, atomic replacement, explicit refresh and retained history are ready. Use a server-issued `recommendationRef` and `Idempotency-Key`; do not submit a route/departure pair as a baseline. V1 permits one active plan, retains inactive history until explicitly erased, follows edited courses, freezes the original comparison dates/routes/window, and compares ±5 Conditions points with the immutable accepted baseline. The client owns confirmation. Device registration, background checks and notifications are still pending; gate all notification promises on the returned capabilities. The proposal's ten-plan limit, seven-day purge, cascading route deletion and mutable notification baseline were not adopted. Sections 2–4 below are future design input, not implemented endpoints or settled delivery policy.

What the Track sheet (`docs/redesign/README.md` §1, Track sheet) needs from the API. The hero's
star opens the sheet, and Start Tracking turns the star gold. The rider is promised a notification
if the forecast changes before they leave, plus a final forecast the evening before. The app now
tracks through v0.28.0 (`RideTracker`, #184) and checks when the Tracking sheet opens. Nothing
is watched in the background and no device token is sent, so the sheet drops its notification
copy while `capabilities.notifications` is false.

Seven requests, in priority order:

1. Tracked rides: create, list and delete.
2. Device tokens for push notifications.
3. A watcher that re-checks tracked rides and decides when to alert.
4. Notification payloads and copy.
5. Last-checked time and change status for the Tracking sheet.
6. Lifecycle: expiry, deleted routes, sign-out, account deletion.
7. Open questions.

## What the sheet promises

These are the rows the rider reads, so they're the contract. A row only shows when its limit is
set, and an alert should never fire for a limit the rider hasn't set.

| Row | Shown when | Alert when |
|---|---|---|
| Rain moves in | Always | Rain becomes likely during the ride (§3) |
| Gusts pass your 45 km/h limit | `minimumStandards.maximumGustKph` is set | The worst gust on the ride goes over it |
| It drops below your 4° minimum | `minimumStandards.minimumTemperature` resolves for the ride's month | The ride's lowest temperature goes under it |
| A better time or day opens up | Always | Another departure of the same route clearly beats it (§3) |
| Plus the final forecast the evening before | Always | Once, the evening before the ride's day |

## 1. Tracked rides

**Why.** Start Tracking, Stop Tracking and the star's state on launch.

```http
POST /tracked-rides
Authorization: Bearer <token>
Content-Type: application/json

{ "routeId": "…", "departureAt": "2026-10-14T08:00:00.000Z" }
```

- Returns `201` with `{ "trackedRide": … }`. The API re-assesses that route and departure with the
  rider's saved preferences and stores the result as the baseline. It doesn't trust a score the
  app sends.
- Idempotent per rider, `routeId` and `departureAt`: a repeat returns `200` with the existing
  ride, so a retried tap can't make two.
- `404` for a route the rider doesn't own. `422` when the departure has passed or is outside the
  forecast.
- Tracking pins the departure the rider chose. If the API later prefers 09:30, the tracked ride
  stays at 09:00 and that becomes a "better time" alert, not a silent move.

```http
GET /tracked-rides
```

Returns `{ "trackedRides": [ … ] }`: the rider's rides that haven't finished yet, soonest first.
The app calls it when Rides loads and matches picks on `routeId` + `departureAt` to set each star.

```http
DELETE /tracked-rides/{id}
```

Returns `204`. Stop Tracking. Deleting one that's already gone is also `204`.

```jsonc
// trackedRide
{
  "id": "uuid",
  "routeId": "…",
  "departureAt": "2026-10-14T08:00:00.000Z",
  "finishAt": "2026-10-14T11:00:00.000Z",
  "timeZone": "Europe/London",
  "createdAt": "2026-10-13T19:02:00.000Z",
  "baseline": { "score": 86, "standards": "meets", "assessedAt": "…" },
  "latest":   { "score": 84, "standards": "meets", "assessedAt": "…" },
  "lastCheckedAt": "2026-10-13T21:00:00.000Z",
  "status": "unchanged",            // §5
  "changes": [],                    // §5
  "betterOption": null              // or { "departureAt": "…", "score": 92 }
}
```

## 2. Device tokens

**Why.** Alerts go out over APNs. Both apps carry the push entitlement: `aps-environment` on iOS
and `com.apple.developer.aps-environment` on macOS.

```http
PUT /devices/{apnsToken}
Content-Type: application/json

{ "platform": "ios", "environment": "development", "bundleId": "com.danbarclay.rideon", "locale": "en-GB" }
```

- Upsert on the token. The app sends it after each launch's `registerForRemoteNotifications`, so
  `200` with no body is enough. `platform` is `ios` or `macos`.
- `environment` is `development` for Debug builds (APNs sandbox) and `production` for TestFlight
  and the App Store. Send each token to the matching APNs host. A token sent to the wrong one
  fails with `BadDeviceToken`.
- `DELETE /devices/{apnsToken}` returns `204`. The app calls it on sign-out, before the session
  ends.
- Remove a token when APNs answers `410 Unregistered` or `400 BadDeviceToken`.
- Alerts go to every device the rider has registered.
- Use token-based APNs auth: a `.p8` key for team `R2GGK3VN2C`, with the key ID and key held as
  Worker secrets. The topic is the bundle ID. Dan needs to create the key at
  developer.apple.com → Keys.

## 3. The watcher

**Why.** This is the whole feature.

**When.** Use a Cron Trigger. An hourly run is enough: forecasts don't move faster than that.
Skip a ride whose last assessment's `weather.refreshAt` hasn't passed, so a check only costs
something when the forecast could have changed. Rides on the same route share weather.

**How.** Re-assess the tracked route and departure with the rider's **current** saved preferences:
a limit set after tracking started counts from the next check. Compare against the state the rider
was **last told about**. That's the baseline at first, and it moves each time an alert goes out,
so the same news is never sent twice.

- **Rain moves in.** If the rider has `maximumPrecipitationProbability` or
  `maximumPrecipitationRateMmH`, use those. Otherwise use a 50% chance of rain at any point on the
  ride. Alert when the ride crosses the threshold and the last-told state didn't. Missing data is
  never rain: an unassessable check alerts nothing.
- **Gusts and cold.** Alert when `best.standards` gains a `maximumGustKph` or
  `minimumTemperature` failure that the last-told state didn't have. Use the failure evidence (the
  limit and the worst actual value) for the copy. Keep `maximumTemperatureC` out for now: the
  sheet doesn't promise it.
- **A better time or day.** Look for a departure of the **same route** in the rider's saved
  planning window (`settings.planning`, which the Rides tab already saves). Alert when one meets
  every set standard and either scores at least 10 points more than the tracked departure's latest
  score, or the tracked departure now fails a standard. Alert once per better option. A different
  option is new news.
- **Evening before.** At 19:00 in the ride's time zone the day before, send the final forecast
  even if nothing changed. Skip it if the ride was tracked after 19:00 that evening or on the day
  itself.
- **Clearing.** Don't alert when a problem clears. The evening-before forecast and the sheet's
  status cover it. Do update the last-told state, so a second spell of rain is new news.

**Rate limits.**
- Merge everything one check finds for a ride into one notification.
- Send at most one change alert per ride every 3 hours. The evening-before forecast doesn't count
  towards that.
- No alerts between 21:30 and 07:00 in the ride's time zone. If what was held is still true at
  07:00, send it then, unless the ride has already started.

## 4. Notification payloads

```jsonc
{
  "aps": {
    "alert": {
      "title": "Rain Moving In",
      "body": "Hilly Loop, Wed 09:00: 60% chance of rain from 10:30."
    },
    "sound": "default",
    "thread-id": "tracked-ride-<id>"
  },
  "trackedRideId": "…",
  "routeId": "…",
  "departureAt": "2026-10-14T08:00:00.000Z"
}
```

- `thread-id` groups a ride's alerts. The custom keys let a tap open Rides on that ride.
- Use the rider's saved `settings.units` and their time zone. Use title-case titles and one-sentence
  bodies, the same voice as the sheet.
- Use the default interruption level. Time Sensitive needs another entitlement, so don't use it
  for now.

| Trigger | Title | Body |
|---|---|---|
| Rain | Rain Moving In | Hilly Loop, Wed 09:00: 60% chance of rain from 10:30. |
| Gusts | Gusts Over Your Limit | Hilly Loop, Wed 09:00: gusts up to 52 km/h, over your 45 km/h limit. |
| Cold | Colder Than Your Minimum | Hilly Loop, Wed 09:00: down to 2°, below your 4° minimum. |
| Better option | A Better Time Opened Up | Hilly Loop scores 92 on Thu at 10:00, up from 78 for Wed at 09:00. |
| Several at once | Forecast Changed | Hilly Loop, Wed 09:00: rain likely from 10:30 and gusts up to 52 km/h. |
| Evening before | Tomorrow's Ride | Hilly Loop at 09:00 scores 86: dry, 12–16°, light winds. |

## 5. Status for the Tracking sheet

**Why.** Reopened, the sheet says "Forecast checked 10 minutes ago. Nothing has changed since you
started tracking." That's sample copy until `lastCheckedAt` exists.

- `lastCheckedAt`: the time of the last re-assessment. It's `createdAt` until the first check.
- `status`:
  - `unchanged`: no trigger has fired since tracking started.
  - `changed`: a trigger fired and is still true.
  - `better_option`: `betterOption` is set.
  - `unassessable`: the last check had no usable forecast.
- `changes[]`: what's true now, in the alert copy. For example, `{ "kind": "rain", "message":
  "60% chance of rain from 10:30." }`, where `kind` is `rain`, `gusts` or `cold`. The sheet lists
  these in place of "Nothing has changed".

## 6. Lifecycle

- **Finished rides.** Stop checking a ride once `departureAt` passes. Drop it from
  `GET /tracked-rides` once `finishAt` passes, and delete it after 7 days.
- **Deleted routes.** Deleting a route deletes its tracked rides, without an alert.
- **Sign-out.** The app deletes its device token (§2). Tracked rides stay with the account, so
  signing in again on another device shows the same gold stars.
- **Account deletion.** Remove the rider's tracked rides and device tokens with everything else.
- **Limit.** Allow at most 10 tracked rides per rider at once. Above that, return `409` with a
  readable message. The app has no screen for it yet, so this is only a guard.

## 7. Open questions

- **Other routes.** "A better time or day" is the same route only. Should a better **route** alert
  too? It isn't proposed: that's what Rides is for, and it would be noisy.
- **Thresholds.** Are the defaults right: the 50% rain fallback, 10 points for a better option,
  3 hours between alerts, and quiet hours from 21:30 to 07:00? They could become preferences
  later. Don't add them now.

## Client work once this lands

- Load `GET /tracked-rides` with the board and replace the in-memory `Set`.
- Start and Stop Tracking call `POST` and `DELETE`. Turn the star back off if the call fails.
- Register for remote notifications after permission is granted, then `PUT /devices/{token}`.
  Delete the token on sign-out.
- Handle a notification tap: open Rides on the payload's `routeId` and `departureAt`.
- Fill the Tracking sheet's subtitle from `lastCheckedAt`, `status` and `changes`.
