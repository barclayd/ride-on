# Preferences: reviewed API contract

**v0.26.0 addition:** explicit `temperature.coldSensitivity` and
`temperature.seasonalTolerance` are ready for client integration. See the
[seasonal temperature contract](../seasonal-temperature.md) for save semantics,
defaults, wording and assessment fields. These are separate from the custom
monthly hard minimums below; neither choice should be enabled implicitly.

Reviewed on 15 October 2026. API **v0.25.0** adds factor point-loss explanations,
crosswind levels and linked sign-in methods. Scoring stays **comfort-v0.15**.
The iOS UI must consume these fields separately; this backend change does not
claim the screens are wired. Existing fields and optimistic-save semantics stay
stable (`expectedVersion`, deep merge, explicit null for removable limits, 409
for a stale version).

## 1. Strava connection — implemented locally; coordinated rollout pending

Updated 17 October: the [shared Strava API](../strava.md) implements account
connection, central token refresh in Stitch, Ride On disconnect and live completed
cycling history. Preferences has a dedicated Strava screen. The integration is
disabled until both backends are deployed. The user scoped this first release to
connection/history, with route imports later.

Use `GET /connections/strava` for `configured` and nullable `connection`, with
status `connected` or `needs-reauthorisation`, athlete ID, connection timestamp
and private-activity permission. Use `/connections/strava/rides` for paginated
history. There is no `user.connections.strava`, `lastSyncAt` or fabricated speed
average. History reads are transient and do not ingest activities into `/rides`.

The proposed average should be total distance divided by total moving time over
qualifying `Ride`/`GravelRide` activities in the last 90 days, excluding virtual,
e-bike and commute activities, distances below 10 km, and moving times below
20 minutes. Require at least five eligible rides; otherwise return null and the
actual qualifying count. Applying that suggestion to saved riding speed must be
an explicit rider action. “Routes and rides synced” requires evidence that both
syncs succeeded; otherwise expose separate timestamps/statuses.

Keep the average action hidden until its separate implementation and retention
review. The connection screen reports unavailable while the backend flag is off.
The removed legacy Strava token endpoints remain removed.

## 2. Points lost per factor — implemented

Assessed `best` and `alternatives[]` departures include:

```json
{
  "pointsLost": {
    "temperature": 2.1,
    "wind": 0.4,
    "dryness": 0,
    "clearSkies": 0,
    "sunshine": 0,
    "climbing": null,
    "distance": null
  }
}
```

Each value is how much higher this **same departure's final score** would be if
that one comfort factor were 100 everywhere, all else held fixed. The engine
recomputes the distance-weighted mean/worst-section combination, route-factor
shares, tailwind assistance, 100-point weather ceiling, recent-ride deduction
and zero floor. It retains the actual assistance bonus when idealizing wind
comfort. It does not change hard standards, weather evidence, departure time or
which route is recommended. These gains are **not additive** and need not sum to
`100 - score`. They are rounded to two decimal places, like scores.

Null means the factor is inactive or lacks sufficient evidence (including
partially unknown sunshine). A partial assessment with no comparable combined
score has `pointsLost: null`. Historical records/older servers may omit it.
`recentRides.penaltyPoints` remains separate.

For values at least one, the app may round and say “could gain 2 points if the
temperature were ideal”. For a positive value below one, “a small effect” is
reasonable. For zero, do not say “scores lower”; for null/missing, make no numerical
claim. Do not attribute the entire temperature effect solely to the maximum or
starting temperature: it describes the ride's complete assessed temperature
profile. Explanations must use the matching evaluated preferences, not unsaved
slider values paired with an old board response.

## 3. Gust control — keep soft comfort and hard maximum independent

Both proposed 80% coupling options are declined. Neither is calibrated user
intent, and either would silently overwrite an existing comfortable-gust setting.
Setting/removing `minimumStandards.maximumGustKph` changes only that hard limit;
it does not change `wind.comfortableGustKph`.

- Label the maximum control as a **maximum gust limit**. Compare it to raw
  `conditions.maximumGustKph`; breaches affect `standards`, not a hidden score cap.
