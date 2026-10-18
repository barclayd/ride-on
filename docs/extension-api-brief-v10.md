# Extension API brief v10: keep score changes

Against API **0.35.0**, algorithm **comfort-v0.17**. Additive and display-only: no
scoring, ranking or algorithm-version change.

Each tracked ride's Conditions meter (design 15a) shows a badge when its score
moves: `▼ 2` or `▲ 10`. Today the extension works this out alone, comparing each
ride with the scores it last had on screen. So the badge:

- disappears when the popup reopens or the Journeys page reloads;
- differs between Chrome, Safari and the Journeys page;
- vanishes for every ride when a refresh moves just one of them.

Dan wants it kept. Once a tracked ride's score has changed, the badge stays, on
every device, until that ride's score changes again. That needs the server to
remember it.

## Why `best.previous` (v0.25) doesn't do this

`previous` is the earliest score **of the current local day**, for that departure
date and the exact scoring context. As a result:

- it resets at local midnight;
- for today's rides, it resets each time a departure slot passes (the assessed
  set changes);
- it resets on any change to preferences, speed, provider or ride history.

Each reset would hide the badge. It also has no memory of the last change: 84 → 70 → 84 shows nothing.

Leave `previous` as it is for the app's Ride Detail. This brief adds a separate
field.

## 1. `scoreChange` on each route's best

On `rankings[].best` and `unranked[].best` (where `best` is present) in
`POST /recommendations`:

```json
"scoreChange": {
  "by": -2,
  "from": 84,
  "to": 82,
  "changedAt": "2026-10-18T07:12:04.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `from`, `to` | Rounded scores either side of the last change. `to` can differ from today's rounded `best.score` by at most 1 (noise since). |
| `by` | `to − from`; an integer, never between −1 and 1. |
| `changedAt` | UTC instant the server first saw the change. |

`scoreChange` is `null` while the route has had no change in this plan (§3).
Responses from earlier API versions don't include the field.

## 2. When a change is recorded

For each owner, route and plan, store a **reference** (a rounded score) and the
**last change**.

- **First evaluation:** the reference becomes the current rounded score, and
  `scoreChange` is null.
- **Later evaluations:** compare the current rounded `best.score` with the
  reference.
  - A difference of 2 or more records a new change (`from` = the reference,
    `to` = the current score, `changedAt` = now), and the current score becomes
    the reference.
  - A smaller difference keeps both the change and the reference as they were.
    So a ±1 wobble never shows, and slow drift adds up: 84 → 83 → 82 records ▼ 2 at 82.
- **Quiet rebase:** when something other than the forecast moved the score, the
  reference becomes the current score, **the last change is kept**, and no new
  change is recorded. That covers:
  - effective preferences, riding speed and departure step;
  - algorithm version and the route facts used in scoring;
  - ride-history revision;
  - weather provider, product and source policy;
  - the set of assessed departures (today's slots passing, or days rolling).

  This follows the same principle as `previous` and monitoring: a change of
  inputs is never presented as a weather change. Here, it doesn't clear the badge either.
- **Each route's best:** compare the score the tile shows, even if the best moved
  to another time or day within the plan.
- **No day boundary:** a new local day doesn't reset anything.

## 3. Plans

A plan is `days` as requested plus `riding.window`.

- **Changing either one** starts or resumes a different plan, with its own
  reference and last change. A new plan's `scoreChange` stays null until its
  score changes.
- **Returning to an earlier plan** brings back its stored state. For example,
  switching Saturday off and on again keeps Saturday's badge.
- **Presets** are compared by name. Explicit dates and ranges are compared by their dates.

**One request:** the extension's "Next 5 days" (tomorrow through today + 5) is
sent as explicit `dates`, because the API's `next` preset starts today. Its plan
would therefore change every day, and the badge would clear each morning. Please
add a preset the extension can send for it, for example
`{"kind": "preset", "preset": "next", "from": "tomorrow"}` (the spelling is up to
you). When its days roll, that's a quiet rebase (§2).

## 4. Lifetime and storage

- **Lifetime:**
  - Keep a plan's state while the route is on the saved shortlist.
  - Clear it when the route leaves the shortlist or is deleted (cascade).
  - Expire a plan after 30 days without an evaluation.
  - Cap the rows per owner, removing the oldest first.
- **Owner-scoped:** state is stored per owner, so Chrome, Safari, the Journeys
  page and the app all agree.
- **Concurrent evaluations** from two devices must neither record one change twice
  nor lose one. Use compare-and-set on the reference.
- **Reused responses:** a response reused until `refreshAt` must still include the
  current stored change.
- **Storage failure:** return `scoreChange: null`, as `previous` does, and never
  fail the recommendation.
- **Paused accounts:** a paused account makes no evaluations, and its state is kept.

## 5. Unchanged

- Scoring, ranking and `algorithmVersion`.
- `best.previous`.
- Monitoring baselines and notification references.

## 6. Cases the extension relies on

1. The first evaluation in a plan returns null. A later one that is 2 or more
   points lower returns `▼` with `from`/`to`, and the next identical evaluation
   returns the same change, including on the next day.
2. ±1 records nothing. Drift adds up until it reaches 2.
3. A preference change keeps the last change, and the next weather change is
   measured from the new score.
4. Today's slots passing, and the days of a rolling preset moving on, keep the
   last change.
5. Another plan starts at null. Going back to the first plan returns its change.
6. A route removed from the shortlist and added again starts at null.
7. Two devices asking at the same moment get the same change, recorded once.

## 7. Extension follow-up (after this ships)

- Show `best.scoreChange` on the meter, and remove the local comparison in
  `Ranked` (`seen`, `ro-seen`). The reorder animation stays.
- Animate the badge only when `changedAt` is new.
- Send the new preset for "Next 5 days", and update the ranking cache key.

## Decisions for Dan

1. **A preference change keeps the last badge** (recommended: it's still the last
   forecast change). The alternative is to clear it.
2. **Changing days or time switches plans**, so a plan that hasn't changed yet
   shows no badge (recommended: the old badge describes a different day). The
   alternative is to carry the badge across.
3. **A threshold of 2 points**, as the extension uses today (recommended). The
   alternative is 1, as `previous` uses.
