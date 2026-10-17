# Ride history and recently ridden roads

API v0.12.0, algorithm `comfort-v0.9`, 11 October 2026. This contract extends
`api.md` and `planning-api.md`. Apply `0005_rides.sql` and `0006_ride_plans.sql`
before deploying this version. v0.12 adds optional planned recommendation
snapshots and complete per-route history summaries; see the
[reviewed extension contract](extension-api-brief-v3.md).

## Agreed product behaviour

- A rider can mark a saved route as ridden, choose the date, and undo a mistake.
  This assumes they followed the entire saved route. No additional GPX is needed.
- Ride history belongs to the authenticated user, independently of their login
  provider and whether a route remains on their recommendation shortlist.
- Users can choose whether recently ridden roads lower recommendations. History
  is still recorded when that preference is disabled.
- Repetition has a modest influence: better riding conditions should usually win.
- Its effect fades over four weeks. The same roads count in either direction.
- Different route IDs can overlap. Sharing a short stretch should matter much
  less than repeating most of the proposed ride.
- The MVP does not detect partial completion or detours. Saved route geometry is
  an assumption about the ride, not a verified activity recording.

The initial maximum deduction is 10 points. It is an explicit, versioned starting
calibration, not a learned prediction of enjoyment.

## Recording a ride

Treat each completed ride as its own resource, rather than a `ridden` boolean on
a route. The same route can be ridden many times.

```http
POST /rides
Authorization: Bearer <token>
Idempotency-Key: <new UUID for this logging action>
Content-Type: application/json
```

```json
{
  "routeId": "<owned route UUID>",
  "expectedRouteVersion": 1,
  "riddenOn": "2026-10-11",
  "timeZone": "Europe/London"
}
```

- The UI defaults to today but allows a past date. Dates are calendar dates in
  the supplied IANA time zone. Reject impossible dates and future dates there.
  Do not invent a precise completion time for a date-only entry.
- `expectedRouteVersion` must match the saved route. A concurrent route edit
  returns `409 ROUTE_VERSION_CONFLICT`; recording must snapshot that version
  atomically. Never silently record a different route from the one displayed.
- Return `201 { ride: ... }` and `Location: /rides/<id>`. Include server-generated
  ID, version, `recordedAt`, ridden date/time zone, route name/distance/version
  snapshot, `source: { type: "manual" }`, and
  `geometryBasis: "assumed-saved-route"`.
- Snapshot or reference immutable route geometry. Later route edits, reimports
  and untracking must not rewrite the logged ride or remove its influence.
- Identical retries under the same owner and idempotency key return the same
  ride, without a second history event or history revision. Reusing that key
  with different content returns `409 IDEMPOTENCY_CONFLICT`. Successful retries
  return HTTP 200 with `replayed: true` and the current ride representation;
  new events return HTTP 201 with `replayed: false`. A new key records
  a genuinely separate ride, even for the same route and date.
- Route ownership comes from the session. Missing and unowned routes return
  the same 404 response. Clients cannot set an owner ID.

