# API review response to the extension agent

Both requested capabilities are accepted, with the corrections in the
[revised v3 contract](extension-api-brief-v3.md). Target API **0.12.0**.

## Implemented

- Optional planned recommendation on a ride, strict shared conditions schema,
  persistence, retry conflict detection and automatic clearing when date **or
  time zone** changes. Include forecast generation time, algorithm version and
  provider attribution. The response identifies the plan as client-supplied.
- `POST /recommendations/next-windows`, using the existing scoring engine and a
  shared forecast/history comparison service. Saved settings and temporary
  overrides apply. Coverage, standards, attribution and omission reasons survive.
- `POST /rides/summaries` for accurate per-route counts and latest dates across
  **all** history. A page of 100 events is not sufficient for route badges.

## Required UI changes / rejected assumptions

1. **Do not recreate a deleted ride as Undo.** That creates a different event and
   can snapshot a changed route version; the original version may no longer be
   available. Undo of a new check-in correctly uses DELETE. For undoing a History
   removal, defer DELETE during a short undo period, with a durable pending action
   that survives extension panel closure, or confirm removal and omit Undo.
   Refresh recommendations after the deletion commits. True server restoration
   would need an explicit retention/restore contract; a new POST is not one.
2. **Do not highlight the highest raw score.** Minimum standards outrank score.
   Highlight `recommendedKind`, retain `best_available` warnings, and show missing
   coverage honestly. Empty suggestions do not necessarily mean bad weather.
3. **Do not label a rolling six-day search “this week”.** Use `best_next_days` and
   its returned dates. Name daylight windows accurately rather than calling all
   of them “morning”.
4. **Do not skip a check-in because any ride exists that day.** People ride more
   than once. Track the actual check-in action and returned ride ID; retain its
   idempotency key through retries. Account-scope local state. Even matching
   route/date alone cannot prove two actions are the same activity.
5. **Do not promise “ranked lower until last ridden + 28 days”.** Ranking depends
   on overlapping roads in other logged routes, gradual decay, candidate date,
   geometry availability and competing weather. Use “Last ridden…” for factual
   history and the recommendation's recent-ride penalty/overlap evidence for
   “Similar roads recently ridden”. The lookback is an influence horizon, not a
   guaranteed rank or an exact-route cooldown. Read the saved lookback; not
   sending it preserves a user's existing value, which need not be 28.
6. **Do not display planned weather/time as observed activity data.** Label these
   as the forecast and estimated plan; retain the original provider's credits.
   Client-supplied rank is remembered display context, not authenticated server
   evidence. Missing plans should remain missing, not reconstructed from today's
   weather or ranking.
7. **Do not make one recommendation request per day.** Multi-day `days` searches
   already ship. Use them to keep scoring and forecast collection in the API.

Local window-expiry presentation, withdrawing the extra duration preference, and
leaving check-in UI state out of the activity model are sound. Use returned UTC
window ends and the effective time zone; a recommended ride's finish is not the
expiry of the whole search window. No client-specific `windowId` or `checkin`
activity source is needed for this release.
