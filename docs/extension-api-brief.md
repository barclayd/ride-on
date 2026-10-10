# API brief: Chrome extension support

The Ride On Chrome extension (built separately under `extension/`) needs the API
changes below. The extension is being built against these contracts in parallel,
so keep the field names and shapes as written. If something must change, update
this file in the same PR.

Read `worker/CLAUDE.md`, `docs/api.md` and `docs/authentication.md` first. The
existing conventions still apply: Zod-validated strict input, functional
TypeScript, synthetic-weather tests, docs updated with the code, no logging of
tokens, GPX or forecast bodies.

## Context

The extension adds a "Ride On" module to `https://cycle.travel/user/journeys`. It
lets the rider track up to 12 saved journeys (the existing shortlist) and ranks
them for a chosen **set of days** and **time window**. It also has a Preferences
tab built from coarse controls. Chrome and the later Safari extension must stay
in sync, so all state lives on the API profile, not in browser storage.

Calls come from the extension's background service worker with
`Authorization: Bearer <session token>` and Chrome host permissions, so **no CORS
changes are needed**.

What the extension already does without API changes:

- Sign in with the existing PKCE browser handoff, persist `set-auth-token`, and
  sign out. No claim step: Dan's Apple login is already bound to `dan`.
- Create a profile with `POST /users` when `GET /users/me` returns 404.
- Import routes with `POST /route-imports` (`cycle-travel` + journey ID). The GPX
  is built from cycle.travel's polyline, with `<ele>` on **every** point taken from
  cycle.travel's elevation service, so `ascentM` is populated by the existing
  parser.
- Map shortlist IDs back to journeys with `GET /routes?sourceProviderId=cycle-travel`.
- Read and write the shortlist with `GET`/`PUT /route-selection`.
- Format the conditions line ("14° · tailwind 12 km/h · dry") from existing
  `best.conditions`. No tailwind or route-reversal work is needed: the current
  wind model already avoids penalising aiding wind.

Out of scope: forecast quota and caching changes (Dan is testing alone on the
free BPF plan), Safari-specific work, passkeys.

## 0. Configuration (Dan, not code)

Add the extension's fixed redirect URL to `AUTH_CONFIG_JSON.clientRedirects` and
re-put the secret:

```
https://gafikjcoeoddjgojefhmdpjkjpbhmjle.chromiumapp.org/ride-on
```

The ID comes from a fixed `key` in the extension manifest, so it is stable for
unpacked installs.

## 1. Forecast horizon

The day picker never offers days without hourly forecast. Define the planning
horizon as **today plus the following days covered by hourly data for the
profile's effective weather provider, capped at 5 days in total**:

- `met-office-bpf`: 5 days (today … today+4)
- `met-office` (Global Spot, 48h hourly): 2 days (today, today+1)

"Today" is the current date in the profile's `timeZone`. For `ordered-fallback`,
use the first provider. Put this in one pure function; both §2 and §3 use it.

## 2. Saved planning window: `settings.planning`

Add to `settingsSchema` (and therefore to `GET`/`PATCH /users/me`):

```ts
const planningDays = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('preset'),
    preset: z.enum(['today', 'tomorrow', 'weekend', 'next']),
  }),
  z.strictObject({
    kind: z.literal('range'),
    start: z.iso.date(),
    end: z.iso.date(), // start <= end, at most 5 calendar days inclusive
  }),
]);
const planning = z.strictObject({
  days: planningDays,
  window: z.strictObject({ start: clockTime, end: clockTime }), // start < end
});
```

- Default: `{ days: { kind: 'preset', preset: 'next' }, window: { start: '06:00', end: '20:00' } }`.
  `next` means "the whole horizon" (labelled "Next 5 days" for BPF).
- Existing stored profiles have no `planning`. They must keep parsing and read
  back with the default, without a manual migration.
- `PATCH /users/me` replaces `planning.days` and `planning.window` as whole
  values when supplied. Existing optimistic `expectedVersion` rules apply.
