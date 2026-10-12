# Extension API brief v5: pick separate days

Proposed against API **0.18.0**, algorithm **comfort-v0.11**. For the API agent.

The extension's When tab is now just the seven-day strip. Riders tap days on and
off. A rider who can ride on Tuesday or Saturday should get Tuesday and Saturday,
not Tuesday to Saturday. Today `days` only takes a preset or a
`{ kind: 'range', start, end }` of consecutive dates. As a result, the extension
has to fill gaps: tapping Tue and then Sat also selects Wed, Thu and Fri.

Nothing in the scoring needs consecutive days. The consecutive-range rule came
from brief v1, when the UI was presets plus a start–end picker.
`resolvePlanningDays` already expands a range into a list of `dates`. Each date is
scored separately, and `mergeDays` ranks across whatever list it's given.

This is an additive change: no scoring, ranking, algorithm-version or D1 change.

## 1. `days: { kind: 'dates', dates }`

Add a third variant to `planningDaysSchema`. This adds it to
`POST /recommendations` and to the saved `settings.planning.days`, because both
use the same schema.

```ts
z.strictObject({
  kind: z.literal('dates'),
  dates: z.array(z.iso.date()).min(1).max(7),
})
```

Validation returns 400 with the usual field error when:

- dates are not strictly ascending (no duplicates, no unsorted lists). Clients
  send a canonical list, and the request body doubles as their cache key;
- the last date is more than 6 days after the first. This is the same 7-day span
  limit that `range` has today.

Keep `preset` and `range` unchanged. The extension still sends `range` for
consecutive picks and presets for the rolling default.

## 2. Resolution

Resolve `dates` the same way as a range, but without filling gaps:

| Case | Result |
|---|---|
| Some dates before today | Drop them and keep the rest. A range clips the same way. |
| Every date before today | `expired: true`, `range: null`, empty results and no weather calls. Same as a fully expired range. |
| Some dates beyond forecast coverage | Excluded from `selectedDates`, as for a multi-date range. Never replaced by other dates. |

The preview union, `refreshDates`, `mergeDays` and the "not available yet"
message should need no change, because they already work on the list.

## 3. Response: `range.dates`

`range` is `{ start, end, preset, fallback }` today. For a `dates` request,
`start` and `end` are the first and last *selected* dates, and `preset` is null.
That keeps current readers working, but `start`–`end` would now cover days that
weren't picked.

Add `range.dates: string[]` to every non-null `range`. It holds the selected
dates after resolution, the same set as `days[].selected === true`. Return it for
presets and ranges too, so clients read one field whatever kind they sent.

```json
"range": {
  "start": "2026-10-13",
  "end": "2026-10-17",
  "dates": ["2026-10-13", "2026-10-17"],
  "preset": null,
  "fallback": false
}
```

## 4. Tests and docs

- Unit tests:
  - Schema: empty, more than 7 dates, duplicates, unsorted, span over 6 days,
    invalid date.
  - Resolution: past dates clipped, all dates past means expired, a single date.
  - `range.dates` returned for all three kinds.
- One integration test:
  - Request Tue + Sat with `previewDays: 7`.
  - Only those two days are `selected`.
  - Every `rankings[].best.date` and alternative `date` is Tue or Sat.
  - Preview tiles still cover all seven days.
- Docs:
  - Update `planning-api.md` §Search dates and the response list.
  - Add a version line to `api.md`.
  - Release as a minor bump to **0.19.0**.

## Extension follow-up (not for the API agent)

Once deployed:

- the strip sends `{ kind: 'dates' }` whenever the picked days have a gap;
- `toggleDay` stops filling gaps;
- the view reads `range.dates` rather than `start`–`end`;
- labels list the separate days, e.g. "Tue 13 & Sat 17 Oct".
