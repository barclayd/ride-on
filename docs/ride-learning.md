# Ride feedback and shadow personalisation

API v0.42.0, 30 October 2026. Apply `api/migrations/0021_ride_learning.sql`
before the Worker release. The production scoring algorithm remains `comfort-v0.15`.
This release collects evidence and evaluates personal adjustments; **it does not
apply them to recommendations or overwrite saved preferences**.

## Rider experience

Save the completed ride first using the existing `POST /rides` contract. Feedback
is independent and optional. The Chrome and Safari extensions offer three questions
after check-in and from History:

1. How much did you enjoy it? Optional 1–5 rating.
2. How comfortable was the weather? Optional 1–5 rating.
3. What made the biggest difference? Up to two reasons, each positive or negative.

Overall enjoyment is retained as a product outcome, not used as the weather-training
target. A great ride with friends need not imply that its rain was comfortable.
The form also offers actual start time, elapsed duration including stops, precision,
and confirmation that the rider followed the saved route. Planned times are only
suggestions; the rider must explicitly add timing and confirm the route.

Riders can skip, edit, clear individual ratings, remove all feedback, exclude one
ride, pause tailoring, or start afresh. Saving feedback never creates a second ride.
Existing check-in/undo semantics remain unchanged.

Clients present this feature as **Tailored Rides** and never say "learning". The
API keeps its `learning` paths and field names; clients map them as follows:

| API | Client wording |
| --- | --- |
| `PATCH /users/me/learning` `enabled` | Use My Feedback (account switch) |
| `feedback.includeInLearning` | Use to Tailor My Rides (per-ride switch) |
| `reset: true` | Start Afresh |
| `eligibleRideCount` of `feedbackRideCount` | Rides That Count |
| `enabled: false` | "Tailoring is paused…" and the dimmed Progress So Far |

## API contract

All endpoints require the existing authenticated session. Ownership is resolved
server-side; missing and unowned resources return the same 404. Request schemas
reject unknown fields. Responses use `Cache-Control: no-store`.

### Save or replace feedback

`PUT /rides/:id/experience`:

```json
{
  "expectedVersion": 0,
  "expectedRideVersion": 1,
  "timing": {
    "startTime": "09:15",
    "durationMinutes": 125,
    "precision": "approximate",
    "routeFollowed": "yes"
  },
  "feedback": {
    "enjoyment": 5,
    "weatherComfort": 2,
    "reasons": [{ "factor": "wind", "impact": "negative" }],
    "includeInLearning": true
  }
}
```

