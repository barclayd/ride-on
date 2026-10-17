# Extension API brief v8: pause Ride On

Implemented in API **0.34.0**, algorithm **comfort-v0.17**. See [the API contract](api.md#pause) and [monitoring behavior](ride-monitoring.md#account-pauses). Client follow-up remains separate.

Design handoff v6 (screen 22b) lets a rider who isn't cycling for a while pause
Ride On. While paused, clients hide forecasts, scores and alerts, and tracked rides
stay listed by name and distance. The rider picks when Ride On turns back on:
`After 3 days`, `After a week`, or `When I choose` (until they switch it off).

Dan wants the pause stored on the rider's profile under `/users/me`, so it applies on
every Ride On device. Pausing in Chrome also pauses Safari and the iOS/macOS app.
The server has its own reasons to know about it:

- **Push alerts come from the server.** Scheduled ride monitoring sends APNs alerts
  about the tracked ride ([ride monitoring](ride-monitoring.md)). Only the server
  can stop those while the rider is paused.
- **The return date must work with no client open.** Monitoring has to start again
  at the return time even if the rider never opens Ride On.

This is an additive change: no scoring, ranking or algorithm-version change.

## 1. `pause` on the user

Every user response (`POST /users`, `GET /users/me`, `PATCH /users/me` and the two
endpoints below) carries a top-level `pause`, next to `settings`:

```json
"pause": {
  "until": "2026-10-25",
  "resumesAt": "2026-10-24T23:00:00.000Z",
  "pausedAt": "2026-10-18T09:12:00.000Z"
}
```

It is `"pause": null` when Ride On isn't paused.

| Field | Meaning |
| --- | --- |
| `until` | The local date (`YYYY-MM-DD`) Ride On turns back on, or `null` for "When I choose": paused until the rider turns it back on |
| `resumesAt` | UTC instant of 00:00 on `until` in the profile's `settings.timeZone` (the first instant of that local day if midnight doesn't exist there). `null` when `until` is `null`. Clients compare the time against this and don't work it out themselves |
| `pausedAt` | When this pause started. Changing `until` while paused keeps it |

- **It isn't a setting.** Recommendations don't resolve it, request overrides can't
  set it, and `PATCH /users/me` neither accepts nor changes it. That keeps a pause
  out of the rule that preference changes quietly rebase monitoring comparisons.
- **A pause ends when it's read.** Once the time reaches `resumesAt`, every response
  returns `pause: null`, whether or not the stored row has been cleared yet.
  Clearing it later (on the next write, or from the monitoring cron) is fine, but a
  read must never depend on that.
- **A time zone change moves the return time.** If `settings.timeZone` changes during
  a dated pause, work out `resumesAt` again from `until` in the new zone. Profiles
  without a saved zone use the API default, `Europe/London`.
- **Store it outside `user_json`**, for example in a `user_pauses` table keyed by
  owner. Pause writes don't touch `version` (§2). If the pause lived in the
  version-checked JSON, a concurrent `PATCH` could pass its version check and write
  back the old pause.

## 2. Endpoints

Both use the existing owner-bound session and `Cache-Control: no-store`. A missing
profile returns `404 USER_NOT_FOUND`.

### Pause, or change the return date

```http
PUT /users/me/pause
Content-Type: application/json

{ "until": "2026-10-25" }
```

Send `{ "until": null }` to pause until the rider turns it back on.

- This starts a pause, or replaces `until` on the current one and keeps its `pausedAt`.
  Sending the same body again returns the same pause.
- `until` must be a real date after today in the profile's time zone, and at most
  365 days ahead. Clients work out the date in the rider's local zone (today + 3 or
  + 7). A malformed body returns 400; a date out of range returns
  `422 PAUSE_DATE_OUT_OF_RANGE`.
- Returns `200 { "user": { … } }`, the whole user in the same shape as
  `GET /users/me`, so clients refresh their saved profile in one step.
- No `expectedVersion`. The last write wins, and it doesn't increment the user
  `version`. Pausing on one device must never make a preference edit on another
  device fail with `409 USER_VERSION_CONFLICT`.

### Turn back on

```http
DELETE /users/me/pause
```

Ends the pause straight away and returns `200 { "user": { …, "pause": null } }`.
When Ride On isn't paused, it returns the same 200.

## 3. What the server does while paused

### Alerts

Ride monitoring sends **nothing** for a paused account:

- No alert of any kind: Conditions score, minimum breach or recovery, better option,
  evening summary, or forecast-unavailable notices.
