# Extension API brief v3 — reviewed contract

API **0.12.0**, algorithm **comfort-v0.9**. This replaces the proposed v3 wire
contract. The [review decisions](extension-api-v3-decisions.md) explain required
UI changes. All endpoints require the normal owner-bound session.

## Planned recommendation on a logged ride

`POST /rides` accepts optional `plan`; omitted and `null` mean no plan. Existing
logging fields and `Idempotency-Key` still apply. Build it from the **original
recommendation shown**, before updating history or re-ranking:

```ts
const plan = {
  schemaVersion: 1,
  departureAt: ranked.best.departureAt,
  finishAt: ranked.best.finishAt,
  conditions: ranked.best.conditions,
  pickRank: ranked.rank, // positive integer, or null if the rank was not retained
  generatedAt: recommendation.generatedAt,
  algorithmVersion: recommendation.algorithmVersion,
  weather: { attribution: recommendation.weather.attribution },
};
```

The additional metadata fields are required whenever `plan` is present. Retain
all attribution fields, including logos and notices. Do not copy the full weather
response or provider payloads. Conditions use the shared provider-neutral schema
in `api/src/recommendations/conditions.ts`, unchanged from `best.conditions`.
`schemaVersion` defaults to 1; unsupported versions and unknown fields fail.
Attribution is 1–10 entries, HTTPS URLs only; strings and the JSON body are bounded.

Instants require an offset and are normalized to UTC milliseconds. Generation
must not follow departure, departure must precede finish, and departure's date
in the logged ride's time zone must equal `riddenOn`. A plan is **client-supplied
display context**, not verified activity or a server-authenticated recommendation.
All ride representations return `plan` and `planSource: "client-supplied" | null`.
Without a plan, both fields are null. Show forecast conditions and planned times
as such; do not imply observed weather or actual moving duration.

Plans do not affect recency, overlap, duration estimates or scoring. The plan is
part of the idempotency fingerprint. Omitted/null plans preserve pre-v0.12 retry
compatibility. Changing **either date or time zone** in `PATCH /rides/:id` clears
the plan atomically. Retrying the original POST then returns the current, corrected
record, as before. A deleted logging action still returns `409 RIDE_UNDONE`.
Keep `expectedRouteVersion` from the route originally shown; do not silently
upgrade it after a source refresh.

## Next-window suggestions

```http
POST /recommendations/next-windows
Content-Type: application/json
```

```json
{
  "routeIds": ["<owned route UUID>"],
  "after": {
    "date": "2026-10-11",
    "window": { "start": "09:00", "end": "13:00" }
  }
}
```

`after.window` also accepts `"daylight"`. `after.date` must be today or earlier
in the effective time zone; the API does not assert that a previous UI session
actually existed or that a same-day window has expired. The client decides when
to show this view.

The same saved settings and temporary `preferences`, `preferenceLevels`,
`timeZone`, `riding.averageSpeedKph`, `riding.departureStepMinutes`, `weather` and
`forecast` overrides apply as for normal recommendations. Overrides are not saved.
The settings-patch fields `planning` and `display` are also accepted for consistency
but do not change this endpoint's fixed search policy. Do not send `date`, `days`,
`previewDays` or `riding.window`; `after.window` is the repeated window.
Route limits and unknown-field/weight-conflict validation are unchanged.

Returned suggestions remain in this order:

| `kind` | Search | Window |
| --- | --- | --- |
| `tomorrow` | Effective today + 1 | `after.window` |
| `same_weekday` | First date at least today + 2 matching `after.date`'s weekday; can be today + 8 | `after.window` |
| `best_next_days` | Effective today + 1 through today + 6 inclusive | Daylight |

`best_next_days` replaces the proposed `best_this_week`; label it “Best in the next
6 days”, not “Best this week”. Label other cards from their returned dates and
window; a daylight search should not automatically be called “morning”.

The response contains:

