# Ride tracking API

API v0.28.0. Scoring remains `comfort-v0.17`. This release saves **one active plan per account**, preserves the recommendation the rider accepted, and supports explicit refreshes. It does not send notifications or run background checks. Tracking is separate from completed rides (`/rides`).

## Client flow

1. Request recommendations. Trackable candidates carry an opaque `recommendationRef` and `trackingAvailability: "available"`.
2. Read `GET /tracked-rides` for the current `trackingVersion` and `activeTrackedRideId`.
3. Submit the chosen reference with a fresh UUID `Idempotency-Key`. If replacing another plan, provide its ID and the current tracking version. Any confirmation belongs to the client.
4. Show the saved baseline and latest assessment separately. A successful save can return an unavailable latest forecast.
5. On reopening, read the record, then explicitly request refresh if appropriate. GET requests never fetch weather. Respect `refresh.refreshAt` and `Retry-After`.

All endpoints require the existing owner-bound session. Dates/times are UTC ISO instants; the original IANA `timeZone` is retained. Responses use `Cache-Control: no-store`.

## Recommendation references

References are attached to `/recommendations` ranking `best`, each `alternatives[]` candidate, and `days[].best`, and to `/recommendations/next-windows` `windows[].best`. Unranked partial assessments cannot be tracked.

The server persists the actual assessment before exposing a reference. Clients cannot submit scores or conditions. Each reference binds the owner, route/version, exact departure, original resolved preferences (including request overrides), weather provenance and original comparison scope. Main rankings retain the original selected dates; day-strip picks use their own day; each next-window pick uses that search's dates and window. Preview dates never enlarge the main scope.

References expire at their departure. Request a new recommendation after `422 RECOMMENDATION_UNAVAILABLE`. A reference is not a public share token and does not grant access to another account. Successful action retries remain valid after reference expiry or cleanup.

If snapshot storage fails or its bounds are reached, ordinary recommendations still succeed, with `recommendationRef: null` and `trackingAvailability: "unavailable"`. Do not manufacture a tracking payload from displayed values.

Unaccepted storage is bounded to 50 MB and 1,000 contexts per owner, 400 newly issued contexts per hour, 48 candidates per context, and 500 KB per context including candidates (context 200 KB, each candidate 80 KB). A request can issue several contexts for its distinct searches. Cleanup removes expired contexts in bounded batches during issuance; existing unexpired references are not evicted to make room. Accepted baselines are independent durable copies.

## Create or replace

```http
POST /tracked-rides
Idempotency-Key: <new UUID for this action>
Content-Type: application/json

{
  "recommendationRef": "<server-issued UUID>",
  "expectedTrackingVersion": 0,
  "replaceTrackedRideId": null
}
```

For replacement, use the active plan ID instead of `null`. This switches plans atomically: a database failure cannot stop the old plan without saving the replacement. The old plan becomes inactive with `endedReason: "replaced"`.

JSON responses contain `ride`, `outcome`, `replayed`, `replacedTrackedRideId`, `trackingVersion`, and `activeTrackedRideId`, with a `Location` header.

| Result | HTTP | Behavior |
| --- | --- | --- |
| New plan | 201 | `outcome: "created"` |
| Replacement | 201 | `outcome: "replaced"` |
| Same route/departure already active | 200 | `outcome: "existing"`; preserve its baseline and comparison |
| Same action key and body | 200 | `replayed: true`; return that action's record in its **current** state |
| Key reused with different body | 409 | `IDEMPOTENCY_CONFLICT` |
| Stale account version or replacement ID | 409 | `TRACKING_VERSION_CONFLICT`; reload current tracking |
| Action's record permanently erased | 409 | `TRACKING_ERASED`; never recreate it from a retry |
| Missing, foreign or departed reference | 422 | `RECOMMENDATION_UNAVAILABLE` |

