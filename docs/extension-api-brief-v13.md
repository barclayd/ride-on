# Extension API brief v13: keep the time fixed on a ride with alerts

Against API **0.38.0**, algorithm **comfort-v0.17**. No scoring or algorithm change.
Only the ranking of the route with alerts changes.

Design handoff v11 (30c, 30d) fixes the tile of a ride with alerts on the day and time
the rider set alerts for:

- **Tile:** it stays on that slot instead of moving to the route's best one. Its score,
  chips and detail panels keep updating for that slot.
- **Better slot:** when another slot on the route scores at least 5 points more inside
  the rider's window, the tile suggests it with **Move alerts**. The design calls this
  "the same event" as the `A better time or day opens up` notification.
- **What we're tracking:** a popover with the slot, the switches that are on and when
  alerts arrive. It has two buttons:
  - **Change alerts** edits the switches and keeps the slot.
  - **Turn off alerts** stops the plan. The tile moves to the best slot on the next
    refresh.

The design asks us not to fake this on the client by overriding best-slot data. The
server sends the notifications, so the server has to use the same slot.

Most of this exists already. The plan pins `departureAt`, and monitoring, the 18:00
summary and the stop time all use it. Two things are missing:

- `POST /recommendations` re-picks every route's best slot, including the route with
  alerts.
- There's no way to change switches without a new plan, which would reset the
  baseline and monitoring.

The design's `alertSlot`, `betterSlot` and `stale` names map to `trackedDeparture`,
`betterDeparture` and `status: "unavailable"` below.

## 1. `POST /recommendations`: the tracked departure

This applies when the account has an active plan (`state: "active"`, not
`refresh.closed`) and its route is in `routeIds`. It changes that route's top-level
`rankings[]` or `unranked[]` entry.

### `best`

`best` is the plan's pinned departure, assessed now:

- **Inputs:** this request's effective preferences (including overrides), weather
  provider and the route's current version. This is the same exact-departure
  assessment that refresh does.
- **Detail:** the full candidate, the same as any `best`: `conditions`, `standards`,
  `rideHours`, `windStretches`, `temperatureAlongRide`, `sunshineAssessment`,
  `recentRides` and a fresh `recommendationRef`.
- **Outside the window:** keep it even when the pinned departure falls outside the
  requested days or window. The design keeps the fixed tile when the rider changes
  the window. Don't clip it to the window.
- **Verdict:** `status` and `verdict` describe the pinned departure.

The entry also gains a marker:

```json
"trackedDeparture": {
  "trackedRideId": "…",
  "departureAt": "2026-10-20T09:30:00Z",
  "finishAt": "2026-10-20T11:15:00Z",
  "status": "assessed",
  "reasonCode": null
}
```

- **`status: "unavailable"`:** the pinned departure can't be assessed now, for example
  when the forecast doesn't cover it. Return `best: null`, the verdict as for any
  unassessable route, and a `reasonCode` from refresh's list
  (`forecast_unavailable`, `pinned_departure_no_longer_fits`, `route_unavailable`,
  `missing_elevation`). Never fall back to another departure. The extension shows the
  slot from the marker with no score.
- **`finishAt`:** the current estimated finish, as on the plan.

### Ranking and scores

- **Ranking:** order `rankings[]` and choose `recommendation` (Best pick, Best
  available) and `minimumStandardsStatus` using the pinned departure, as if it were
  the route's only candidate. The tile with alerts can then lose Best pick to
  another route, which is the honest answer.
- **Unchanged:** `days[]` previews and `alternatives[]`.
- **`scoreChange`:** for this route, compare the pinned departure's score. Fixing,
  releasing or moving the slot changes the assessed departure set. That's a quiet
  rebase under the v0.36.0 rules: no badge for the jump, and the last badge stays.
- **`weather.refreshAt`:** also covers the pinned departure's forecast.

### `betterDeparture`

The same entry gains `betterDeparture: Departure | null`. It's the route's best
candidate inside this request's scope (its days and window, as rankings use today)
that meets all of the following:

- It's fully assessed and meets all minimums.
- It isn't the pinned departure and hasn't passed.
- It scores at least **5** Conditions points more than the pinned departure, or the
  pinned departure fails a minimum.

Among several, pick the one rankings would pick. It carries a `recommendationRef`
but no `scoreChange`. When the pinned departure is unavailable, return `null`: an
unknown score can't establish a better one, as in monitoring.

## 2. `better_option` matches the tile

The tile's suggestion and the `betterTime` notification are meant to be one event.
Today `better_option` also fires for another shortlisted route, but the switch says
"A better time or day opens up" and the tile only ever suggests its own route.

**Proposal:** restrict `better_option` to other departures on the tracked route,
keeping its current rule (original scope, ≥5 points or resolving failed minimums). A
different route winning stays quiet, as a ranking shuffle does today. The copy names
the new slot, for example "A better time for Hilly Loop: Tue 20 Oct, 10:00 scores
82".

## 3. `PATCH /tracked-rides/{id}`: change switches

This is the optional §6 from brief v11, now needed for **Change alerts**.

```http
PATCH /tracked-rides/{id}
Content-Type: application/json

{
  "expectedTrackingVersion": 7,
  "alerts": { "triggers": { "rain": true, "wind": false, "cold": true, "betterTime": true } }
}
```