Supporting endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /rides?limit=…&cursor=…` | Paginated history, newest ridden date first; stable ID tie-breaker. Optional `routeId` filter for exact route history. |
| `POST /rides/summaries` | Counts and latest dates for 1–100 owned route IDs across all history, independent of pagination. |
| `GET /rides/:id` | One owned history record. |
| `PATCH /rides/:id` | Correct date/time zone using `expectedVersion`; preserve the geometry snapshot. |
| `DELETE /rides/:id` | Undo logging and remove the event from future scoring. Repeated deletion remains safe. |

Undo removes the event and its geometry association. A permanent, owner-scoped
tombstone retains only the opaque idempotency key and request digest, so a delayed
create retry returns `409 RIDE_UNDONE` rather than resurrecting the event. Shared
geometry may remain for saved routes or other history. History reads and writes
are owner-scoped; the history revision changes atomically with create, correction,
deletion or enrichment that supplies previously missing historical geometry.

`GET /rides` also returns `historyRevision` and a `summary` containing `rideCount`
and `lastRiddenOn` for the whole history or the exact `routeId` filter. Page size
is 1–100 (default 50). Use the returned cursor with the same filter; refresh after
mutations. Nonexistent and unowned ride IDs both return 404 on reads/updates;
DELETE returns 204 even when already absent. PATCH requires both date and time
zone along with `expectedVersion` and returns `409 RIDE_VERSION_CONFLICT` on a
stale version. Future dates return `400 FUTURE_RIDE`. Optional `plan` and
`planSource` appear on every ride representation. Date or time-zone changes clear
the plan; all history scoring still uses the recorded date and immutable geometry.

Deleting a History record cannot be undone by POSTing a replacement: the original
route version may have changed. Clients offering Undo for removal should delay the
DELETE until their undo period ends, or offer confirmation instead. The DELETE
endpoint itself is the undo operation for a newly logged check-in.

Initially there is no rating, effort estimate, partial-route editor or automatic
Strava/Garmin activity import. Future activity adapters should create the same
history model with explicit provenance and actual geometry; they must reconcile
with manual entries rather than silently double-count them.

## Preference and overrides

Use the existing saved-settings and temporary-override conventions:

```json
{
  "expectedVersion": 3,
  "settings": {
    "preferences": {
      "recentRides": {
        "mode": "prefer-variety",
        "lookbackDays": 28
      }
    }
  }
}
```

This is a `PATCH /users/me` body. The same `recentRides` object can be supplied
inside `preferences` on `POST /recommendations` for one search. Modes
are `neutral` and `prefer-variety`; `lookbackDays` is a bounded integer,
range 1–90, default 28. The initial UI needs only “Happy to repeat” / “Prefer
variety”, with “Considers roads ridden in the last four weeks” as helper text.

Default to `neutral` for both existing and new users until they choose otherwise.
Omitted values preserve saved settings; request overrides never save themselves.
Neutral means no repetition penalty, not a reward for repeating routes. Changing
this preference leaves weather, distance, climbing and minimum standards intact.

## Scoring rule

Keep the existing combined weather/distance/climbing score as `baseScore`.
Apply a bounded deduction afterwards; do not dilute its existing factors or
give unfamiliar routes an artificial score boost.

For each part of the candidate route, find its most recent matching history
event. Its recency weight is:

```text
recency = max(0, 1 - ageDays / lookbackDays)
recentOverlap = distance-weighted mean recency over the whole candidate route
penaltyPoints = 10 × recentOverlap
score = max(0, baseScore - penaltyPoints)
```

Unmatched parts contribute zero. `ageDays` is the calendar-day difference between
`riddenOn` and the candidate departure's date expressed in that history entry's
time zone. Same-day logged rides have age zero for subsequent searches. Future
history is never used to score an earlier candidate. This is deliberately
day-level recency; precise activity timing can be added later with actual tracks.

Evaluate age against the proposed ride date, not simply today's date, including
multi-day requests. For example, recently ridden roads matter less next weekend
than tomorrow. Recommendations use one consistent history snapshot per request.

Illustrative deductions with complete overlap evidence and a 28-day window:

| Candidate overlap | Last ridden | Deduction |
| --- | --- | --- |
| Entire route | Same day | 10 points |
| Entire route | 14 days ago | 5 points |
| 20% of route | Same day | 2 points |
| 20% of route | 14 days ago | 1 point |
| Any overlap | 28 or more days ago | 0 points |

Thus an 80 km London–Horsham route sharing 10 km with the ridden Richmond route
would lose at most 1.25 points immediately. Repeating the full Richmond route
would lose up to 10. These are invented examples, not measured route overlaps.

Use the candidate's distance as the denominator. Combine overlapping historical
rides as a geographic union, using the latest matching date per portion. Do not
add penalties repeatedly for the same road or multiply them by ride count.
If a candidate traverses a familiar road multiple times, each traversal contributes
its own travelled distance, but each portion receives at most one recency weight.

Keep unrounded values until display. A modifier of zero must preserve existing
scores and ordering exactly. Minimum standards and feasibility remain separate:
novelty must never promote a ride failing standards above suitable rides, make a
missing forecast assessable, or hide all familiar routes.

## Geometry and migration

Before v0.11.0, the Worker retained weather legs with a midpoint/bearing about
every 500 m and weather locations about every 10 km, discarding the original GPX
polyline. That legacy data is insufficient for shared-road measurements.

New imports retain a versioned polyline6 path simplified within 2 m, separately
from weather samples. History shares immutable geometry by owner and original
GPX SHA-256. Inputs over 100,000 points or simplification exceeding its
two-million-comparison budget remain usable for weather but have unavailable
overlap geometry. Route summaries expose `geometryStatus`. The existing GPX
parser rejects source gaps over 5 km. Longer straight sections within that bound
are retained as the supplied GPX path; their point spacing alone does not prove
missing geometry. The matcher cannot infer unrecorded bends or detours.

A spatial index in earth-centred metres identifies possible matches and then
compares travelled sections, direction-independently. Matcher `path-overlap-v1`
uses sections up to 20 m, an 8 m proximity tolerance and alignment within 15
degrees in either direction. Nearby points, a shared town, or crossing at
one junction do not establish shared roads. Measure matched length, not GPX point
counts: point density must not change the result. Do not equate a grid-cell hit
with proven overlap. GPS tolerance and continuous alignment need calibration;
close parallel paths remain ambiguous without an underlying road network.

Matching is isolated behind a versioned contract. The matcher estimates shared
path geometry, not perfect road identity. Synthetic tests cover nearby parallel
paths, crossings, reversed tracks, differently sampled exports and unions of
multiple historical routes. Roads closer than the tolerance remain ambiguous;
map matching to an underlying road network is a future improvement.

Existing routes need exact-file reimport/enrichment before overlap is available:

- `PUT /routes/:id/geometry` accepts `{ expectedVersion, gpx }`. Its hash must
  match the saved route. Enrichment increments the route version; already enriched
  routes return unchanged. Other route facts and identity are preserved.
- Source imports of identical GPX enrich missing geometry when `expectedVersion`
  is supplied, returning `outcome: "updated"` and advancing the route version.
- `PUT /rides/:id/geometry` accepts `{ expectedVersion, gpx }` to enrich a frozen
  history snapshot even if the saved route has since been edited. It verifies the
  original recorded hash and leaves ride date, route snapshot and version intact.
- Wrong source bytes return `409 ROUTE_CONTENT_MISMATCH`; unsuitable geometry
  returns `422 GEOMETRY_UNAVAILABLE`. These endpoints do not accept a newer or
  approximate GPX as evidence for an older ride.

Both enrichment bodies are limited to 6 MB JSON / 5 MB GPX. Manual logging can
still succeed while geometry is unavailable, with explicit `geometryStatus`.

Do not treat unknown geometry as zero overlap. Conservative fallback:
if potentially relevant history/candidates lack adequate geometry, apply no
repetition adjustment to the entire comparison and return
`history_geometry_unavailable` with affected IDs. This preserves comparable
scores while clients request reimport. With neutral mode or genuinely empty
recent history, no geometry work is needed. The fallback must be explicit in UX.

A request evaluates at most 1,000 relevant ride events, 128 distinct historical
paths totalling 2 MB of encoded geometry, 16 history time zones, 150,000 subdivided path sections across
history/candidates, and five million possible segment comparisons. Exceeding a
limit returns `history_assessment_limit` and disables the adjustment for the whole
comparison; it never silently treats truncated evidence as complete. The history
query and revision are read in one D1 transaction. No weather call is needed to
create, correct, delete or enrich history.

## Explanation and client behaviour

Each recommendation should expose structured evidence alongside its score:

```json
{
  "baseScore": 84,
  "score": 82,
  "recentRides": {
    "status": "assessed",
    "matchedDistanceM": 16000,
    "overlapFraction": 0.2,
    "recencyWeightedOverlapFraction": 0.2,
    "penaltyPoints": 2,
    "lookbackDays": 28,
    "mostRecentRiddenOn": "2026-10-11"
  }
}
```

This example assumes an 80 km candidate and all its matched distance was ridden
on the candidate date. Raw overlap fraction and recency-weighted fraction are
different when dates differ. Candidate statuses: `disabled`, `no_recent_history`,
`assessed`, `unavailable`; unavailable measurements are null, never false zeros.
Response-level `history` also provides revision, matcher version, status, reason
code and affected route/ride IDs when known. It uses `not_evaluated` when no
departure is feasible. The existing `weatherScore` is preserved. Explanations can say “20% follows roads
you rode recently · 2-point adjustment.” Relevant history IDs may accompany
evidence, with bounded detail; full GPS geometry is not part of this response.

Use `GET /rides?routeId=<id>` for exact-route `lastRiddenOn`/`rideCount`, separately
from geometric similarity.
Marking a ride does not untrack it. After logging, correcting or undoing, refresh
history and recommendations. There is no server recommendation cache: results use current history per request.
Any client cache must include the authenticated owner, history revision, resolved
preferences, candidate dates and matcher/scorer versions. Weather caches remain
reusable. Do not perform a weather request when recording
a ride, and do not recompute geometric overlap for every departure time.

## Validation

- Record, retry, race, correct and undo logs without duplicates or cross-user access.
- Freeze the ridden route version; later editing/untracking cannot rewrite history.
- Same geometry under a different import ID matches; opposite direction matches.
- A junction crossing, nearby parallel path or shared place name is not sufficient.
- Short shared sections receive proportional deductions, including common starts.
- Multiple logs covering the same road do not stack; disjoint shared sections combine.
- Verify full, half-window and expired decay, candidate-date evaluation, time zones,
  multiple days, DST boundaries and date-only entries.
- Neutral/no-history/expired-history results reproduce baseline scores and ordering.
- Missing geometry is explicit and cannot make an unknown route appear fresher.
- Safety/feasibility classifications and weather evidence remain unchanged.
- Test real API boundaries and D1 updates with the existing integration harness;
  use synthetic geometry/weather and deterministic time.
- Benchmark a populated history and multi-day route selection; bound geometry,
  candidate comparisons and storage access. Never silently truncate history and
  report a complete assessment. Version the scoring change and recalibrate using
  human-reviewed route examples before rollout.

The initial 10-point cap and matcher tolerances remain open to human calibration.
The local synthetic benchmark (`worker/scripts/benchmark-ride-history.ts`) assessed
12 routes of roughly 100 km, 28 historical events over eight paths, and 660
departures across five days in 213 ms (210 ms geometry preparation). This is local
wall-clock timing, not a production CPU or network benchmark.

For human calibration, compare
Richmond against a mostly new route with a small Richmond section, a near-duplicate,
a reversed version, and a route which merely passes nearby.

## Imported Strava rides

The separate [Strava history APIs](strava.md#automatic-ride-matching-and-history-api-v0310) group temporary activity matches by saved route. They do not insert manual ride logs or affect repetition scoring. Their seven-day retention and launch gate are distinct from the durable manual history described above.