- Saving a range that is already in the past is allowed. Resolution handles it.

**Resolution** `resolvePlanningDays(days, timeZone, horizon, now) → { start, end, fallback } | null`:

| Input | Resolved dates |
|---|---|
| `today` | today |
| `tomorrow` | today+1 (null if outside horizon) |
| `weekend` | Saturday–Sunday of the current weekend (on Sunday: Sunday only) or the next one, **clipped to the horizon**. Null when no weekend day is inside it, e.g. on Monday with a 5-day horizon. |
| `next` | the whole horizon |
| `range` | clipped to the horizon. If the range has fully passed, resolve as `next` with `fallback: true`. |

## 3. Multi-day recommendations

`POST /recommendations` accepts **either** the existing `date` **or** a new
`days` field (same schema as `planning.days`). Exactly one is required; both or
neither returns 400. The `date` behaviour stays unchanged.

```json
{
  "routeIds": ["…"],
  "days": { "kind": "preset", "preset": "weekend" },
  "riding": { "window": { "start": "09:00", "end": "13:00" } }
}
```

The extension always sends `days` and `riding.window` explicitly, taken from the
profile it is editing, so a request never depends on a profile write landing
first.

With `days`, each route is assessed for every resolved date: the same window,
daylight, elapsed-slot and standards rules, applied per date. Each route's `best`
is the best departure **across all those dates**, using the existing
standards-first rule. Ties go to the earlier departure. `alternatives` may come
from any date.

Do **not** multiply forecast calls by the number of days. Fetch each location's
forecast once for the whole horizon. Changing the selected days or window must
not need different provider requests than the horizon already fetched in the
same request. Keep the existing 5-second CPU ceiling in mind: measure 12 routes
× 5 days and document the result.

### Response additions

Add these fields to every response, whether the request used `date` or `days`:

```jsonc
{
  "range": { "start": "2026-10-10", "end": "2026-10-14", "preset": "next", "fallback": false },
  // range is null when `days` resolves to no dates; rankings/unranked are then empty
  // and `message` says why, e.g. "Weekend forecasts aren't available yet."

  "days": [
    // One entry per horizon date (today … horizon end), always, whatever was requested.
    {
      "date": "2026-10-10",
      "daylight": { "sunrise": "2026-10-10T06:14:00Z", "sunset": "2026-10-10T17:21:00Z" },
      // Conservative common daylight across the requested routes (latest sunrise,
      // earliest sunset), like the existing per-route rule.
      "temperatureMaxC": 14.2,
      // Highest p50/deterministic temperature across the requested routes' samples within
      // the requested window on that date; null if no evidence.
      "quality": 78
      // 0–100: the best route score on that date within the window, using the same
      // scoring and standards-first rule. null when no route can ride that date
      // (elapsed, no feasible departure, unassessable).
    }
  ],

  "rankings": [
    {
      // …existing fields…
      "best": { /* existing */ "date": "2026-10-11" },   // local date of departure
      "confidence": 3,      // 1–3, see below
      "verdict": { "status": "ride", "reason": null }
    }
  ],
  "unranked": [
    { /* existing */ "verdict": { "status": "no_ride", "reason": "Needs about 6h15, window has 4h00 of daylight." } }
  ]
}
```

**`confidence`** (on each ranking, describing `best`): 3 when the departure is
≤ 24 h away, 2 when ≤ 72 h, otherwise 1. You may lower it by one (minimum 1) when
the ensemble spread for the ride is wide. If you do, make it deterministic and
document the rule. Add the drawback "Forecast less certain" when confidence is 1.

**`verdict`** gives one rider-facing outcome per route:

| status | When | `reason` example |
|---|---|---|
| `ride` | Assessable best departure that meets the standards (or has none configured) | `null` |
| `no_ride` | No feasible departure in any resolved date, **or** every assessable departure fails a minimum standard | "Needs about 6h15, window has 4h00 of daylight." / "Gusts reach 52 km/h (Tue 13 Oct)." |
| `unknown` | Weather unassessable, or standards unresolved | "Forecast unavailable for part of this route." |