- `expectedVersion` is the ride's **experienceVersion**, initially zero.
  `expectedRideVersion` is its ordinary `version`. Both must match; a conflict
  returns `409 EXPERIENCE_VERSION_CONFLICT` ("This ride or its feedback changed on
  another device. Refresh and try again."). Refresh the ride before editing again.
- `timing` and `feedback` can independently be `null`. Sending both as `null`
  removes feedback, timing and their weather evidence, retaining the ride itself.
- `startTime` is `HH:mm` in the ride's saved date/time zone; elapsed duration is
  an integer from 1 to 1,440 minutes. The server calculates UTC start/finish.
  Future finishes and ambiguous/nonexistent daylight-saving times return
  `400 INVALID_RIDE_TIMING`; this pilot does not accept a DST-fold selector.
- `precision`: `confirmed` or `approximate`. `routeFollowed`: `yes`, `partly`,
  `different`, or `unknown`. Only `yes` qualifies for weather learning.
- Each rating is an integer 1–5 or `null`. Reasons use distinct factors from
  `sunshine`, `temperature`, `wind`, `rain`, `surface`, `hills`, `distance`,
  `traffic`, `company`, `tiredness`, `mechanical`; impact is `positive` or `negative`.
- An identical retry with the previous experience version returns the saved result
  without a second update/job. A changed payload with that version conflicts.

The response contains `ride`, `learningMode: "shadow"`, `scoringApplied: false`.
Ride reads also expose `experienceVersion`, `experience`, `recommendationId` and
`weatherEnrichment: {status, reason}`. Stored experience includes canonical UTC
timing, submission timestamps and a snapshot of saved preferences at **first feedback
submission**, not necessarily at ride time. Edits preserve that snapshot.

Correcting the ride's date/time zone clears its timing, plan, recommendation link
and weather evidence, and increments the experience version. Ratings remain so
the rider can supply corrected timing. Deleting a ride cascades its weather job.

### Weather evidence

`GET /rides/:id/weather` returns `status`, `reason`, `experienceVersion`, `evidence`.
States are `not-requested`, `pending`, `processing`, `ready`, `unavailable`.
Reasons distinguish timing/route omissions, exclusion, incomplete/provider data,
sampling/budget limits, waiting for a completed hour and pending reanalysis.

Evidence includes provider/model, basis, retrieval time (the oldest underlying
provider fetch across sampled cells, preserved on cache reuse), UTC ride interval,
requested/returned locations, complete-sample coverage, exposure features, a
retrospective comfort baseline, mean conditions, quality weight and attribution.
Missing evidence has `features: null`, `summary: null`, quality zero; it is never
interpreted as dry, calm or comfortable weather. A record can be `ready` with
`reason: "reanalysis-pending"` while provisional evidence is usable in shadow mode.

### Tailored Rides controls

`GET /users/me/learning` returns:

- `modelVersion: "ride-comfort-shadow-v1"`, `mode: "shadow"`, `scoringApplied: false`.
- `enabled`, `settingsVersion`, `resetAt`, `status`, `eligibleRideCount`.
- `feedbackRideCount`: rides with feedback first submitted after `resetAt`,
  including rides excluded from tailoring or still waiting for weather. Clients
  show "Rides That Count `eligibleRideCount` of `feedbackRideCount`".
- Per-factor `evidenceCount`, `confidence`, `adjustmentPoints` for `cold`, `heat`,
  `wind`, `rain`, `shade`. Confidence is a conservative evidence-weight heuristic,
  **not** a calibrated probability or statistical confidence interval.
- `evaluation`: chronological retrospective walk-forward errors on the 0–100 scale,
  with `prospectiveForecastValidation: false`. Errors are `null` before there are
  held-out examples. At most 500 ready records are assessed; exceeding this returns
  `assessment-limit` and zero adjustments instead of fitting a silently truncated set.

`PATCH /users/me/learning`:

```json
{ "expectedVersion": 0, "enabled": true, "reset": false }
```

Settings begin enabled at version zero; successful writes increment the version.
Stale writes return `409 LEARNING_VERSION_CONFLICT` ("Tailored Rides changed on
another device. Refresh and try again."). Disabled accounts receive no new weather
jobs and have zero personal adjustments and an empty `evaluation`, but keep
`eligibleRideCount`, `feedbackRideCount` and per-factor `evidenceCount`/`confidence`
so clients can show paused progress. Re-enabling permits existing eligible evidence
again. `reset: true` excludes feedback first submitted at or
before the reset timestamp, while retaining ratings/history. Editing that earlier
feedback does not re-include it. Removing it and explicitly submitting fresh feedback
creates a new submission. An already dispatched weather request may finish after
pausing, but no disabled account's evidence is used by the model.

## Historical weather implementation

The first provider is [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api).
Recent history uses `ecmwf_ifs` with basis `modelled-past`. At least six days after
the ride finishes, a durable job replaces it with `era5` reanalysis. Six days is
our retry buffer around the documented ERA5 delay. Reanalysis reconstructs conditions
from observations and a model; neither source proves the weather on the rider's wheel track.

New rides freeze route legs atomically with their saved route version, so source
edits/deletion cannot change the weather geometry. Earlier rides without this snapshot
remain `route-snapshot-unavailable`; this release never invents a path or elapsed time.

The pilot samples 3–12 evenly spaced route positions, assumes constant progress
through the elapsed interval, and rounds request locations to a 0.05-degree sharing
grid. Routes over 240 km are excluded. The grid is a cache policy, not a claim of
weather-model resolution. Actual speed, stops, terrain shelter and detours are unknown.

Hourly inputs: temperature, sustained wind speed/direction, precipitation amount,
sunshine duration, relative humidity and cloud cover. Direction is projected against
route bearing into head/crosswind. Accumulated precipitation and sunshine belong
to the preceding hour; they are not forecast probabilities. Gusts and ground/surface
conditions are not inferred. The wind feature uses sustained wind only. Humidity
is retained for diagnostics; it has no learned coefficient in this version.

All samples must have valid units, timestamps, nearby returned coordinates and
plausible values before a ride contributes. Coverage measures completeness of our
samples, not accuracy across the entire route. Quality weights are provisional:
0.35 for IFS and 0.6 for ERA5, with further discounts described below.

## Learning method and validation limits

The learning service is separate from recommendation scoring. Each eligible ride
contributes once, using its weather-comfort rating mapped from 1–5 to 0–1.
The retrospective baseline uses the captured saved weather weights and temperature/
wind settings; missing user settings use generic defaults. Observed rainfall cannot
be inserted into the live forecast probability-based scorer as if it were equivalent.

A regularised linear residual model fits cold, heat, wind, rain and lack of sunshine
against that baseline, with a zero-centred prior and ridge strength 12. An intercept
absorbs general rating bias during fitting but is not applied as a score adjustment.
Approximate timing halves an example's weight; negative tiredness/mechanical/traffic
tags multiply it by 0.25. Other reason tags are stored for later analysis, not treated
as measured weather or direct coefficient instructions.

A factor needs five exposed rides (feature at least 0.1) and feature range at least
0.2 before receiving any adjustment. Its influence grows as weighted evidence / 
(weighted evidence + 20), capped at 0.75. Coefficients are capped at ±10 points before
that discount; the total shadow correction is also capped at ±10. These are explicit
pilot choices, not empirically calibrated thresholds. Correlated weather factors,
seasonality, selection bias and changing fitness remain unresolved limitations.

Profiles refit from current records. Corrections, removals, resets and delayed
weather replacements therefore cannot leave duplicated or stale contributions.
The evaluation fits only earlier ride examples to predict each later held-out rating
after the first five. It uses reconstructed weather and current stored feedback,
so it is **retrospective**, not an as-of replay or proof of forecast improvement.
The global baseline is not retrained from pooled riders in this release.

Before applying personal adjustments, collect prospective comparisons, evaluate
baseline versus personal prediction error on later rides, check different riders
and conditions, measure feedback completion/abandonment, and test recommendation
quality in a controlled rollout. Explicit limits/minimum standards must remain
authoritative. There is intentionally no switch that enables live learned scoring yet.

## Server recommendation records

`POST /recommendations` now returns `recommendationId`. `GET /recommendations/:id`
returns the owner-scoped server snapshot with `generatedAt` and `source: "server"`.
It stores effective preferences, selected dates, route IDs/source hashes, riding
settings, algorithm version, history/weather provenance and best results. Each snapshot is
bounded at 500 KB, with at most 1,000 snapshots and 50 MB per account. Storage
limits or failures return a null ID without changing rankings or tracking availability.
These records are diagnostic context, not a full archive of every forecast/candidate.

Pass the optional ID to `POST /rides`. The server links it only when owner, route ID,
route source hash and ridden date match; otherwise it saves the ride with a null
link. The extension carries the ID from the recommendation it displayed. The older
client-supplied `plan` remains separately labelled and is never trusted as server evidence.
Unlinked records expire after 90 days; linked records remain until unlinked and eligible
for cleanup. No model currently trains on these records directly. The top-level `recommendationId`
identifies this diagnostic response snapshot; it is separate from each departure's
existing `recommendationRef`, which remains the input to ride tracking. Neither
reference can substitute for the other. Strava-derived history remains separate
from manually logged rides and does not enter learning.

## Operations and rollout

- `RIDE_LEARNING_WEATHER_MODE=non-commercial` enables the existing non-commercial
  prototype's public Open-Meteo requests. `off` disables enrichment. Feedback APIs
  still work. Commercial use needs an appropriate provider plan/adapter; do not
  reinterpret this setting as a paid entitlement. See [Open-Meteo pricing](https://open-meteo.com/en/pricing).
- Saving feedback transactionally resets a D1 work record. `waitUntil` accelerates
  it; the existing 15-minute scheduled handler drains up to eight due jobs, including abandoned
  leases and delayed reanalysis. Leases expire after 60 seconds. Version/token checks
  prevent old in-flight work from restoring edited or removed evidence.
- Failed or incomplete requests retry after a day, up to three attempts. Permanent
  omissions are marked unavailable; supplying corrected feedback creates fresh work.
  A completed successful provisional job schedules its later reanalysis replacement.
- Global admission is capped at 300 uncached requested locations per UTC day. This
  is an application guard, not a promise about the provider's billing units. Requests
  use a 10-second timeout and a 2 MB response limit. No provider calls occur in tests.
- Shared D1 weather cache TTL: six hours for IFS, 30 days for ERA5. The scheduled
  handler prunes expired entries and usage counters older than 90 days. Cache rows
  contain provider data and coordinates/date keys, never rider IDs or ratings.
- Release the migration/Worker before the extension. Build both Chrome and Safari.
  Synthetic unit, real-Worker/D1 integration and browser tests cover the workflow.
  Production data validation and commercial-provider wiring remain later work.

## Recovery and pilot checks

Recovered from the earlier local prototype onto the current API. Migration 0021
follows the existing migrations through 0020; do not apply the abandoned
`0009_strava.sql` copy (Strava is already migration 0012). Existing Strava import
flags, queue handlers, monitoring schedule, score changes and candidate tracking
references remain in place. Learning runs alongside the existing scheduled jobs.

After the API PR is merged and deployed, publish the dependent Chrome/Safari
feedback update. With a real completed ride, verify feedback save, historical
weather provenance, editing, clearing, opt-out and reset. Do not enter invented
ratings on a rider's behalf. The automated suite uses synthetic provider data.

Keep personal adjustments out of live recommendations. Prospective baseline and
personal predictions must be recorded before collecting outcomes in a subsequent
measurement phase; the retrospective figures here do not establish future benefit.
