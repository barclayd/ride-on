# API brief v2: Chrome extension (design 3, API v0.9.0)

The extension (`extension/`) now implements design handoff 3 against the **live
v0.9.0 API**. This brief lists where the extension still works around missing
API support, and what the API should add. It updates
[the v1 brief](extension-api-brief.md):

- v1 §1 is replaced by §2 below.
- v1 §2–§4 are still open, with the design-3 changes listed below.
- v1 §6 is withdrawn (see §7).

The usual rules apply: strict Zod input, documentation updated with the code, and
no logging of tokens, GPX or forecast bodies. Keep field names as written, or
update this file in the same PR.

## Already working: no action needed

- Sign-in and sign-out, profile creation, cycle.travel imports with elevation on
  every point, the shortlist, and `GET /routes`.
- Distance and climbing:
  - temporary overrides on `POST /recommendations`
  - saving them with `PATCH /users/me`
  - shorter/longer chips taken from `distanceFit`
- Minimum conditions: switches that default to off. `null` removes a limit.
- Apple Weather (v0.9.0):
  - The Preferences "Forecast provider" select lists the configured providers
    from `GET /weather-providers` and shows the saved choice. Dan's profile shows
    Met Office.
  - Choosing a provider PATCHes its whole `recommendedSettings` (`weather` and
    `forecast` together).
  - Attribution from `weather.locations[].provenance.attribution` is de-duplicated
    and rendered under the Rides list, in the Weather data card, and under the page
    grid. Where a logo is supplied, the extension renders the logo, links it to
    `url`, and shows `notice`.
- `GET`/`PATCH /users/me` return `{ user }`. The extension used to read the body as
  the bare user; this is fixed in the client.

## 1. Multi-day recommendations, with per-day availability (v1 §3, highest priority)

**Today's workaround:** the extension sends one `POST /recommendations` per date
with forecast in the 7-day strip. That is 2 requests for Met Office, 5 for BPF and
**7 for Apple**. It also re-sends them on every window or preference change. The
extension then:

- merges the days itself and picks each route's best day by score, which breaks
  "the API owns ordering"
- builds each strip tile's temperature and quality bar from those responses

**Ask:** implement v1 §3 (`days` in the request; `range`, `days[]` and `best.date`
in the response), with these changes for design 3:

- `days[]` always covers **7 dates** (today … today+6), whatever was requested.
  Each entry:
  ```jsonc
  {
    "date": "2026-10-12",
    "availability": "full",   // "full" | "partial" | "none"
    "until": null,            // "HH:mm" local, last hourly forecast on a partial day
    "daylight": { "sunrise": "…", "sunset": "…" },
    "temperatureMaxC": 14.2,  // null when availability is "none"
    "quality": 78             // null when no route can ride that date
  }
  ```
  The strip shows "Not yet" for `none` and "AM only" for a partial day that ends
  by midday. Both remain selectable.
- **Quota:** with Apple Weather on a shared 500k/month allowance, please confirm
  that the extension's per-date fan-out reuses the cached forecast for the whole
  horizon and does not make one WeatherKit call per date per location. If it does
  make extra calls, this section becomes urgent.

## 2. Forecast horizon from the API (replaces v1 §1)

**Today's workaround:** `GET /weather-providers` returns names but no horizons, so
the extension hard-codes them:

| Provider | Hours |
|---|---|
| `met-office` | 48 |
| `met-office-bpf` | 120 |
| `apple-weather` | 240 |

Anything else is treated as 48 hours. A day counts as "full" if the horizon reaches
21:00 local time, and "partial" if it reaches past 05:00.

**Ask:**

- Add `forecastHorizonHours` (hourly coverage) to each provider in
  `GET /weather-providers`.
- Once §1 lands, the per-day `availability` there replaces the extension's
  calculation entirely.

**"Next few days":** design 3 says this preset spans every available day. Dan
capped it at **5 days** (today … today+4), even though Apple covers 10. The
extension applies the cap, so `next` in v1 §2 should resolve the same way:
`min(horizon, 5 days)`. The individual days 6 and 7 can still be picked.

## 3. Saved planning: default window (v1 §2, updated)

**Today's workaround:** "Save as my default window" stores the plan in
`chrome.storage.local`. It is lost on another browser or in Safari. On browser
start the extension restores the saved default, or `next` with daylight hours if
none is saved.

**Ask:** implement v1 §2, but use design 3's time model in place of a plain
window:

```ts
const planning = z.strictObject({
  days: planningDays, // unchanged from v1 §2
  time: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('daylight') }),
    z.strictObject({ mode: z.literal('custom'), start: clockTime, end: clockTime }),
  ]),
});
// default: { days: { kind: 'preset', preset: 'next' }, time: { mode: 'daylight' } }
```

`daylight` maps to `riding.window: 'daylight'`, which the API already supports.

## 4. Expired selections (changes v1 §2)

Design 3 says the extension must **never silently replace** dates that have passed.
It shows "These dates have passed" with a "Choose available dates" button on Rides,
on When and on the page.

**Change:** in v1 §2's resolution table, a range that has fully passed should
**not** fall back to `next`. Resolve it to `range: null` with
`"expired": true`, and leave `rankings` empty. The extension already detects
expired ranges itself, so this matters only once planning lives on the profile.

## 5. Card states, flags and drawbacks (refines v1 §3 `verdict`)

**Today's workaround:** the extension derives the following from v0.8 fields:

- the state of each card
- the "Best pick" / "Best available" flag
- the drawback lines

The rules are:

- **States:**
  - meets: `best.standards.status` is `meets` or `not_configured`
  - below: `below`
  - incomplete: standards `unknown`, or no `best` and the route is
    `unassessable`
  - nofit: `no_feasible_departure` on every selected date