The reason is one short sentence for the worst or most decisive failure. Dates
use the profile time zone, formatted like `Tue 13 Oct`. Routes with standards
failures stay in `rankings` as today, so `verdict` is the only thing the UI reads
to sort them last.

## 4. Preference levels

The Preferences tab uses coarse controls. The API owns the mapping, so Chrome
and Safari share it and Dan's calibrated values stay intact.

**Read**: `GET /users/me` and the `PATCH` response include a derived, unstored
sibling of `settings`:

```jsonc
"preferenceLevels": {
  "sunshine": "important",       // "dont-mind" | "nice" | "important" | "custom"
  "rain": "light-ok",            // "avoid" | "light-ok" | "dont-mind" | "custom"
  "climbing": "neutral",         // "flatter" | "neutral" | "hillier"
  "comfortableWindKph": 5        // = preferences.wind.comfortableHeadwindKph
}
```

**Write**: `PATCH /users/me` accepts `settings.preferenceLevels` with any subset
of those keys (no `custom`). The server resolves them to the underlying fields
before the normal merge. Return 400 if the same patch also sets a raw field that
a supplied level controls.

| Level | Controls | Mapping requirement |
|---|---|---|
| `sunshine` | `weights.sunshine` | Three fixed values, ascending. `important` **must equal 0.25**, so Dan's v4 profile reads `important`. Suggested: 0 / 0.12 / 0.25. |
| `rain` | `weights.dryness` | Three fixed values. `light-ok` **must equal 0.20** (v4). Suggested: avoid 0.40 / light-ok 0.20 / dont-mind 0.05. You may also adjust how rate and probability combine for `avoid` and `light-ok` if that is better justified. Document it and keep it versioned. |
| `climbing` | `preferences.climbing.preference` (see §5) | 1:1 |
| `comfortableWindKph` | `wind.comfortableHeadwindKph` **and** `wind.comfortableCrosswindKph` | Sets both to the value (5–50). Gust comfort and `crosswindSensitivity` stay as they are. |

Read uses an exact match (within float epsilon); anything else is `custom`. The
extension shows `custom` with no segment selected. Weights other than the one a
level controls never change.

The rest of the Preferences tab maps onto existing fields:

- Ideal temperature: `temperature.comfortMinC/MaxC`
- Minimum conditions: `minimumStandards` (see §6)

## 5. Climbing preference

