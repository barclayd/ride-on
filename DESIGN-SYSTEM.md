# Ride On — Design System

iOS 26 / macOS 26, SwiftUI, Liquid Glass. Every screen is built from this document. When in
doubt, use the stock component and do nothing custom.

Source of truth for visuals: the **Ride On iOS Redesign** design canvas
(https://claude.ai/artifact/9rYWTxdZVkx21dpJRrue7T, October 2026), with every screen in light
and dark. The canvas's Design Language board is this document in picture form.

HIG references: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
[Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass),
[Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars),
[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars),
[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets),
[Maps](https://developer.apple.com/design/human-interface-guidelines/maps),
[Color](https://developer.apple.com/design/human-interface-guidelines/color).

---

## 1. Principles

1. **Ride On recommends routes; it doesn't navigate.** No Directions or turn-by-turn CTA
   anywhere. Actions point at riding the route elsewhere: send to a bike computer, add to
   Calendar, open in cycle.travel.
2. **Glass is the functional layer, never content.** Liquid Glass is for controls and
   navigation that float over content: toolbar buttons, the window capsule, the tab bar,
   sheets. Cards, rows, chips and badges are solid. Glass never sits on glass.
3. **Stock components first.** The iOS 26 SDK gives toolbars, tab bars, sheets, menus and
   forms their glass and their accessibility fallbacks for free. Custom `.glassEffect()` is a
   last resort and must implement those fallbacks by hand.
4. **Content goes full-bleed under the chrome.** The best pick's map runs edge to edge under
   the status bar and toolbar, so the glass has something to refract. Everything else is
   solid cards on the grouped background.
5. **Computed state drives the visuals.** The hero map is the actual route, the day strip is
   the actual best score each day, the wind strip is the actual wind along the route. No
   stock illustrations.
6. **One tinted action per screen, at most.** Zero is fine (Rides and Ride detail have none).
   The track star's gold is an on state, not a tinted action: it stays clear glass until the ride
   is tracked.
7. **Typography over iconography for data.** Scores, temperatures and times are typeset with
   monospaced digits. A verdict never relies on colour alone: it always has a symbol and words.

---

## 2. Materials & Glass Usage

| Surface | Treatment | API |
|---|---|---|
| Tab bar (Rides, Routes, Preferences) | System glass; shrinks to the selected tab's icon on scroll | `TabView` + `.tabBarMinimizeBehavior(.onScrollDown)` |
| Toolbars | System glass. At most 3 groups. Icons only, each with an accessibility label. Related actions share one capsule (share + more) | `.toolbar`, `ToolbarItemGroup`, `ToolbarSpacer` |
| Window capsule (Rides) | Toolbar item showing the window ("Wed 14 – Sun 18"); opens the window sheet | `ToolbarItem(placement: .navigation)` + `.sheet` |
| Controls over the hero map | **Clear** glass with a dimming layer under the status bar; turn regular once content scrolls under them | system toolbar over `.backgroundExtensionEffect()`; hero track star `.glassEffect(.clear.interactive())`, `.clear.tint(.committed)` while tracked |
| Sheets | System glass; Cancel leading, Done trailing | `.presentationDetents`, `Button(role: .cancel)`, `Button(role: .confirm)` |
| Partial-height sheets (Track) | System glass, floating inset over the dimmed screen; Close leading, actions as full-width capsules at the bottom | `.presentationDetents([.height(content)])`, `Button(role: .close)`, `.glassProminent` / `.glass` capsules |
| Pushed screens' back button | 44pt glass circle, chevron only | stock `NavigationStack` back button |
| Cards, rows, chips, badges | **Not glass.** Solid `secondarySystemGroupedBackground` | `.background(.background.secondary, in: .rect(cornerRadius: 26))` |

Rules:
- **Regular glass by default.** Clear glass only over rich media (the hero map), always with a
  ~35% dark gradient behind it so white glyphs stay legible.
- **Scroll edge effects, not dividers.** No hairlines under toolbars or between sections; the
  system edge effect separates scrolling content from chrome.
- **Group glass that can touch or morph** in one `GlassEffectContainer` (glass can't sample glass).
- **Tint is for the primary action only.** Toolbars and the tab bar stay monochrome; the
  selected tab carries the accent.
- **Accessibility fallbacks** (§8): Reduce Transparency → opaque; Increase Contrast → solid
  with a border. Custom glass must branch on `accessibilityReduceTransparency` itself.
- **Map attribution stays visible.** Anywhere a map shows, "Apple Maps" and the Legal link
  sit at least 10pt from custom content. Using a live `Map` gets this for free.

## 3. Colour

- **Semantic system colours** for all UI: `.primary`/`.secondary`/`.tertiary` labels,
  `systemGroupedBackground`, `secondarySystemGroupedBackground` for cards, `.fill.tertiary`
  for chips, `.separator`. Everything adapts to Dark Mode and Increase Contrast.
- **Accent**: green, defined once as `AccentColor` in the asset catalog. Light `#248A3D`, dark
  `#30D158` (the system green pair; the light value is darkened for 4.5:1 on white). Applied
  via `.tint()`. Text on an accent fill is white in light, black in dark. Exception: the hero's
  "Best pick" pill always sits on the dark scrim, so it is `pickPill` (`#1E7132`, the light
  accent 18% darker) with white text in both schemes.
- **Status colours** (always paired with a symbol and words):

  | Meaning | Light | Dark |
  |---|---|---|
  | Below your minimums | `#B23A00` | `#FF9F0A` |
  | Not in contention | `#8E8E93` | `#8E8E93` |
  | Tailwind | accent | accent |
  | Crosswind | `#E8A100` | `#FFD60A` |
  | Headwind | `#C93400` | `#FF453A` |
  | Rain chance | `#0A66D8` | `#64B5FF` |
  | Committed (tracked star, Track sheet medal) | `#C88A00` | `#C88A00` |

- **Temperature ramp** (`ConditionPalette`, the only custom palette): Apple Weather's
  convention, deep blue below 0° through green to red above 30°. Used by the Ideal
  Temperature range control and the temperature range bars.
- **`AmbianceStyle`** gradients are for the onboarding dial screens only. The Rides hero is
  the route's map, not a gradient.

## 4. Typography

SF Pro, system text styles only, Dynamic Type always on. No fixed point sizes in code.

| Role | Style | Example |
|---|---|---|
| Screen titles | `.largeTitle` bold, collapsing to inline | Preferences |
| Hero route name (over the map) | `.largeTitle` bold, white over the scrim | Hilly Loop |
| Section headers | `.title3` bold, **Title Case** | Other Tracked Routes |
| Card headlines | `.headline` | Meets your preferences |
| Body, factor explanations | `.body`, sentence case | Last ridden 29 Sep |
| Secondary lines | `.subheadline` | 12–14° · Crosswind · Cloudy |
| Footnotes, attribution | `.footnote` | Updated 08:12. Pull down to refresh. |
| Times, distances, scores | add `.monospacedDigit()` | 09:00 → ~12:00 · 51 km |

Section headers and screen titles are Title Case; everything else is sentence case. Dates are
en-GB ("Wednesday 14 October", "Wed 14 – Sun 18").

## 5. Layout & Shape

- **Grouped background** with solid cards, 16pt side margins, 26pt card radius. Nested
  shapes use `ConcentricRectangle` / `.rect(corners: .concentric)` rather than hard-coded radii.
- **Minimum target 44pt.** Toolbar circles are 44pt; the hero track star is 48pt.
- **The hero** (Rides and Ride detail): the map is full-bleed under the status bar and
  toolbar (`.ignoresSafeArea(edges: .top)` + `.backgroundExtensionEffect()`), with a bottom
  scrim for the title block and the Maps attribution row along the bottom edge.
- **Edge-to-edge scrolling** under the tab bar and toolbars; the system scroll edge effect
  handles legibility. Custom bottom bars use `.safeAreaBar(edge: .bottom)`.
- Breakpoints: iPhone = tab bar; iPad/Mac = `NavigationSplitView` with the same screens in
  the detail column.

## 6. Components (the complete custom inventory)

Anything not listed here is a stock SwiftUI component. The list is closed: add to it here
before adding a custom component in code.

1. **`RideHero`** — the best pick for the window, full-bleed: a non-interactive `Map`
   (`.mapStyle(.imagery)`, route polyline in the accent with a white casing, start marker),
   an eased bottom scrim (at least 340pt, black 0 → 80% on eased stops, no visible top edge),
   the title block (a "Best pick" / "Best that day" accent pill, the route name, then
   ↔ "51 km" and `mountain.2` "640 m climb" in `.subheadline` white 88%, with a soft text
   shadow) and the Maps attribution row. No date or times on the map: they lead the card below. The map ignores touches
   (taps belong to whatever the hero opens), so the attribution shows but Legal isn't tappable
   there. On Rides the hero is a `NavigationLink` and the `matchedTransitionSource` for the
   zoom into Ride detail; the clear-glass track star ("Track Hilly Loop on Wednesday 14
   October"; opens the Track sheet; `star.fill` on gold-tinted glass while tracked) is overlaid beside the link, not inside it, so VoiceOver reaches both. Ride detail shows the same map,
   400pt instead of 480pt, so the zoom lands on the same image.
2. **`ConditionChip`** — SF Symbol + value in `.footnote` on a solid `.fill.tertiary`
   capsule ("9–14°", "15 km/h tailwind", "Gusts 28 km/h", "Sunny spells"). Max 4 per row.
3. **`DayStrip`** — "Your Window": one bar per day in the window, height = that day's best
   score, the selected day tinted, rain-out days shown as a symbol and a stub. A day with no
   ride isn't tappable. An `HStack` of one `Button` per day (each a VoiceOver element with the
   selected trait), with a footnote summarising the window.
4. **`DeparturePicker`** — Ride detail's start-time choice: the best departure plus the next
   three in the window, each a tile with day, time and score. Like `DayStrip`, an `HStack` of
   one `Button` per tile with the selected trait (tiles stack at accessibility sizes), with a
   selection haptic. Choosing one updates everything below it.
5. **`FactorRow`** — one of the eight scoring factors: name, score out of 100, a bar
   (`ProgressView`), one plain-English sentence. Sorted high to low in "Why It Scored 86".
6. **`RouteProfile`** — "Along the Route": elevation (`AreaMark` + `LineMark`, peak marked)
   over a wind strip on the same km axis (`RectangleMark` bands: tailwind / crosswind /
   headwind, with a worded legend). Scrubbing with `chartXSelection`.
7. **`ScoreGauge`** — the score as a ring (`Gauge(.accessoryCircular)` style) on Ride detail
   (64pt), the Track sheet's ride card (40pt) and in widgets. On Rides the score is a plain number with a `ProgressView` bar and a ▲/▼
   change badge.
8. **`TemperatureRange`** — Ideal Temperature's two-handle range control on the temperature
   ramp, plus the Weather-style range bars in "How Your Routes Fit". Custom because SwiftUI
   has no range slider; each handle gets an adjustable accessibility action.
9. **`WindEnvelope`** — Comfortable Wind's polar shape (headwind, crosswind each side, any
   tailwind) with a dashed gust-limit ring. Drawn with `Canvas`; the native `Slider`s below it
   are the accessible way to set the same values.

Kept until their screens are redesigned: **`DialScreen`** (onboarding, with `AmbianceStyle`)
and **`SurfaceBar`** (Routes).

## 7. Motion

Use the tokens in `app/Packages/DesignSystem/Sources/DesignSystem/Motion.swift`; don't
hand-roll `.animation()` calls.

| Moment | Token |
|---|---|
| Default, no bounce | `.smooth` |
| Rides re-rank when the forecast changes | `.snappy`; rows slide to their new rank, ▲/▼ badge shows for a few seconds |
| Score number changes | `.contentTransition(.numericText())` |
| Hero → Ride detail | `.navigationTransition(.zoom(sourceID:in:))` with `matchedTransitionSource` on `RideHero` (push path only) |
| Clear → regular glass as content scrolls under the toolbar | system (scroll edge effect) |
| Tab bar shrinking on scroll | system (`.tabBarMinimizeBehavior(.onScrollDown)`) |
| Async content arriving | `.smooth` (`Motion.panelMaterialize`), never a hard cut |
| Haptics — stepped sliders, range handles, pickers | `.sensoryFeedback(.selection)` per step |
| Track sheet in and out | system sheet presentation (no bounce) |
| Star turning gold once the Track sheet has gone | `.contentTransition(.symbolEffect(.replace))` + `.symbolEffect(.bounce)`, `.sensoryFeedback(.success)` |

Reduce Motion: the zoom falls back to a cross-fade, re-rank slides become cross-fades,
glass transitions use `.materialize`.

## 8. Accessibility

- **Dynamic Type** through `accessibility5`: rows reflow, chips wrap, charts get
  `axChartDescriptor`.
- **Contrast**: 4.5:1 body / 3:1 large text, including white text over the hero scrim.
- **Meaning is triple-encoded**: colour + symbol + words ("⚠ Below your minimums",
  "Tailwind 32 km").
- **VoiceOver** reads the hero as one sentence: "Hilly Loop, best pick, Wednesday 14 October,
  09:00 to about 12:00, 51 kilometres, 640 metres climbing, score 86."
- **Reduce Transparency**: glass becomes opaque (`systemBackground`-family solid).
  **Increase Contrast**: glass becomes solid with a visible border.
- Every icon-only control has an accessibility label ("Rides", "Track a route", "Share",
  "More", "Send route to a bike computer", "Track Hilly Loop on Wednesday 14 October").

## 9. Screen ↔ pattern map

| Screen | What's on it |
|---|---|
| **Rides** (tab) | `RideHero` for the best pick in the window → conditions card (date, then 09:00 Leave ┄ 🚲 about 3h ┄ ~12:00 Back, then "✓ Meets your preferences", last ridden, `ConditionChip`s, score with bar and change badge) → "Your Window" `DayStrip` → "Other Tracked Routes" rows (route thumbnail, name, departure → return · distance, conditions or "Below your minimums", score) → "Doesn't Fit Your Window" → Apple Weather attribution, "Updated 08:12. Pull down to refresh." Toolbar: window capsule (leading), "+" track a route (trailing). Pull to refresh. |
| **Ride detail** (push, zoom from hero) | Shorter `RideHero` → verdict card (`ScoreGauge`, verdict, change since last update, last ridden, one or two notes) → "Departure" `DeparturePicker` → "Forecast on the Ride" hourly grid (time, sky, temperature, wind, gusts, rain chance) → "Along the Route" `RouteProfile` → "Why It Scored 86" `FactorRow`s → Add to Calendar, Open in cycle.travel (accent list buttons) → Apple Weather attribution. Toolbar: back (leading), share + more in one capsule (trailing). |
| **Window sheet** | Large detent (the days list plus Hours need the height). Grabber, Cancel (glass circle, `xmark`) leading, centred "Ride Window", Done (tinted circle, `checkmark`) trailing. Quick picks (Tomorrow, This Weekend, Next 5 Days) → "Days" multi-select list, each day showing its best route and score, sky and temperature → "Hours": segmented Daylight / Custom, Leave After and Back By (`DatePicker(.hourAndMinute)` when Custom). |
| **Track sheet** | Content-height detent, floating glass. Grabber, Close (glass circle, `xmark`) leading → gold star medal with a bell badge → "Track This Ride" and one sentence → ride card (thumbnail, name, day and times, 40pt `ScoreGauge`) → "Notify Me If" rows (rain, gusts over your limit, below your minimum, a better time or day) and the evening-before footnote → "Start Tracking" (`.glassProminent`, the one tinted action) and "Not Now". Tracking mode: "Tracking This Ride", Notifications Are Off card when denied, "We'll Notify You If", "Stop Tracking" (`.glass`, red label). |
| **Window passed** | Rides when the saved window is in the past. No hero, so the toolbar is regular glass and the capsule shows the stale range. `ContentUnavailableView` ("Your Window Has Passed", one sentence, "Choose Dates" as the one `.borderedProminent` button) → "Quick Picks" rows with each range's best route and score. |
| **Preferences** (tab) | `Form` with a large title and subtitle "Changes re-rank your rides straight away." Sections: What Makes a Good Ride (Ideal Temperature and Comfortable Wind push to their screens; Sunshine, Rain, Climbing, Recently Ridden are menus; Distance), Deal-Breakers, Riding (average speed stepper, "Use My Strava Average", departure interval), Units (segmented), Connections (Strava, Apple Health), Account. Plumbing is plain settings rows; taste gets a visual screen. |
| **Ideal Temperature** (push) | Big range readout, `TemperatureRange`, one-line explanation → "How Your Routes Fit" range bars per route → "Deal-Breakers" steppers. Saves automatically; no Done. |
| **Comfortable Wind** (push) | `WindEnvelope` → "Limits" sliders (headwind, crosswind, gusts) and crosswind sensitivity → "How Your Routes Fit". Saves automatically. |
| **Widgets & Lock Screen** | `systemSmall` (score ring, day and time, route, one line of conditions), `systemMedium` (map thumbnail, best pick, times, conditions, runner-up). Lock Screen `accessoryInline`, `accessoryCircular` (score ring + day), `accessoryRectangular`. Tap opens the ride. |
| **Routes** (tab) | Not yet redesigned: searchable list with suggestion chips, Saved/Ridden segmented toggle. |
| **Onboarding** | Not yet redesigned: one control per screen (`DialScreen`), permissions primed one sentence before each system prompt, location on first Rides entry, Health before ride matching. |
| **Weather attribution** | Apple Weather mark + "Other data sources" link (https://developer.apple.com/weatherkit/data-source-attribution/) wherever forecast data shows, via `WeatherService.attribution`. |