- **Validation:** the body is strict, `triggers` has all four booleans, and at least one
  is true. Otherwise `400 VALIDATION`.
- **What it keeps:** the baseline, departure, comparison, monitor state and notification
  reference. Disabled reasons already keep their references current, so switching one
  back on doesn't replay old changes.
- **Version:** it bumps `trackingVersion`, so a stale write from another device is
  refused.
- **Retries:** when the stored triggers already match the body, return 200 without
  checking or bumping the version. A retry after a lost response then succeeds.
- **Response:** `{ ride, trackingVersion, activeTrackedRideId }`, as `GET
  /tracked-rides/{id}` returns.
- **Errors:**
  - `409 TRACKING_VERSION_CONFLICT` for a stale version.
  - `409 TRACKING_INACTIVE` for a stopped, replaced or departed plan.
  - `404 TRACKED_RIDE_NOT_FOUND`.

## 4. Move alerts: no change

**Move alerts** uses the existing `POST /tracked-rides`:

- `recommendationRef`: from `betterDeparture`.
- `replaceTrackedRideId`: the current plan.
- `alerts.triggers`: the current plan's switches.

Undo posts the previous pinned departure's reference the same way. References stay
valid until their departure. Each move creates a new baseline, which is what the
rider asked for.

A reference issued for a pinned departure outside the request's window (§1) must
still be trackable, for example after Turn off alerts and Undo. Its comparison scope
is the request's dates and window, plus that departure.

## 5. Capabilities

`GET /tracked-rides` and the ride's `capabilities` gain:

```json
"fixedDeparture": true,
"alertEdits": true
```

- **`fixedDeparture`:** the extension shows the fixed tile, the popover and the
  better-slot suggestion, and the 30d dialog copy ("Alerts lock this day and time"),
  only when this is `true`. Until then it keeps today's behaviour. Ship it in the same
  release as §1, never before.
- **`alertEdits`:** the extension offers **Change alerts** only when this is `true`.
  Ship it with §3.

## 6. Unchanged

- One active plan per account. Confirming on another ride moves the alerts.
- `POST` and `DELETE /tracked-rides` semantics, reference expiry and idempotency keys.
- Monitoring of the pinned departure, the 18:00 summary and stopping at departure.
- `/recommendations/next-windows`, push registration and delivery.

## 7. Tests, docs and version

- **Version:** the next minor, API **0.40.0** if brief v12 (notification switches for
  each device) ships first as 0.39.0. The two briefs are independent. The algorithm
  stays `comfort-v0.17`.
- **Docs:** update `docs/api.md` (the ranking entry, `PATCH` and the capabilities),
  `docs/ride-tracking-api.md` and `docs/ride-monitoring.md` (`better_option`).
- **Tests:**
  - The pinned departure is `best` for the tracked route, inside and outside the
    window. Other routes are unchanged.
  - Ranking order and `recommendation` follow the pinned score.
  - The `trackedDeparture` shape, and `unavailable` giving `best: null` with the
    marker.
  - There's no pinning for inactive, closed or departed plans, routes not in the
    request, or another account's plan.
  - `betterDeparture`:
    - present at +5 and absent at +4;
    - present when only the pinned departure fails a minimum;
    - never the pinned departure;
    - `null` when the pinned departure is unavailable;
    - its reference can be tracked as a replacement.
  - `scoreChange` quietly rebases on fixing, releasing and moving.
  - `PATCH`:
    - the round trip and the version bump;
    - a stale version gives 409;
    - a matching retry gives 200;
    - an inactive plan gives 409;
    - validation gives 400;
    - monitor state is kept.
  - `better_option` only for the tracked route, if confirmed (§2).
  - The capabilities include `fixedDeparture` and `alertEdits`.

## 8. Extension follow-up (done)

Done in the extension's fixed-time PR, all behind `fixedDeparture`:

- **Tile:** reads `trackedDeparture` and `betterDeparture`. It shows the fixed pill and
  the popover, and the slot without a score when it's `unavailable`. The bell opens
  the popover instead of turning alerts off.
- **Move alerts:** posts `betterDeparture.recommendationRef` as a replacement with the
  current switches, and shows the new slot at once. Undo moves it back.
- **Change alerts:** sends `PATCH` once `alertEdits` is `true`, and keeps the slot.
- **Turn off alerts:** today's `DELETE` with Undo. The tile moves on the next refresh.
- **Rankings cache:** the extension's cache key includes the active plan, so a change
  on another device ranks again.
- **29c dialog:** shows the fixed pill, the note and a bell on the button.

Once the API ships, the extension needs no further change.

## Open questions

1. **`better_option` scope:** only the tracked route (§2, proposed), or keep other
   routes?
2. **Which window:** the tile's `betterDeparture` uses the current request's window,
   while monitoring uses the plan's original scope. They differ once the rider edits
   their window. Proposal: accept that. The notification follows the plan, and Move
   alerts makes a new plan with the current window.
3. **Inputs:** the tile scores the pinned departure with the request's overrides, while
   monitoring uses saved preferences. This is the same split as today's tracked
   ride. Proposal: accept it.