The climbing contract, introduced in API v0.7.0, is defined in [the API documentation](api.md#climbing-preference).
It supersedes this section's original missing-elevation proposal; the other
proposals in this brief are separate work.

- Use `preferences.climbing: { preference: 'flatter' | 'neutral' | 'hillier' }`.
  Save it inside `settings.preferences` on the user endpoints, or send it inside
  `preferences` on `/recommendations` for a temporary override. No
  `preferenceLevels` alias is required for this control.
- Default to `neutral`, including older profiles. This leaves weather scoring
  unchanged. Label it **No preference** in the interface.
- Dan chose ascent per kilometre rather than total climbing. Climbing contributes
  10%; weather retains 90%, or 80% with preferred distance also active. Hillier rises linearly
  from 0 to 100 over 0–20 m/km; flatter is the inverse. The factor saturates at
  20 m/km. Minimum conditions still take priority. There is no ascent limit yet.
- When climbing matters, incomplete elevation makes the route `unassessable`,
  with `missing-elevation` in `issues` and no combined score. Keep it visible in
  `unranked`; never treat missing ascent as zero or silently omit the factor.
- Results include `distanceM`, `ascentM`, `ascentMPerKm`, `best.weatherScore` and
  `best.factors.climbing`. Neutral has a null climbing factor. Preserve elevation
  estimate warnings; this is not a steepness or effort estimate.
- `algorithmVersion` is now `comfort-v0.6`. Neutral climbing with no distance
  preference reproduces the accepted v4 profile's weather scores, ranking and departures.

## 5a. Preferred distance (implemented in API v0.8.0)

The [preferred-distance contract](api.md#preferred-distance) supports a broad
range without a hard filter. Use `preferences.distance: { minKm, maxKm }` on
`POST /recommendations` for a temporary override, or inside `settings.preferences`
on the user endpoints to save it. Both bounds are required: `0 <= minKm <= maxKm <= 400`,
with `maxKm > 0`. Decimals and equal bounds are supported.

- Default to `null` (**No preference**), including older profiles. Omission
  preserves a saved range; explicit `null` disables it. Replace the whole range,
  never just one bound. Unrelated updates must preserve it.
- Every distance inside the inclusive band gets the same distance factor. Outside
  routes stay available, with a gradual penalty and a shorter/longer drawback.
- Distance contributes 10%. With climbing also active, the score is 80% weather,
  10% distance and 10% climbing. Weather minimums and whole-ride windows retain
  priority. There is no recovery/exertion model or hard maximum distance preference.
- Use each route's `distanceFit.status` and `deviationKm` for presentation;
  `distanceFit` is `null` when disabled. `best.factors.distance` is 0–100, or `null`
  when disabled. Do not calculate scores or re-sort in the extension.
- No distance preference preserves previous scores and ordering. Distance-only
  changes reuse compatible weather cache entries.
- Pairing a 15–40 km range with `climbing: { preference: 'flatter' }` can express
  a shorter, gentler ride for one search without changing the usual profile.

## 6. Default minimum standards

The extension's "Minimum conditions" steppers always show a value, and there is
no "off" state. Every profile therefore has all three limits:

- `minimumTemperature: { kind: 'fixed', valueC: 0 }`
- `maximumPrecipitationProbability: 0.7`
- `maximumGustKph: 50`

These are proposed generic defaults for Dan to confirm before merge. They are
not his personal thresholds. This deliberately reverses the documented "no
minimum standards are invented by default" policy, so update `docs/api.md`.

- Put them in `defaultSettings`.
- Existing stored profiles without a limit read back with that default.
- `null` in a `PATCH` resets a limit to its default instead of removing it. The
  extension never sends `null`.
- A `monthly` minimum temperature stays valid. The extension shows the current
  month's resolved value and writes `fixed` when the rider edits it.
- `maximumPrecipitationRateMmH` stays optional and unset by default. The
  extension doesn't show it.

## 7. Done when

- `bun run check` passes with new unit and integration coverage for:
  - planning resolution, especially weekend on every weekday, clipping and
    past-range fallback, with BPF and Global Spot horizons
  - `days` vs `date` validation
  - multi-day best selection across dates
  - `days[]` always covering the horizon
  - confidence boundaries
  - verdict status and reason for each case
  - level round-trips, including v4 reading `important` / `light-ok` /
    `neutral` / 5
  - mixed level + raw patch giving 400
  - climbing `neutral` leaving v4 replay unchanged, and null ascent
  - default minimum standards on old stored profiles
- `docs/api.md` documents every new field, with examples. Bump the API version
  (`/health`).
- Deployed to `https://api.ride-on.cc`, and `/health` shows the new version.
- Old clients that send `date` keep working.

## Extension call sequence (for reference)

1. `POST /auth/browser/start` → `chrome.identity.launchWebAuthFlow` → `POST /auth/browser/exchange`.
2. `GET /users/me`. If it returns 404: `POST /users { displayName }`.
3. `GET /route-selection`, plus `GET /routes?sourceProviderId=cycle-travel` (all pages) to map journey IDs.
4. `POST /recommendations { routeIds, days, riding: { window } }` on open and after every window or preference change.
5. Window change: `PATCH /users/me { expectedVersion, settings: { planning } }`, debounced, in parallel with step 4.
6. Save preferences: `PATCH /users/me { expectedVersion, settings: { preferenceLevels, preferences: { temperature, minimumStandards } } }`, then step 4.
7. Track: `POST /route-imports` (if not yet imported or edited since), then `PUT /route-selection`. Untrack: `PUT /route-selection`.