The baseline is committed before attempting the latest forecast check. Forecast failure does not undo tracking. A delayed retry after untracking returns the inactive record, not a new plan. Tracking again intentionally requires a new action key and creates a new baseline. When replaying a historical action, use `activeTrackedRideId` to identify the current plan; the returned `ride` need not be that plan.

## Read and history

| Endpoint | Response |
| --- | --- |
| `GET /tracked-rides` | `{ rides: [summary], trackingVersion, activeTrackedRideId, capabilities, nextCursor }`; zero or one active summary |
| `GET /tracked-rides?state=inactive` | Retained stopped, replaced and expired summaries |
| `GET /tracked-rides?state=all` | All summaries |
| `GET /tracked-rides/{id}` | `{ ride, trackingVersion, activeTrackedRideId }`; complete baseline and latest assessment |
| `GET /tracked-rides/{id}/assessments` | `{ assessments: [{ id, createdAt, assessment }], nextCursor }`; distinct successful assessments |

Lists support `limit` (1–20, default 10) and opaque `cursor`. The plan list additionally supports `routeId`. Keep the same filters when following a cursor; invalid/mismatched cursors return `400 INVALID_CURSOR`. Ordering is creation time descending, then ID. Summaries contain identity, lifecycle, original score and refresh metadata; fetch detail for assessment contents. The immutable accepted baseline is in detail, separately from refresh history.

Foreign or absent records return `404 TRACKED_RIDE_NOT_FOUND` on detail, refresh and assessment history. A session cannot read another owner's references or history.

## Detailed record

`ride` contains:

- `id`, `routeId`, pinned `departureAt`, current estimated `finishAt`, original `timeZone`, `createdAt`, `version`.
- `state: "active" | "inactive"`, `endedAt`, `endedReason: null | "stopped" | "replaced" | "expired"`.
- Immutable `baseline: { context, pick: { routeId, candidate } }`.
- `latestAssessment`: the most recent successful snapshot, or `null`.
- `latestAssessmentKind: "current" | "last_known" | null`.
- `comparison`: current comparison, or `null` when the attempt failed, is in progress, or the pinned assessment has become stale.
- `lastKnownComparison: { asOf, comparison } | null`, explicitly historical when current comparison is unavailable.
- `refresh`: attempt/success timestamps and availability, described below.
- `capabilities: { maximumActiveRides: 1, manualRefresh: true, automaticChecks: false, notifications: false }`.

Each snapshot context stores schema/algorithm versions, generation time, original comparison inputs, route facts and versions/source hashes/geometry references, history context, provider-neutral weather provenance and attribution, comparison coverage and best-known ranking evidence. `pick.candidate` retains Conditions, recommendation priority, factor scores, conditions, standards and encounter-time evidence, ride hours, and route-scoped forecast details. No raw provider body or entire forecast horizon is stored.

## Refresh

```http
POST /tracked-rides/{id}/refresh
```

Returns `{ ride, trackingVersion, activeTrackedRideId }`. No body is required. Refresh uses the current saved preferences and latest course, with the accepted UTC departure, original time zone, comparison route IDs, calendar dates and riding window. Temporary recommendation overrides are not silently retained as saved intent. Shortlist changes and subsequent browsing do not change the cohort.

Exact-departure assessment shares the normal engine and one provider/cache/history pipeline with the comparison. It does not move onto a new grid slot or change scoring. The estimated finish follows the current course and speed even if weather cannot be assessed. The original finish and course facts remain in the baseline.

`refresh` includes:

| Field | Meaning |
| --- | --- |
| `result` | `not_checked`, `in_progress`, `assessed`, or `unavailable` |
| `reasonCode` | `null`, `route_unavailable`, `pinned_departure_no_longer_fits`, `forecast_unavailable`, `missing_elevation`, `refresh_failed`, `inputs_changed`, or `refresh_interrupted` |
| `lastAttemptAt` | Most recent attempt start; not evidence of success |
| `lastSuccessfulAssessmentAt` | Most recent successful assessment check, or `null` |
| `refreshAt` | Comparison forecast refresh time; `null` when full comparison evidence cannot be reused |
| `assessmentFreshUntil` | Freshness boundary for the pinned ride's own forecast |
| `closed` | Departure has arrived or the plan is inactive |