- **Flag:** shown on the first card, using `minimumStandardsStatus` merged across
  the selected dates:
  - **Best pick** when it is `match_found` or `not_configured`
  - no flag when it is `no_feasible_departure`
  - otherwise **Best available**
- **Drawbacks:** built from `standards.failures`, for example "Gusts reach 48 km/h
  (your limit 45 km/h)". For a minimum-temperature failure, the time comes from the
  **first section's** `observedAt`, which may not be when the low occurs.

**Ask:**

- Give `verdict.status` four values that match the design's four states: `meets`,
  `below_minimums`, `doesnt_fit` and `incomplete`. Each comes with a one-sentence
  `reason`. Design 3 needs "doesn't fit the window" kept separate from "fails a
  weather minimum".
- Add a top-level `recommendation: { routeId, kind: 'best_pick' | 'best_available' } | null`.
- On each failure, add `at`, the local time of the worst value (and its date once
  §1 lands). Alternatively, return drawback strings in the design's wording.

## 6. Missing elevation is a trade-off, not unassessable (changes v1 §5)

Design 3 treats missing elevation as a trade-off. The ride keeps its weather (and
distance) score, and the card adds a chip: "No elevation data, so climbing isn't
scored". At present, v0.7+ marks such a route `unassessable` with
`missing-elevation` whenever climbing is active, so the extension shows "Forecast
incomplete" with no score.

**Ask:** when climbing is active and elevation is incomplete:

- still score weather and distance
- set `best.factors.climbing: null`
- put `missing-elevation` in `warnings`, not `issues`
- keep the route in `rankings`

This is rare for the extension, because its imports carry elevation, but it
affects routes imported elsewhere.

## 7. Default minimum standards: withdrawn (v1 §6)

Design 3 gives every limit a switch with **No limit** as the default. That matches
the API's existing no-defaults policy, so **do not implement v1 §6**. The extension
sends `null` to remove a limit and keeps the last value locally for when the rider
switches it back on.

## 8. Sunshine, rain and wind preferences (v1 §4, updated)

**Today's workaround:** the Sunshine and Rain controls and the "Favour tailwinds"
toggle are stored **only in this browser** and **do not affect scoring**. Headwind
and crosswind comfort are written as raw fields and work.

**Ask:** implement v1 §4 `preferenceLevels` with these design-3 changes:

- **Rain** labels: "Don't mind" → `dont-mind`, "Prefer dry" → `light-ok`,
  "Strongly prefer dry" → `avoid`. Dan's v4 value (0.20) must read as
  "Prefer dry".
- **Sunshine** is unchanged: `dont-mind`, `nice` or `important` (Dan's 0.25 reads as
  `important`).
- **Custom:** keep v1's `custom` read value. The design shows a "Custom" pill and
  keeps the stored value until the rider picks an option. A PATCH that doesn't
  include that level must not reset it.
- **Drop `comfortableWindKph`.** Design 3 has separate headwind and crosswind
  sliders and writes the raw `wind` fields.
- **Favour tailwinds:** Dan says the scorer already favours mostly-tailwind rides.
  Either add `preferences.wind.favourTailwinds: boolean` (default `true`) that the
  scorer honours, or confirm it is always on so the design can drop the toggle.

## 9. Smaller asks

| # | Design 3 shows | Extension today | Ask |
|---|---|---|---|
| a | "tailwind **home** 12 km/h" | "tailwind 12 km/h", from the route averages | Outbound and return wind on `best.conditions`, e.g. `wind: { out: {headwindKph, tailwindKph}, home: {…} }`, or a ready-made phrase |
| b | Partial score with a coverage chip | "Some forecasts don't cover your whole window", from `departuresUnknown` | `coverage: { assessedFraction, until }` per route, when a score covers only part of the window |
| c | "Forecast retrieved 08:40 today" | Latest `provenance.retrievedAt` across all responses | Optional: top-level `weather.retrievedAt` and de-duplicated `attribution` |
| d | km/mi switch | Stored only in this browser | `settings.display.unit: 'km' \| 'mi'` so Safari matches |
| e | Shows the source actually used when a fallback applied | Shows the first provider of an `ordered-fallback` chain | Nothing new; `provenance.source` is enough once the UI uses it |

## Not API work (for Dan or design)

- **Apple attribution versus design 3.** Design 3 removes the provider/retrieved
  line from Rides and the page, and calls the picker "Met Office only for now".
  Apple's terms need the logo, link and notice wherever Apple data appears, so the
  extension shows a small attribution block in those places. Design should style
  it.
- **Temporary versus saved provider.** The extension always saves the provider to
  the profile. The API already accepts `weather` and `forecast` on
  `POST /recommendations` for a for-this-search choice, so this is client work.
- **For-this-search distance and climbing** last until "Use usual", "Save as usual"
  or a browser restart. The design's open question on how long they should last is
  answered by this behaviour unless Dan says otherwise.

## Extension call sequence today (v0.9.0)

1. Sign in, then `GET /users/me` (`POST /users` on 404).
2. In parallel:
   - `GET /route-selection`
   - `GET /routes?sourceProviderId=cycle-travel` (all pages)
   - `GET /weather-providers` (optional)
3. `POST /recommendations { routeIds, date, riding: { window }, preferences? }`,
   once per available strip date. **§1 collapses this into one call.**
4. Preferences: `PATCH /users/me { expectedVersion, settings: { preferences } }`,
   debounced by 900 ms, then step 3.
5. Provider: `PATCH /users/me { expectedVersion, settings: { weather, forecast } }`,
   then step 3.
6. Tracking a route: `POST /route-imports` if the route is new or has been edited,
   then `PUT /route-selection`.