- **Pausing cancels pending deliveries.** Deliveries for the account that haven't
  been sent yet are cancelled, as when a plan is stopped. A push Apple has already
  accepted can't be recalled, as today.
- **No assessments while paused.** Paused plans aren't assessed, which saves weather
  calls. For a dated pause, the dispatcher can make them due again at `resumesAt`.
- **Plans stay active.** The tracked ride, its accepted baseline and its
  notification reference are left alone. When Ride On turns back on, that ride
  is monitored again, and the clients show its alerts again (design §5: the bell and
  border come back).
- **Missed events are dropped, not sent late.** A 19:00 summary that falls during
  the pause isn't sent after it. A departure that passes during the pause ends
  monitoring as usual.
- **Turning back on starts quietly.** Whether the rider turns it back on (`DELETE`)
  or `resumesAt` passes, the first assessment afterwards becomes the new notification
  reference without an alert, like the existing quiet rebase. The rider doesn't get a
  burst of alerts about changes made while they were paused. Normal rules apply from
  then on.
- **Return dates work without a client.** A dated pause must end and monitoring
  must start again from `resumesAt` even if no client calls the API. The
  15-minute cron is enough.

### Everything else

`/recommendations`, `/recommendations/next-windows`, tracked-ride refreshes,
`POST /tracked-rides` and the route endpoints work as normal while paused. The
clients stop asking for forecasts (design §5). The API doesn't refuse them, so
a client that hasn't seen the pause yet still works, and the API stays simple.

Clients aren't notified when the pause changes on another device. They read `pause`
from `GET /users/me` when they open (and the extension also does on a daily alarm).

## 4. Version, docs and tests

- API version **0.34.0**. Scoring stays **comfort-v0.17**. The user `schemaVersion`
  stays 1.
- `docs/api.md`:
  - add a "Pause" subsection under "Users and saved preferences";
  - add `PAUSE_DATE_OUT_OF_RANGE` to Errors.
- `docs/ride-monitoring.md`: add the §3 rules to the agreed decisions.
- Tests:
  - **Return time across the clocks going back.** Europe/London: `until: "2026-10-25"`
    resumes at `2026-10-24T23:00:00.000Z` (still BST at midnight), and
    `"2026-10-26"` resumes at `2026-10-26T00:00:00.000Z`. Also test one zone west
    of UTC.
  - **"When I choose".** `until: null` returns `until` and `resumesAt` as `null`.
  - **Changing the date.** A second `PUT` changes `until` and keeps `pausedAt`, and
    the same body twice returns the same pause.
  - **Rejected dates.** Today, a past date, more than 365 days ahead and
    `"2026-02-30"` return 422. A missing `until` key or a wrong type returns 400.
  - **Reads after the return time.** At or after `resumesAt`, `GET /users/me`
    returns `pause: null` without a write.
  - **Turning back on.** `DELETE` clears the pause, and `DELETE` when not paused
    still returns 200.
  - **Version untouched.** Pausing leaves `version` unchanged. A `PATCH` with the
    version from before the pause succeeds and keeps the pause.
  - **Monitoring while paused.** A paused account's active plan sends nothing and
    makes no weather calls. Pausing cancels pending deliveries.
  - **Monitoring after the pause.** The first assessment after it ends rebases
    without an alert. A dated pause ends from the cron alone. A summary missed
    during the pause isn't sent afterwards.

## Contract decisions

Implemented using the recommendations in this handoff, as requested:

1. **Changes during the pause stay quiet when it ends.** The alternative is an alert
   on resume if conditions moved a lot while paused. *Recommended: quiet*, because
   the rider has just opened Ride On and sees fresh scores anyway.
2. **The longest pause is 365 days.** The design only offers 3 and 7 days, plus
   "When I choose", which has no end. The upper bound leaves room for a calendar
   later (rejected option 22c).
3. **Forecast endpoints aren't refused while paused.** *Recommended*, see §3.

## Client follow-up (not API)

**Extension:**

- Reads `user.pause` when the panel or Journeys page opens, on a daily
  `chrome.alarms` alarm, and on an alarm at `resumesAt`.
- While paused, it makes no recommendation, next-window or refresh calls. Tiles
  show the route name and distance only. The header shows `Paused until {Day D}`,
  and there's no check-in.
- When Ride On turns back on, it fetches fresh recommendations.
- The switch sends `PUT` with today + 7 (the default, `After a week`), the options
  send `PUT`, and `Turn back on` sends `DELETE`. Each updates the screen straight
  away and rolls back if the request fails.

**iOS/macOS app:** reads `pause` when it comes to the foreground and should honour it
the same way. Not designed yet.