- Label soft comfort as a **gust comfort setting** if exposed. Its scoring effect
  uses opposing/sideways exposure estimated from the prevailing wind direction
  (`conditions.gustExposure.maximumAdverseKph`), not the raw gust maximum.
- No maximum configured means no hard gust limit. Do not substitute a comfort
  setting in a sentence saying “over your limit”.

A single hard-limit UI control may leave the independent comfort value untouched.
The integration test confirms a maximum of 50 leaves a saved comfort of 25 intact.

## 4. Crosswind sensitivity level — implemented

Read `user.preferenceLevels.crosswind` alongside `user.settings`; recommendation
responses also expose resolved `preferenceLevels`. Write a saved choice with:

```json
{
  "expectedVersion": 4,
  "settings": { "preferenceLevels": { "crosswind": "high" } }
}
```

`POST /users` accepts it inside `settings`. Both recommendation endpoints accept
`preferenceLevels` at the top level as a temporary override.

| Level | `preferences.wind.crosswindSensitivity` |
|---|---|
| `low` | 0.5 |
| `normal` | 1 |
| `high` | 2 |

Other existing values, including 5, read as `custom` and remain untouched until
an explicit edit. `custom` is read-only. Null/unknown levels and a request that
supplies both the level and raw sensitivity are rejected with 400, even when the
values agree. Unrelated comfort settings, hard limits and `preferTailwind` are
preserved. These are convenience aliases, not a recalibration or profile migration.
The existing helpful-tailwind opt-in remains independent and defaults to false.

## 5. Linked sign-in methods — implemented

`GET /auth/me` adds `user.providers`:

```json
{ "user": { "providers": ["apple", "passkey"] } }
```

Values are `apple`, `google` and `passkey`, deduplicated and ordered by earliest
link creation, then provider name for ties. Passkeys are read from their separate
credential table. Only public method names are returned, never tokens or keys.

This lists **linked methods**, not the method used for the current session. An
“Apple Account” label can indicate an Apple-linked account, but must not imply
that this particular session used Apple. Multiple methods may be linked; clients
can show all or use a neutral “Account” label. An empty list is valid. The public
`/auth/providers` endpoint instead describes methods available on the server.

## 6. Vary by Month — user-chosen limits only

Dan explicitly chose to keep user-chosen monthly limits. Do not introduce a
`seasonal` kind or infer 2°C/4°C offsets from latitude or hemisphere. The accepted
API remains:

```json
{
  "minimumTemperature": {
    "kind": "monthly",
    "valuesC": { "1": 2, "7": 8 },
    "fallbackC": null
  }
}
```

This belongs inside `preferences.minimumStandards`. `kind: "fixed"` with `valueC`
is also supported; explicit null removes the policy. The whole supplied policy
replaces the old one, including its monthly table. An omitted month with no
fallback remains unresolved; do not silently substitute the warmest month or the
fixed limit. Read `resolvedMinimumTemperature` / `resolvedMinimumTemperatures`
for the relevant date.

The existing UI's guessed northern-hemisphere table needs correction: preserve
custom tables, show/edit the actual chosen values, and never synthesize or replace
them from a simple switch. Existing tables are not auto-migrated by this change.

## 7. Display units — independent saved choices

`settings.units.temperature`, `settings.units.windSpeed` and
`settings.display.unit` are independent. Wind wire values are `kmh` / `mph` and
distance choices are `km` / `mi`. Changing wind units must not silently change
distance units: mph with kilometres is a legitimate choice. Save each explicit
choice separately, use saved preferences across clients, and keep API quantities
metric. No backend coupling or schema change is needed.

## Validation

Tests cover preset persistence across Worker restarts, temporary overrides,
conflicting/custom writes, preservation of personal settings, exact
counterfactual scoring (including clipping and recent rides), missing evidence,
linked-method ordering/deduplication and cross-account isolation. API version
0.25.0 is additive; algorithm comfort-v0.15 and calibrated ranking behavior remain
unchanged.
