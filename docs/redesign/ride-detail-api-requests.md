# Ride detail: reviewed API contract

Reviewed against the Worker on 15 October 2026. API **v0.25.0** implements wind
bearing and comparable previous scores; scoring stays **comfort-v0.15**. Existing
fields remain stable. The iOS screen still needs to consume the additions and
apply the wording corrections below. No new endpoint is required.

## 1. Wind direction — implemented

Every assessed departure's `conditions` and every non-null
`rideHours[].conditions` includes:

```json
{ "windFromDegrees": 248 }
```

This is the meteorological **from** direction, clockwise from true north, rounded
to an integer from 0 through 359. The app can map it to a 16-point compass label
(248° is west-south-west). The field is nullable; historical saved plans may omit it.

The engine takes a distance-weighted circular mean of the route's sampled wind
vectors. It omits samples below 3 km/h from that directional mean, since a calm
sample has no meaningful direction. It returns `null` if the full ride/hour's
average speed is below 3 km/h or the directional resultant is below 0.3. Thus
350° and 10° average to 0°, opposing winds can yield `null`, and 359.8° rounds to
0°, never 360°. Hide the compass sentence when missing or null. This does not
change headwind, crosswind or tailwind scoring.

## 2. Previous score — implemented with stricter comparability

`rankings[].best` and `days[].best` can include:

```json
{ "previous": { "score": 81.7, "generatedAt": "2026-10-14T06:00:00.000Z" } }
```

`previous` is `null` on the first comparable evaluation. It refers to the earliest
stored evaluation **on the current local viewing day**, in the request's
`timeZone`, for that owner, route and departure date. It is a previous **daily
best** score, not the earlier score of this exact departure. The best time may
move within the same assessed set of departures. Multi-day results and
`POST /recommendations/next-windows` use the same comparison store.

The comparison must also match:

- Algorithm version and the route facts used by scoring (geometry, elevation,
  distance and weather locations).
- Effective preferences, riding speed, departure grid, ride window and time zone.
- Weather-selection policy, selected provider/product and forecast representation
  and freshness policy.
- Ride-history revision and assessment availability.
- The set of assessed departure/finish times. A passing slot or changed coverage
  must not masquerade as a weather improvement or deterioration.

Changes to those inputs establish a new baseline. Returning to an identical
context can reuse its earlier baseline that day. Display-unit edits and weather
value updates do not reset it. Merely changing the set of other compared routes
is not itself a reset. A new local viewing day always starts a new baseline.

Ordinary alternatives have `previous: null`. A multi-day alternative which was
itself a daily best may retain that day's comparison: display it only with the
same daily-best interpretation. Never carry the top choice's badge over to a
selected alternative.

Round both current and previous scores consistently, then show a signed change
only if their displayed difference is at least one. `generatedAt` is a UTC instant;
format the time in the response time zone. Missing/null history means no badge.

**Storage review.** The proposed `0008_ride_learning.sql` snapshot work is not on
main and is not a dependency. Standalone migration
`0009_recommendation_score_baselines.sql` stores only owner, route, a hashed
comparison key, score, generation time and expiry. Rows expire after 48 hours;
cleanup runs on subsequent requests from that owner, with a cap of 1,000 rows per
owner. Route deletion cascades. Concurrent requests keep the earliest generation
time even if they complete out of order. Storage failure hides the trend without
losing the current recommendation. No full forecast or route geometry is stored
in this table.

## 3. Unscored design factors — use option A

Explain the engine's seven existing factors: temperature, wind, dryness,
clearSkies, sunshine, climbing and distance. Do not invent scores for the four
extra design rows:

| Design row | Actual behavior |
|---|---|
| Time budget | Feasibility constraint; departures must fit the full ride in the window/daylight. |
| Surface match | Route evidence exists, but there is no bike-match scoring preference. |
| Intent | No saved riding-intent concept; climbing preference already affects climbing. |
| Novelty | Explain `recentRides.penaltyPoints` separately; do not count it twice. |

A non-null `factors` value does not necessarily mean its weight is active. Use
[`pointsLost`](preferences-api-requests.md#2-points-lost-per-factor--implemented)
for combined-score effects; null means inactive or insufficient evidence. Zero
means no recoverable points from that factor under this score combination.

## Stable inputs and required wording corrections

Continue reading `resolvedPreferences`, `weather.attribution`, `conditions`,
`rideHours`, `recentRides`, `distanceFit` and `drawbacks`. The additions above do
not rename or remove them. The review found these limits in the proposed copy:

- **Temperature:** first/last hourly `temperatureC` values are ranges over sampled
  sections, not exact departure/arrival temperatures. Say “During the first hour,
  9–11°C” rather than “Starts at 9°C”. Exact endpoint claims need separate evidence.
- **Wind location:** a whole-ride `windDistanceFractions.headwind` does not prove
  “headwind for the last 9 km”. Hourly summaries can support qualified hourly
  descriptions, not a continuous exact segment claim.
- **Gusts:** `maximumGustKph` in conditions is the raw forecast maximum. The soft
  `wind.comfortableGustKph` preference is compared against estimated adverse gust
  exposure, using prevailing direction. Compare raw maxima with
  `minimumStandards.maximumGustKph` for a hard-limit statement. A comfort setting
  is not a hard limit, and must not be presented as one when no maximum is set.
- **Units:** saved `settings.units` and `settings.display.unit` win over locale.
  Temperature, wind speed and distance are independent choices; API values stay
  metric. Use locale only as an initial choice when no saved preference exists.
- **Rain:** the highest local hourly probability is not a whole-ride probability.
- **Unsaved edits:** old board scores and `pointsLost` describe the preferences
  that generated that response. Wait for the newly evaluated response before
  attributing a score change to a preference edit.

Synthetic tests cover circular wind, calm samples, history persistence, owner
isolation, concurrent writes, expiry, changing weather, local midnight, expired
slots and reset conditions. Cached calibration replay verifies that these
explanations leave existing rankings unchanged.
