# API brief v3: Chrome extension (design 4, API v0.11.0)

The extension (`extension/`) is implementing design handoff 4 ("Expired window":
ride check-in, History tab, recently ridden routes, next-window suggestions)
against **API v0.11.0** ([ride history](ride-history.md)). This brief lists the two
additions the extension is built against, and the design-4 asks that need no API
work. The extension PR stays unmerged until these ship.

The usual rules apply: strict Zod input, documentation updated with the code, and
no logging of tokens, GPX or forecast bodies. Keep field names as written, or
update this file in the same PR.

## Already working: no action needed

- `POST /rides` with `Idempotency-Key`, `DELETE /rides/:id` and `GET /rides`
  (newest first, `limit` up to 100, `nextCursor`). The check-in's "Yes, I rode it"
  logs a ride; Undo deletes it; the History tab lists and removes rides.
- `preferences.recentRides`: the Preferences card offers "Happy to repeat"
  (`neutral`) and "Prefer variety" (`prefer-variety`), saved with `PATCH /users/me`.
  The extension never sends `lookbackDays`, keeps the API default of `neutral` and
  shows "Ranked lower until <last ridden + lookbackDays>" only for `prefer-variety`.
- Re-running recommendations after logging, undoing or removing a ride.

## 1. Planned-ride snapshot on a ride (highest priority)

**Today's workaround:** none. A ride stores only its date and route snapshot, so the
History card can't show design 4's second and third lines:

```text
Sat 11 Oct · 08:00 · 35 km · 1h 46m
12° · dry · your top pick
```

The extension knows all of this at check-in time: it is the recommendation the
rider was shown for the window that just ended.

**Ask:** accept an optional, nullable `plan` on `POST /rides` and return it on every
ride representation (`POST`, `GET /rides`, `GET /rides/:id`, `PATCH`).

```jsonc
{
  "routeId": "…",
  "expectedRouteVersion": 3,
  "riddenOn": "2026-10-11",
  "timeZone": "Europe/London",
  "plan": {
    "departureAt": "2026-10-11T07:00:00.000Z", // the recommended departure
    "finishAt": "2026-10-11T08:46:00.000Z",    // its estimated finish
    "conditions": { /* that departure's `best.conditions`, unchanged */ },
    "pickRank": 1                               // 1-based rank in that window, null if unranked
  }
}
```

- `plan` describes what was **recommended**, not what happened. It is not a
  completion time and must not affect scoring, overlap or recency (which stay
  date-based).
- Validate strictly: `departureAt < finishAt`, both ISO instants; `departureAt`'s
  local date in `timeZone` equals `riddenOn`; `conditions` uses the same schema
  as recommendation `conditions`; `pickRank` is a positive integer or null.
- `plan` is part of the idempotent request content (`IDEMPOTENCY_CONFLICT` if it
  differs on replay).
- `PATCH /rides/:id` that changes `riddenOn` sets `plan` to null, since it described
  another day.

The extension sends `plan` when it has one and renders the lines only when `plan`
is present, so rides logged without it (or before this ships) show
`Sat 11 Oct · 35 km`.

## 2. Next-window suggestions in one call

**Today's workaround:** none. When the last window the rider saw has ended, design 4
replaces the ranked list with "When's your next ride?": up to three window cards,
each with its best score, top route, departure and weather. The design asks for
one call rather than three.

**Ask:** add `POST /recommendations/next-windows`.

```jsonc
// request
{
  "routeIds": ["…"],               // as POST /recommendations
  "after": {                        // the window that ended
    "date": "2026-10-11",           // its last date, ≤ today
    "window": { "start": "08:00", "end": "14:00" } // or "daylight"
  },
  "preferences": { /* optional overrides, as POST /recommendations */ }
}

// 200
{
  "timeZone": "Europe/London",
  "windows": [
    {
      "kind": "tomorrow",           // "tomorrow" | "same_weekday" | "best_this_week"
      "date": "2026-10-12",
      "window": { "start": "08:00", "end": "14:00" }, // or "daylight"
      "effectiveWindow": { "start": "…Z", "end": "…Z" }, // after daylight clipping
      "best": {                     // the window's top-ranked ride
        "routeId": "…",
        "departureAt": "…Z",
        "finishAt": "…Z",
        "score": 84,
        "conditions": { /* as recommendation conditions */ }
      }
    }
  ],
  "history": { /* as POST /recommendations */ },
  "weather": { /* as POST /recommendations, for attribution */ }
}
```

The three windows, in this order:

| `kind` | Date (effective time zone) | Window |
|---|---|---|
| `tomorrow` | today + 1 | `after.window` |
| `same_weekday` | the first date ≥ today + 2 with `after.date`'s weekday | `after.window` |
| `best_this_week` | the date of the best departure over today + 1 … today + 6 | `"daylight"` |

- Rank exactly as `POST /recommendations` does for that date and window, including
  minimum standards, distance fit and `recentRides`. `best` is that ranking's
  top ride.
- **Omit** a window when its forecast doesn't cover it or no ride is ranked, and
  omit `best_this_week` when its `best` (route and `departureAt`) equals an
  earlier window's.
- Reuse forecasts across the three windows: one fetch per location, not one per
  window.

The extension names the cards itself ("Tomorrow morning", "Next Saturday morning",
"Best time this week") and highlights the highest score. Tapping one sets the
search to that date and window, then uses the existing `POST /recommendations`.

## Not API work

- **Window expiry** (design §7 item 4): the extension remembers the dates and
  window it last showed, and their end from `effectiveWindow`. If those have ended
  when the panel opens, it shows the check-in and suggestions without asking for
  scores. No `window_expired` state is needed.
- **Duration preference** (design §7 item 5, `recentRidePenalty: {days}|{months}`):
  withdrawn. The extension uses `recentRides.mode` with the API's 28-day default.
- **Route list ride fields** (design §7 item 6): "Ridden today" and "Last ridden"
  tags come from the newest 100 rides in `GET /rides`.
- **`windowId` and `source: 'checkin'`** on `POST /rides` (design §7 item 2): not
  needed. The check-in is local state; it is skipped when `GET /rides` already has a
  ride on that date.
- **History Undo after removal:** the extension re-creates the ride with
  `POST /rides` and a new idempotency key, sending the same route, date and `plan`.

## Extension call sequence

- **Panel open:** `GET /users/me`, `GET /routes`, the shortlist and
  `GET /rides?limit=100`. If the last shown window has ended:
  `POST /recommendations/next-windows`; otherwise one `POST /recommendations` per
  date, as today.
- **Yes, I rode it:** `POST /rides` (with `plan`), then `GET /rides` and the
  suggestions or recommendations again. **Undo:** `DELETE /rides/:id`, then the same
  refresh.
- **History:** pages of `GET /rides?limit=100&cursor=…`; × is `DELETE /rides/:id`.