- `windows`: up to three suggestions. Each has `kind`, `searchRange`, `days`,
  winning `date`, requested `window`, winning route's `effectiveWindow`,
  `minimumStandardsStatus`, `recommendationKind`, `message`, `verdict`, `coverage`,
  `warnings` and `best`. `best` contains `routeId`, `routeName` and the complete
  standard assessed-departure fields (score, standards, conditions, drawbacks,
  factor scores, recent-ride evidence and hourly variation).
- `recommendedKind`: the card to highlight, or null. Uses the engine's
  standards-first comparison, recommendation priority, Conditions, physical
  assistance, earlier departure and route-ID tie-breaker. See the
  [opportunity contract](tailwind-opportunity.md).
  Do not find the highest raw score in the client.
- `omitted`: one entry for each missing kind, with its `searchRange`, daily
  availability evidence, `reasonCode: "no_ranked_ride" | "duplicate"`, and
  `unranked` route verdicts. Daily reasons distinguish no fit, provider failure,
  missing data and dates beyond the actual forecast horizon. A generated clock
  time skipped/repeated at DST has `availabilityReason: "invalid_window_time"`;
  other suggestions still work.
- Standard `history`, `weather` (including attribution, selected source, cache
  and retrieval evidence), `algorithmVersion`, `generatedAt`, `timeZone`,
  `savedUser`, `resolvedPreferences`, `preferenceLevels`, `riding` and `forecast`.

A fully assessable ride remains eligible when only part of the surrounding day
is covered. Use coverage/warnings; do not claim the entire window was evaluated.
Below-minimum rides remain available with `recommendationKind: "best_available"`.
A best-next-days result matching an earlier card's route and departure is omitted
as a duplicate. Other omissions must not be silently presented as “no good rides”.

The endpoint uses the existing engine through a shared comparison service, with
one history snapshot and one cached provider-horizon request per location per
attempted provider. Explicit fallback policies can try multiple providers; strict
Met Office stays strict. No self-HTTP calls or per-window forecast fan-out. The
same snapshot supplies all comparisons; missing history geometry/assessment limits
retain the comparison-wide conservative fallback documented in ride history.
A fresh request after tapping a card may differ if forecasts or history changed.

## Accurate route badges

```http
POST /rides/summaries
Content-Type: application/json
```

```json
{ "routeIds": ["<owned route UUID>"] }
```

Supply 1–100 unique route IDs (a route-list page). Returns `summaries` in input
order and `historyRevision`, read in one database transaction:

```json
{
  "summaries": [{
    "routeId": "<owned route UUID>",
    "rideCount": 3,
    "lastRiddenOn": "2026-10-11",
    "lastRide": {
      "id": "<ride UUID>",
      "riddenOn": "2026-10-11",
      "timeZone": "Europe/London",
      "routeVersion": 2
    }
  }],
  "historyRevision": 8
}
```

Unridden routes have count 0 and null `lastRiddenOn`/`lastRide`. Missing or unowned
IDs return 404 for the whole request. “Latest” uses recorded calendar date,
then the same stable ID tie-breaker as history; it does not invent completion
timestamps. This is exact route-ID history across its versions, not an overlap
assessment. It considers all history, independent of pagination. Use the recorded
time zone when deciding whether that date is “today”; refresh after mutations.

## Client call sequence

On open, load profile, routes, shortlist and the first history page. Load route
summaries for displayed route IDs. If the prior selection has expired, request
next-window suggestions. Otherwise use **one** `POST /recommendations` with
`days` for the entire selection (see [planning API](planning-api.md)).

Logging/undo/correction/deletion invalidates history, route summaries and
recommendations. Keep pending logging idempotency keys until success; scope
local check-in state to the authenticated account and the actual selection.
History remains cursor-paginated; never infer completeness from its first page.

Apply migration `0006_ride_plans.sql` after `0005_rides.sql`, before deployment.
