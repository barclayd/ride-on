# Ride On iOS redesign: screens and build checklist

The approved Claude Design canvas, written down screen by screen so the SwiftUI rebuild has one
place to check against. The canvas is the visual source of truth:
https://claude.ai/artifact/9rYWTxdZVkx21dpJRrue7T (version 17). The rules behind it (materials,
colour, type, motion, accessibility) live in [`DESIGN-SYSTEM.md`](../../DESIGN-SYSTEM.md); this
doc is the *what*, that one is the *how*.

**Approach.** The UI is rebuilt from scratch. Nothing from the previous Ride/You/SharedUI views
is adapted. Screens are built against sample data shaped like the canvas (see
[Sample data](#sample-data)), then wired to the existing API
(https://api.ride-on.cc, already powering the Safari client) in a later pass.

This doc is updated with every PR that lands a piece of the redesign: tick the item, note the PR.

## Status

| # | Piece | Status | PR |
|---|---|---|---|
| 0 | This doc and reference images | ✅ Done | #154 |
| 1 | Foundation: green accent, Rides/Routes/Preferences tabs, `RideBoard` sample data | ✅ Done | #155 |
| 2 | Rides screen | ✅ Done (window capsule lands with 4) | #155 |
| 3 | Ride detail | ✅ Done; wind direction, score change and four factors wait on the API ([requests](ride-detail-api-requests.md)) | #157, #164 |
| 4 | Ride Window sheet and Window passed | 🟡 Sheet done; Window passed remaining | #162 |
| 5 | Preferences, Ideal Temperature, Comfortable Wind | ✅ Done, live; Strava, points lost, crosswind levels, sign-in provider and seasonal floors wait on the API ([requests](preferences-api-requests.md)) | #167 |
| 6 | Widgets and Lock Screen | ⬜ | |
| 7 | Remove the old UI (RideView, RideCard, BestDayBadge, ScoreRing…) | 🟡 YouUI gone (PreferencesUI replaced it) | #167 |
| 8 | Wire to the API | 🟡 Rides, Ride detail, Ride Window and Preferences live; Routes still sample | #159, #162, #167 |

Not in scope yet: Routes tab and Onboarding (not redesigned; they keep working as they are).

## Where the code goes

| What | Where |
|---|---|
| Presentation value types + `.sample` | `app/Packages/Models/Sources/Models/RideBoard.swift` |
| The nine components (DESIGN-SYSTEM.md §6) | `app/Packages/Features/Sources/SharedUI/` |
| Rides, Ride detail, Window sheet, Window passed | `app/Packages/Features/Sources/RideUI/` |
| Preferences, Ideal Temperature, Comfortable Wind | `app/Packages/Features/Sources/PreferencesUI/` (replaced YouUI; About moved here) |
| Saved settings (`RiderSettings`, `RiderSettingsStore`) | `app/Packages/Services/Sources/Services/RiderSettings.swift` |
| Tabs | `app/Packages/Router/Sources/Router/AppTab.swift`: `rides`, `routes`, `preferences` |
| Accent | `app/App/Assets.xcassets/AccentColor`: `#248A3D` light, `#30D158` dark |
| Widgets | New widget extension target in `app/project.yml` |

---

## 1. Rides (tab)

| Light | Dark |
|---|---|
| <img src="screens/rides-light.png" width="300"> | <img src="screens/rides-dark.png" width="300"> |

Top to bottom:

1. **Hero** (`RideHero`, at least 480pt, taller when large text needs it; edge to edge under the
   status bar). A non-interactive satellite `Map` of the best pick with the route in accent on a
   white casing and a start marker; a dark scrim sized to the title block.
   - "★ Best pick · Wednesday 14 October" (`.subheadline` semibold, white 85%)
   - "Hilly Loop" (`.largeTitle` bold, white)
   - "09:00 → ~12:00 · 51 km · 640 m" (`.body`, monospaced digits)
   - Share button: 48pt clear-glass circle, bottom right, `square.and.arrow.up`, label "Send
     route to a bike computer".
   - The `Map`'s own "Maps" and "Legal" attribution, bottom leading.
   - Tap anywhere else on the hero: zoom to Ride detail.
2. **Conditions card** (solid card, 26pt radius).
   - "✓ Meets your preferences" (accent, `.subheadline` semibold) · "Last ridden 29 Sep" trailing
     (`.footnote`, secondary). Stacks at large text sizes.
   - `ConditionChip`s: 🌡 9–14° · 15 km/h tailwind · Gusts 28 km/h · ☀ Sunny spells.
   - Hairline divider, then "Conditions" (`.subheadline` semibold) · "▲ 4" badge (accent soft
     fill) · "86/100" (`.title2` bold over `.footnote`).
   - Progress bar, 6pt, accent fill at 86%.
3. **"Your Window"** section header, then `DayStrip` in a card: one column per day in the window.
   Wed 86 (selected: accent bar, soft accent background), Thu 79, Fri rain symbol with a short grey
   stub (no ride, not tappable), Sat 64, Sun 71. Bar height tracks score.
   Footnote inside the card: "Best ride each day. Friday has rain from dawn to dusk."
   Tapping a day swaps the hero to that day's best ride.
4. **"Other Tracked Routes"** card of rows: route thumbnail (56pt, 12pt radius: the route's outline
   on a plain land fill, not a map, so no labels or Legal link at that size), name (`.headline`),
   "Thu 09:00 → ~13:20 · 77 km", conditions line or "⚠ Below your minimums" in warn colour, score
   (`.title3` bold, monospaced) and chevron. At accessibility sizes the text drops below the
   thumbnail.
   - Potters Bar: Thu 09:00 → ~13:20 · 77 km · "12–14° · Crosswind · Cloudy" · 79
   - Braintree: Wed 09:30 → ~12:30 · 51 km · "Below your minimums" · 61
5. **"Doesn't Fit Your Window"** card: East Anglia, "112 km · about 7h 05m. Your window allows
   5h 45m." No score.
6. **Footer**: "Apple Weather" · "Other data sources" link; "Updated 08:12. Pull down to refresh."

Chrome:
- Toolbar leading: window capsule "📅 Wed 14 – Sun 18 ⌃⌄" opening the Ride Window sheet.
  Trailing: "+" circle ("Track a route"). Both clear glass over the hero with a ~35% top dim,
  regular glass once content scrolls under them (about 340–400pt).
- Tab bar: Rides (selected) · Routes · Preferences. Minimises on scroll down.
- Pull to refresh.

Build:
- [x] `RideHero`: `Map` with interactions off + route polyline (`SharedUI/RouteMap.swift`)
- [x] Toolbar capsule + "+": system glass handles clear → regular on scroll. Both are no-ops
      until the Ride Window sheet (4) and route tracking exist
- [x] Conditions card with `ConditionChip`s and score bar
- [x] `DayStrip`: tapping a day swaps the hero to that day's best
- [x] Other Tracked Routes rows (open Ride detail), Doesn't Fit rows
- [x] Footer attribution
- [x] Zoom transition source on the hero and each route row
- [x] Light/dark and Dynamic Type through `accessibility5` checked on the simulator
- [ ] Reduce Transparency

## 2. Ride detail (push from the hero, zoom transition)

| Light | Dark |
|---|---|
| <img src="screens/ride-detail-light.png" width="300"> | <img src="screens/ride-detail-dark.png" width="300"> |

1. **Hero**, 400pt, same art and title block as Rides, no share button in the hero.
2. **Verdict card**: `ScoreGauge` (64pt ring, 86), "✓ Meets your preferences", "▲ 4 since 07:00 ·
   last ridden 29 Sep". Then notes with symbols:
   - 🌡 "Starts at 9°, a degree under your ideal range."
   - 💨 "Headwind for the last 9 km back into town."
3. **"Departure"**: `DeparturePicker`, four tiles: Wed 14 09:00 86 (selected), Wed 14 10:00 82,
   Thu 15 09:30 74, Sat 17 10:00 64. Footnote: "The best time, then the next three in your window.
   Choosing one updates everything below."
4. **"Forecast on the Ride"** card: one column per ride hour.

   | Time | Sky | Temp | Wind | Gusts | Rain |
   |---|---|---|---|---|---|
   | 09:00 | sun behind cloud | 9° | 14 km/h | 24 | 0% |
   | 10:00 | sun | 11° | 15 km/h | 26 | 0% |
   | 11:00 | sun | 13° | 17 km/h | 28 | 5% |
   | 12:00 | sun behind cloud | 14° | 16 km/h | 27 | 5% |

   Footnote: "Wind from the west-south-west."
5. **"Along the Route"**: `RouteProfile`. Elevation area chart 0–200 m over 0–50 km, peak marker
   "186 m" at ~31 km; under it a wind strip (accent tailwind 0–32 km, yellow crosswind 32–42 km,
   red headwind 42–51 km) and a legend: Tailwind "First 32 km", Crosswind "Next 10 km", Headwind
   "Last 9 km".
6. **"Why It Scored 86"**: one `FactorRow` per factor, name + score + bar + one sentence.

   | Factor | Score | Sentence |
   |---|---|---|
   | Rain | 100 | Dry throughout. The highest chance of rain is 5%. |
   | Wind | 94 | Tailwind for 62% of the distance. Gusts peak at 28 km/h, under your 45 km/h limit. |
   | Time budget | 92 | About 3 hours. You're back by 12:00, long before sunset at 18:04. |
   | Surface match | 88 | Sealed roads all the way, right for your road bike. |
   | Temperature | 81 | 9° at the start, 14° by the finish. Your ideal range is 10–22°. |
   | Sky | 76 | Sunny spells, about 40% cloud cover. |
   | Intent | 70 | You wanted a steady ride. 640 m of climbing makes it a harder one. |
   | Novelty | 60 | You rode it 15 days ago, on 29 September. |

   Footnote: "Each factor is weighted by your preferences."
7. **Actions** card (accent list buttons): "Add to Calendar" (trailing "Wed 09:00–12:00"),
   "Open in cycle.travel".
8. **Footer**: the forecast provider's attribution ("Apple Weather · Other data sources", or the
   provider's own line, such as "Powered by Met Office data"); "Updated 08:12."

Chrome: back (44pt circle, `chevron.left`, label "Rides") leading; one capsule with share and
more (`ellipsis`) trailing. Clear glass over the hero, regular from about 260–320pt of scroll; the
inline title "Hilly Loop" fades in at about 290–330pt.

Build:
- [x] Hero (reuse `RideHero`, 400pt variant). The hero map ignores touches, so Legal shows but
      isn't tappable on either screen
- [x] Toolbar: back + share/more capsule (more holds Add to Calendar and Open in cycle.travel),
      inline title fades in at 290–330pt. Clear → regular glass is left to the system
- [x] Verdict card with `ScoreGauge`
- [x] `DeparturePicker`; selection swaps the forecast, profile wind strip and factors
- [x] Forecast grid (rows instead of columns at accessibility sizes)
- [x] `RouteProfile` (Swift Charts area + wind strip, scrubbing)
- [x] `FactorRow` list
- [x] Add to Calendar (EventKit, write-only access) and Open in cycle.travel
- [x] Zoom destination (iOS only; macOS pushes)
- [x] Light/dark and Dynamic Type through `accessibility5` checked on the simulator
- [ ] Reduce Motion: the zoom should fall back to a cross-fade (system behaviour, not yet checked)
- [x] Sample data: `RideDetail.sample(for:on:)` in `Models/RideDetail.swift`, built from any pick
- [x] Notes and factor sentences measured against your preferences (`resolvedPreferences`), live
- [x] Footer shows the forecast provider's own attribution (`weather.attribution`)
- [ ] "Wind from the …" footnote: API v0.25.0 supplies `windFromDegrees`; client wiring pending ([reviewed contract](ride-detail-api-requests.md) §1)
- [ ] "▲ 4 since 07:00" badge: API v0.25.0 supplies comparable `best.previous`; client wiring pending (§2)
- [x] Additional-factor decision: explain the seven existing factors; keep time feasibility and recent-rides deductions separate, with no invented Surface match or Intent scores (§3)

## 3. Ride Window (sheet)

| Light | Dark |
|---|---|
| <img src="screens/window-sheet-light.png" width="300"> | <img src="screens/window-sheet-dark.png" width="300"> |

Large detent over the Rides screen.

1. Header: grabber; Cancel (glass circle, `xmark`, `role: .cancel`) leading; "Ride Window"
   centred; Done (tinted circle, `checkmark`, `role: .confirm`) trailing.
2. Quick picks: "Tomorrow", "This Weekend", "Next 5 Days" (selected: soft accent fill, accent text).
3. **"Days"**: multi-select list. Leading circle checkmark (accent when on), day, one line, sky
   symbol, temperature.

   | Day | On | Line | Temp |
   |---|---|---|---|
   | Today | | Rain until 15:00. No ride fits after it. | 11° |
   | Wed 14 Oct | ✓ | ★ Best pick · Hilly Loop · 86 (accent) | 14° |
   | Thu 15 Oct | ✓ | Potters Bar · 79 | 14° |
   | Fri 16 Oct | ✓ | Rain from dawn to dusk | 12° |
   | Sat 17 Oct | ✓ | Hilly Loop · 64 | 13° |
   | Sun 18 Oct | ✓ | Potters Bar · 71 | 13° |
   | Mon 19 Oct | | Hilly Loop · 58 · Forecast ends 18:00 | 12° |

   Footnote: "Best tracked route each day. Forecast to Mon 19 Oct."
4. **"Hours"**: segmented Daylight | Custom; "Leave After" "Sunrise, about 07:20"; "Back By"
   "Sunset, about 18:10". Custom swaps the values for `DatePicker(.hourAndMinute)`.

Build:
- [x] Sheet with `.presentationDetents([.large])`, Cancel/Done toolbar (#162)
- [x] Quick picks that select their day range (#162)
- [x] Days list with multi-select (#162)
- [x] Hours section, Daylight/Custom (#162)
- [x] Done applies the window to Rides; Cancel discards (#162; live only, the fixture world's Done
  just closes the sheet)

`RideWindowSheet` (`RideUI/RideWindowSheet.swift`). The days are the board's `forecast` (today
onwards, chosen or not); the ★ Best pick line follows the selection live. A quick pick is
highlighted while the selection is exactly its days. Done is disabled with no days, or when Back
By isn't after Leave After. The "No Rides in Your Window" empty state has a "Choose Dates"
button into the same sheet until Window passed lands.

## 4. Window passed

| Light | Dark |
|---|---|
| <img src="screens/window-passed-light.png" width="300"> | <img src="screens/window-passed-dark.png" width="300"> |

Rides when the saved window is in the past. No hero, so the toolbar is regular glass; the
capsule shows the stale range "Mon 5 – Fri 9".

1. `ContentUnavailableView`: `calendar.badge.clock`, "Your Window Has Passed", "Mon 5 – Fri 9
   October is over. Choose new dates to rank your tracked routes against the forecast.", and
   "Choose Dates" (`.borderedProminent`, the screen's one tinted action) opening the sheet.
2. **"Quick Picks"** card rows:
   - "Next 5 Days" · "Wed 14 – Sun 18 Oct · Hilly Loop on Wed" · 86
   - "This Weekend" · "Sat 17 – Sun 18 Oct · Potters Bar on Sun" · 71
   Footnote: "Daylight hours. Scores use the latest forecast."

Build:
- [ ] Empty state + Choose Dates
- [ ] Quick Picks rows apply that window directly

## 5. Preferences (tab)

| Light | Dark |
|---|---|
| <img src="screens/preferences-light.png" width="300"> | <img src="screens/preferences-dark.png" width="300"> |

`Form` (grouped), large title "Preferences", subtitle "Changes re-rank your rides straight away."
Rows have a 30pt rounded-square coloured icon.

| Section | Rows | Footer |
|---|---|---|
| What Makes a Good Ride | Ideal Temperature "10°–22°" + mini ramp → push · Comfortable Wind "Up to 15 km/h" → push · Sunshine "Nice to Have" (menu) · Rain "Light Rain Is OK" (menu) · Climbing "Flatter" (menu) · Distance "40–80 km" (push) · Recently Ridden "Prefer Variety" (menu) | Routes you rode in the last 28 days score a little lower, so you see more of your list. |
| Deal-Breakers | Never Colder Than 4° · Never Hotter Than 30° · Strongest Gusts 45 km/h · Chance of Rain 60% (menu) | Rides that break one of these still appear, marked Below your minimums, so you can decide. |
| Riding | Average Speed 20 km/h + stepper · "Use My Strava Average, 21.4 km/h" (accent button) · Try Departures Every 30 min (menu) | Speed sets how long each route takes, and so whether it fits your window. |
| Units | Temperature °C/°F · Wind Speed km/h/mph (segmented) | |
| Connections | Strava "Connected", subtitle "Routes and rides synced 08:10" (push) · Apple Health switch, subtitle "Log rides from cycling workouts" | |
| Account | Apple Account "Signed In" · About Ride On | Apple Weather · Other data sources |

Icon colours: temperature orange, wind cyan, sunshine yellow, rain blue, climbing green, distance
purple, recently ridden teal, colder indigo, hotter red, gusts grey-blue, chance of rain blue,
speed green, interval grey, Strava orange, Health white with red heart, Apple black, About grey.

Build:
- [x] Form with all sections, menus, stepper, segmented units, Health toggle
- [x] Distance range editor (push)
- [x] Settings model mirroring the API `settings` shape, held in an `@Observable` store
- [ ] Strava status and "Use My Strava Average" (hidden until the API has a Strava connection)
- [ ] Account label: API v0.25.0 supplies `/auth/me` linked `user.providers`; client wiring pending (these are linked methods, not the current session's sign-in method)

## 6. Ideal Temperature (push)

| Light | Dark |
|---|---|
| <img src="screens/temperature-light.png" width="300"> | <img src="screens/temperature-dark.png" width="300"> |

1. Card: "10°–22°" (large, bold, monospaced), "The range you'd happily ride in", `TemperatureRange`
   two-handle slider on a 0–35° `ConditionPalette` ramp (faded outside the range), ticks 0° 10° 20°
   30°, then "Inside this range, temperature scores full marks. Outside it, the score falls away
   gently rather than all at once."
2. **"How Your Routes Fit"**: per route, name + "Wed · 9–14°", a mini range bar against the
   preference, and status: Hilly Loop "1° under" (secondary), Potters Bar "In range" (accent),
   Braintree "In range". Footer: "Hilly Loop's 9° start is 1° under your range, so it loses 2
   points. Rides re-rank as you drag."
3. **"Deal-Breakers"**: Never Colder Than 4° (stepper), Never Hotter Than 30° (stepper), Vary by
   Month (edit the rider's chosen monthly limits). Footer: "Rides outside these are marked
   Below your minimums." No automatic seasonal offsets; preserve saved custom tables.

Inline title "Ideal Temperature", glass back button. Saves as you go; no Done.

Build:
- [x] `TemperatureRange` (drag both handles, 1° steps, selection haptic)
- [x] Route fit rows recompute as you drag
- [x] Deal-breaker steppers
- [ ] Replace the guessed northern-hemisphere Vary by Month table with user-chosen monthly limits; preserve existing tables and unresolved months ([reviewed contract](preferences-api-requests.md) §6)
- [ ] Factor point-loss wording: API v0.25.0 supplies `pointsLost`; client wiring pending. Zero is no effect, null is inactive/unknown, and old board scores must not describe unsaved edits

## 7. Comfortable Wind (push)

| Light | Dark |
|---|---|
| <img src="screens/wind-light.png" width="300"> | <img src="screens/wind-dark.png" width="300"> |

1. Card: `WindEnvelope` polar chart. You ride up the page; headwind limit at the top ("Headwind
   15"), crosswind limits left and right ("20"), "Tailwind, any" at the bottom; accent shaded
   shape is the comfortable envelope; dashed blue ring is the gust limit ("Gusts 45"). Caption:
   "Speeds in km/h. You ride up the page: the shaded shape is wind you're happy with, the dashed
   ring is your gust limit."
2. **"Limits"**: Headwind 15 km/h, Crosswind 20 km/h (accent sliders), Gusts 45 km/h (blue
   slider), Crosswind Sensitivity "Normal" (menu).
3. **"How Your Routes Fit"**: Hilly Loop "Wed · 15 km/h tailwind" In range; Potters Bar "Thu ·
   14 km/h crosswind" In range; Braintree "Wed · Gusts 48 km/h" "⚠ 3 over" (warn). Footer:
   "Braintree's gusts are 3 km/h over your limit, so it's marked Below your minimums. Raise Gusts
   to 50 km/h and it ranks normally."

Build:
- [x] `WindEnvelope` (Canvas/Path), redraws live from the sliders
- [x] Limits sliders + sensitivity menu (a saved value other than 0.5, 1 or 2 shows "Custom")
- [ ] Wire API v0.25.0 `preferenceLevels.crosswind`; preserve custom values until explicitly changed
- [ ] Distinguish gust comfort from the hard maximum; do not auto-link them at 80% ([reviewed contract](preferences-api-requests.md) §3)
- [x] Route fit rows

## 8. Widgets and Lock Screen

<img src="screens/widgets.png" width="720">

- `systemSmall`: `ScoreGauge` 86, "★ Wed 09:00", "Hilly Loop", "51 km · 9–14° · Tailwind".
- `systemMedium`: map thumbnail, "★ Best pick · Wed 14 Oct", "Hilly Loop" 86,
  "09:00 → ~12:00 · 51 km", "9–14° · 15 km/h tailwind · Dry", runner-up "Thu · Potters Bar 79".
- `accessoryInline`: "Wed 09:00 · Hilly Loop".
- `accessoryCircular`: gauge 86 with "Wed".
- `accessoryRectangular`: "Hilly Loop" / "Wed 09:00–12:00" / "9–14° · Tailwind · 86".
- Tap opens that ride's detail.

Build:
- [ ] Widget extension target + timeline from the same `RideBoard` data
- [ ] All five families

## Design language board

<img src="screens/design-language.png" width="720">

---

## Sample data

Every screen above renders from one value, `RideBoard.sample`, so previews, UI tests
(`--fixture-world`) and the canvas agree. "Today" in the sample is Tuesday 13 October 2026;
the window is Wed 14 – Sun 18 October, daylight hours.

| Route | Distance | Climb | Best | Window score |
|---|---|---|---|---|
| Hilly Loop | 51 km | 640 m | Wed 09:00 → ~12:00 | 86 (Sat 64, Mon 58) |
| Potters Bar | 77 km | 410 m | Thu 09:00 → ~13:20 | 79 (Sun 71) |
| Braintree | 51 km | 280 m | Wed 09:30 → ~12:30 | 61, below minimums (gusts 48 > 45) |
| East Anglia | 112 km | — | doesn't fit (7h 05m vs 5h 45m) | — |

Preferences in the sample: ideal 10–22°, headwind 15, crosswind 20, gusts 45 km/h, never colder
than 4°, never hotter than 30°, rain chance limit 60%, 20 km/h, departures every 30 min, distance
40–80 km, °C and km/h.

## Wiring notes

The Rides tab is live outside the fixture world (`LiveRidesView`, which falls back to
`RidesView(board: .sample)` under `--fixture-world` so E2E never touches the network).
`RideBoardLoader` (`Services/RideBoardLoader.swift`) builds the board; `RideOnAPI` holds the
session.

**Sign-in.** Apple or Google through the PKCE browser handoff
([`docs/authentication.md`](../authentication.md), "iOS and macOS app"):
`POST /auth/browser/start` → `ASWebAuthenticationSession` with an `https` callback on
`api.ride-on.cc/auth/browser/done` → `POST /auth/browser/exchange`. The session token lives in the
keychain; a refreshed `set-auth-token` replaces it; a 401 signs out. The `https` callback needs the
`webcredentials:api.ride-on.cc` associated domain, in both the iOS and macOS entitlements.

**Loading.** `GET /route-selection` (the extension's shortlist) → `GET /users/me` (saved
planning days and window; presets resolved to dates the way the extension does, so "Next 5 Days"
starts tomorrow) → in parallel `POST /recommendations {routeIds, days, previewDays: 7, riding:
{window}}`, `POST /rides/summaries`,
and per route `GET /routes/:id` (cycle.travel link) and `GET /routes/:id/geometry` (polyline6 for
the map). Ride detail's elevation profile samples the geometry through Open-Meteo on first open.

| UI | API |
|---|---|
| Picks (hero, other routes) | `rankings[].best`, ordered as ranked |
| Score | `best.score`, rounded |
| Meets your preferences / Below your minimums | `best.standards.status` |
| Temperature, wind, sky chips | `best.conditions` (dominant wind and sky by distance fraction) |
| Last ridden | `POST /rides/summaries` `lastRiddenOn` |
| Your Window days | `days[]` where `selected`, each day's `best` |
| Ride Window days | every `days[]` entry (`previewDays: 7`): `best`, `temperatureMaxC`, `until` (Forecast ends), `availabilityReason` (the grey line), `daylight` (Sunrise/Sunset) |
| Ride Window Done | `PATCH /users/me {expectedVersion, settings: {planning: {days, window}}}` (a quick pick saves as its preset, anything else as dates), then the board reloads with that window |
| Window range | `range.dates` in the response `timeZone` |
| Doesn't Fit Your Window | `unranked` with `no_feasible_departure` |
| Departure tiles | `best` + up to three `alternatives` |
| Forecast on the Ride | `rideHours[]` |
| Wind strip | `rideHours[]` dominant wind, merged into stretches |
| Why It Scored | `factors`, sorted by score |
| Notes | Built in the app from `best.conditions`, `rideHours[]`, `recentRides` and `distanceFit`, measured against `resolvedPreferences`; `drawbacks` only when preferences are missing |
| Factor sentences | `factors` + `conditions`; Wind and Temperature quote your limits from `resolvedPreferences` |
| Footer | `weather.attribution` (Apple Weather when empty) |
| Preferences, Ideal Temperature, Comfortable Wind | `GET /users/me` → `settings.riding`, `settings.preferences`, `settings.units`, `preferenceLevels`; each edit sends `PATCH /users/me {expectedVersion, settings}` after 0.6 s (explicit `null` removes a limit or the distance range; a 409 re-reads and re-sends), then Rides reloads |
| How Your Routes Fit | The last board Rides loaded, measured against the edited values in the app |

**Not wired yet.** Score-change badge and "Wind from the …" (API v0.25.0 is ready;
see [`ride-detail-api-requests.md`](ride-detail-api-requests.md)); unassessable routes aren't shown; factor prose is metric-only; a
conflicting settings edit (409) keeps the old saved window, though that load still uses the new
one; dates assume the device and the routes share a time zone; "Track a route" is still a no-op.
Preferences can now consume points lost, crosswind levels and linked sign-in methods.
Strava needs its own connection/sync implementation; seasonal guesses were declined in favor of
user-chosen monthly limits. Wind and distance units remain separate, saved choices
([`preferences-api-requests.md`](preferences-api-requests.md)); "How Your Routes
Fit" is empty until Rides has loaded once. The Rides day strip doesn't show the sheet's "Rain until 15:00"
style notes yet.