A usable pinned assessment with missing competitors can still expose a current **incomplete** comparison. Unknown competitors never imply that the ride remains Best Pick. Failed checks preserve the last successful snapshot as `last_known` and set the current comparison to `null`; they never imply unchanged conditions. Identical cached evidence reuses its stored assessment while updating the successful-check timestamp.

Overlapping refreshes return `409 REFRESH_IN_PROGRESS` with `Retry-After: 5`. A one-minute database lease bounds abandoned work. Publication verifies that the lease still belongs to this attempt, tracking is active, departure has not passed, and route/profile/history revisions have not changed. Stale results are discarded; `inputs_changed` asks the client to retry. Stopping, replacement or erasure cannot be undone by an in-flight refresh.

At departure, refresh returns `409 REFRESH_CLOSED` without weather calls. Inactive plans return `409 TRACKING_INACTIVE`. Between departure and estimated finish the plan remains active and its last pre-departure assessment remains readable. It is not live activity tracking or observed weather.

## Comparing with the decision

`comparison.scoreDeltaFromBaseline` always compares with the original accepted Conditions score, using API precision. `significantScoreChange` is true at an absolute difference of five points or more. A 73 → 70 → 67 sequence reports −6. Changes below five points are still retained in assessment history.

`standards` exposes the current status, all failures with units and encounter evidence, and `newlyFailing` standards relative to the original baseline. `unknown` and `not_configured` remain distinct from a confirmed pass. A newly configured limit can produce a new failure alongside a settings-change signal.

`bestPick` exposes:

- `coverage: "complete" | "incomplete"`.
- `originallyRecommendedRoute`.
- `routeStillRecommended` and `departureStillRecommended`: independent booleans, or `null` when not established.
- `lostOriginalBestPick`: false for a plan that was never the original recommended route, otherwise true/false/unknown.
- `bestKnown`: route ID, departure, Conditions score and recommendation priority.

Ordering uses minimum standards first, then recommendation priority (including opted-in tailwind opportunity), Conditions, physical assistance, departure and route ID. A known better candidate can establish a better option despite incomplete coverage. A better departure on the same course does not mean a different route has won. Elapsed options disappear without introducing new dates outside the saved selection.

`contextChanges` can contain `settings`, `routes`, `algorithm`, `history`, `weather_source`, `forecast_evidence`, and `comparison_options`. These identify changed inputs; they do not claim an exact numerical attribution of the score change to weather versus settings.

## Stop, expire and erase

`DELETE /tracked-rides/{id}` returns 204 and stops tracking, retaining the baseline and assessments. Repetition, including an unknown ID, also returns 204.

Plans become inactive at their current estimated finish without requiring a scheduled job. Reads derive expiry immediately; writes reconcile expired active slots transactionally. Expiry never marks a ride as completed, and an expired plan never reactivates automatically.

`DELETE /tracked-rides/{id}?permanent=true` erases an **inactive** plan and its assessments. Active plans return `409 TRACKING_ACTIVE`; stop first. Repeated erasure returns 204. Minimal opaque action tombstones remain to prevent replay resurrection. Shared routes, geometry and completed rides are untouched.

Removing a route from the shortlist does not stop tracking. A missing/deleted library course does not delete the plan or its history; refresh reports `route_unavailable`. Sign-out does not remove account-owned plans.

There is no account-deletion endpoint in the current API. A future account-erasure implementation must include all `tracking_*` tables and `tracked_rides` using the stable owner ID before removing its identity binding, including action tombstones and transient references. Do not cascade route deletion into retained tracking history.

## Follow-up release

Device registration, background checks, APNs, notification thresholds/cooldowns, quiet hours and evening-before messages are not implemented. Clients must respect the false capability flags and must not describe manual tracking as active notification monitoring. Future notification state must use a separate last-notified assessment; it must never rewrite the accepted baseline.
