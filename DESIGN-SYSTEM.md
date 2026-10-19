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
   The track bell's gold is an on state, not a tinted action: it stays clear glass until the ride
   is tracked.
7. **Typography over iconography for data.** Scores, temperatures and times are typeset with
   monospaced digits. A verdict never relies on colour alone: it always has a symbol and words.

---

## 2. Materials & Glass Usage

| Surface | Treatment | API |
|---|---|---|
| Tab bar (Rides, Routes, Preferences) | System glass; shrinks to the selected tab's icon on scroll. Never on Routes, where the panel scrolls rather than the screen | `TabView` + `.tabBarMinimizeBehavior(.onScrollDown)` (`.never` on Routes) |
| Toolbars | System glass. At most 3 groups. Icons only, each with an accessibility label. Related actions share one capsule (share + more) | `.toolbar`, `ToolbarItemGroup`, `ToolbarSpacer` |
| Window capsule (Rides) | Toolbar item showing the window ("Wed 14 – Sun 18"); opens the window sheet | `ToolbarItem(placement: .navigation)` + `.sheet` |
| Controls over the hero map | **Clear** glass with a dimming layer under the status bar; turn regular once content scrolls under them | system toolbar over `.backgroundExtensionEffect()`; hero track bell `.glassEffect(.clear.interactive())`, `.clear.tint(.committed)` while tracked |
| Routes panel | **Regular** glass floating over the map, 8pt from the screen edges and 14pt above the tab bar; grabber, search and "+" pinned, everything else scrolling beneath and fading into the bottom edge | `FloatingPanel` (§6): `.glassEffect(.regular, in: .rect(cornerRadius: 34))`, `.safeAreaBar(edge: .top)` |
| Controls over the Routes map (map style, my location) | **Clear** glass capsule, white glyphs, held at a fixed size like MapKit's own. Over the light cycle map (`CycleMap`, §6), **regular** glass with `.primary` glyphs instead, held light in Dark Mode as the map is | `.glassEffect(.clear.interactive(), in: .capsule)` (`.regular.interactive()` and `.environment(\.colorScheme, .light)` over the cycle map), `.dynamicTypeSize(...xLarge)` + `.accessibilityShowsLargeContentViewer()` |
| Sheets | System glass; Cancel leading, Done trailing | `.presentationDetents`, `Button(role: .cancel)`, `Button(role: .confirm)` |
| Partial-height sheets (Track) | System glass, floating inset over the dimmed screen; Close leading, actions as full-width capsules at the bottom | `.presentationDetents([.height(content)])`, `Button(role: .close)`, `.glassProminent` / `.glass` capsules |
| Pushed screens' back button | 44pt glass circle, chevron only | stock `NavigationStack` back button |
| Cards, rows, chips, badges | **Not glass.** Solid `secondarySystemGroupedBackground` | `.background(.background.secondary, in: .rect(cornerRadius: 26))` |

Rules:
- **Regular glass by default.** Clear glass only over rich media (the hero map, the Routes
  map), with a ~35% dark gradient behind it on the hero so white glyphs stay legible (the
  Routes map's satellite looks are dark enough on their own). The cycle map is light, so controls
  over it use regular glass, held light in Dark Mode; nothing dims it, and the status bar's glyphs
  go dark over it (`.toolbarColorScheme(.light, for: .navigationBar)`).
- **Scroll edge effects, not dividers.** No hairlines under toolbars or between sections; the
  system edge effect separates scrolling content from chrome.
- **Group glass that can touch or morph** in one `GlassEffectContainer` (glass can't sample glass).
- **Tint is for the primary action only.** Toolbars and the tab bar stay monochrome; the
  selected tab carries the accent.
- **Accessibility fallbacks** (§8): Reduce Transparency → opaque; Increase Contrast → solid
  with a border. Custom glass must branch on `accessibilityReduceTransparency` itself; Routes
  does it through `accessibleGlass(_:in:fallback:)`.
- **Map attribution stays visible.** Anywhere a map shows, its attribution sits at least 10pt
  from custom content: "Apple Maps" and the Legal link for MapKit (a live `Map` gets this for
  free); "© OpenStreetMap", linking to https://www.openstreetmap.org/copyright, "Protomaps" and
  "Mapterhorn" (its terrain), with OS Terrain 50's "Contains OS data © Crown copyright and database
  right 2026" on a line below, for the cycle map (`CycleMap` draws it). Snapshots shown larger than a
  thumbnail carry it too: a shortlist card's cycle-map snapshot, drawn without terrain, has "©
  OpenStreetMap" and "Protomaps" as plain text in the card's white, 10pt under its stats (the card is
  a button, so no links); thumbnails are too small for it.

## 3. Colour

- **Semantic system colours** for all UI: `.primary`/`.secondary`/`.tertiary` labels,
  `systemGroupedBackground`, `secondarySystemGroupedBackground` for cards, `.fill.tertiary`
  for chips, `.separator`. Everything adapts to Dark Mode and Increase Contrast.
- **Accent**: green, defined once as `AccentColor` in the asset catalog. Light `#248A3D`, dark
  `#30D158` (the system green pair; the light value is darkened for 4.5:1 on white). Applied
  via `.tint()`. Text on an accent fill is white in light, black in dark. Exception: the hero's
  "Best pick" pill always sits on the dark scrim, so it is `pickPill` (`#1E7132`, the light
  accent 18% darker) with white text in both schemes. Routes cards' "Below your minimums"
  pill is over the map too, so it is `belowMinimumsPill` (`#FF9F0A`) with black text in both
  schemes.
- **Status colours** (always paired with a symbol and words):

  | Meaning | Light | Dark |
  |---|---|---|
  | Below your minimums | `#B23A00` | `#FF9F0A` |
  | Not in contention | `#8E8E93` | `#8E8E93` |
  | Tailwind | accent | accent |
  | Crosswind | `#E8A100` | `#FFD60A` |
  | Headwind | `#C93400` | `#FF453A` |
  | Rain chance | `#0A66D8` | `#64B5FF` |
  | Committed (tracked bell, Track sheet medal) | `#C88A00` | `#C88A00` |

- **Temperature ramp** (`ConditionPalette`, the only custom palette): Apple Weather's
  convention, deep blue below 0° through green to red above 30°. Used by the Ideal
  Temperature range control and the temperature range bars.
- **`AmbianceStyle`** gradients are for the onboarding dial screens only. The Rides hero is
  the route's map, not a gradient.
- **Cycle map palette**: the cycle map's colours (land, roads, cycle routes, paths, labels) copy
  cycle.travel's map and live in its map style, not in SwiftUI or the asset catalog. Values and
  the rules behind them: [`docs/maps/cycle-travel-style.md`](docs/maps/cycle-travel-style.md).
  The map stays light in Dark Mode for now; a dark variant is an open decision
  ([`docs/maps/README.md`](docs/maps/README.md#open-decisions), 6). Over it the status bar and the
  map controls stay light too (§2); the system tab bar's labels don't yet, and read at 1.4:1 there in
  Dark Mode (WS2.7 in the same doc).

## 4. Typography

SF Pro, system text styles only, Dynamic Type always on. No fixed point sizes in code.

One exception: **labels drawn inside the cycle map** (place, street and route names, the
route-number badges) are Montserrat at the map style's own sizes, to match cycle.travel. They're
part of the map image, like Apple Maps' labels, so they don't follow Dynamic Type. Anything
SwiftUI draws over a map (callouts, the hero title, pills) stays SF Pro.

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
- **Routes** is a full-screen map with the panel floating over it: 34pt radius, medium detent
  56% of the height above the tab bar, large up to the safe-area top. Selected rows use a 22pt
  radius, row thumbnails 11pt (`CornerRadius.floatingPanel` / `.selectedRow` /
  `.panelThumbnail`). On iPad and Mac the panel is a 380pt column down the leading edge.
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
   400pt instead of 480pt, so the zoom lands on the same image. Pulled down past the top (pull to
   refresh), the map scales up from its bottom edge to fill the gap, so no background shows above it.
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

10. **`FloatingPanel`** — the Routes panel (§2, §5). On iPhone it rests at a medium and a large
    detent; a drag on its header tracks 1:1, rubber-bands past either end, and settles on the
    detent its momentum projects to (`Motion.panelDetent`). Tapping the grabber toggles it;
    pulling the content down past its top at large lets it go to medium, like a sheet. On iPad
    and Mac it's a fixed full-height column with no grabber.
11. **`ShortlistCard`** — a shortlisted route in the panel's carousel (272 × 158pt, card
    radius): its loop on a `CycleMap` snapshot (satellite imagery on the Mac), a status pill
    ("Best pick · Wed", "Thu 09:00", "Below your minimums", "Too long for your window",
    "Checking the forecast…"), name, ↔ distance, `mountain.2` climb, and the score out of 100
    when Rides has ranked it. The white check takes it off the shortlist. Selected, it gets a 3pt
    accent outline. At accessibility sizes it takes the carousel's width and its stats stack.
12. **`RoutesMap`** — the Routes tab's live map: other shortlisted routes in white, the selected
    one in the accent with a white casing and start marker, and a callout over its northernmost
    point ("Hilly Loop 51 km", or the ride's date from History). Tapping within 22pt of a line
    selects that route. `MapControls` (style menu, my location) sit at its top trailing corner.
    The style menu offers Cycle (`CycleMap`), the look at launch, then Satellite, Hybrid and
    Standard. The Mac has no Cycle look and opens on Satellite.
13. **Panel rows** (`LibraryRow`, `HistoryRow`) — a 48pt route thumbnail, name, "42 km · 180 m ·
    46% unpaved", then the source and last ride (Library) or the forecast saved when the ride
    was planned (History; never the weather on the day). Selected, the row fills with
    `.fill.tertiary` and shows "Add to Shortlist" and, for a route Rides has ranked, "Details ›".
14. **`ShareBar`** — shares of a whole in ride order, each in its own colour, like the bar in
    Settings › iPhone Storage: a 16pt (scaled) continuous rounded bar with 2pt gaps. A segment may
    carry a `.caption2` label over where it starts ("SW", "W"). Its card writes the ride's start
    under the leading edge and "~finish" under the trailing one, with a worded legend below (dot,
    name, "~45%", or "Throughout" when there's only one). Hidden from VoiceOver; the legend speaks.
    Sky colours: sunny `.yellow`, sunny intervals `.yellow` 50%, cloud `.gray`, data unavailable
    `.gray` 15%. Wind colours as `RouteProfile`: tailwind accent, crosswind `.orange`, headwind
    `.red`, light wind `.gray`.
15. **`WindCompass`** — Weather's wind dial (104pt, scaled, at most 160pt): ticks every 5°, N E S W
    (N in `.primary`), an arrow across the dial the way the wind blows, the average speed in the
    middle. No arrow when the wind is too light to name a direction. Hidden from VoiceOver: the
    header beside it says the same.
16. **`WindRouteMap`** — "Wind on the Ride"'s map: the route coloured by the wind's effect (`ShareBar`'s
    wind colours, white casing), Start marker, and Finish unless the ride ends where it started. A
    muted standard map without points of interest, ignoring touches, 180pt, flush with the top of
    its card. Where the road is ridden twice the return is drawn 3pt to the right of the way out, as
    on a transit map, so both colours show. Shown only when the API placed the wind stretches along
    the route. VoiceOver reads the journey: "Heads north-east with the wind behind, then …".
17. **`CycleMap`** — a map that looks like cycle.travel's: OpenStreetMap data in our own style,
    cycle routes as dots over the road beneath them, route-number badges, cycle paths by surface,
    labels in Montserrat (§4). MapLibre Native on iOS, drawing Ride On's own vector tiles with a
    style bundled in the app. The Mac stays on MapKit for the first release: no Cycle look, satellite
    cards and outline thumbnails. Routes are drawn as map layers below the labels, in the same
    colours and white casing as on MapKit. Live and interactive as
    `RoutesMap`'s Cycle look; cards and thumbnails get static snapshots of it, never live maps:
    `MLNMapSnapshotter` draws each once per route, framing, tint, size and scale, without labels or
    terrain, and keeps it in memory. Until one is ready the route stands on the style's land colour exactly
    where the snapshot will put it, then the snapshot fades in (`Motion.panelMaterialize`).
    Hills are shaded and carry 10 m contours, as on cycle.travel. Its attribution is always visible
    (§2): "© OpenStreetMap", "Protomaps" and "Mapterhorn", then the OS statement on a second line, in
    `.caption2` `.secondary` at the safe area's bottom leading corner, 12pt in, held at a fixed size
    like the map controls. A tap within 22pt of a line selects it; a double tap only zooms. The selected
    route's callout is pinned over its northernmost point as on MapKit. In the fixture world it
    draws the style's land colour only, offline. Plan, data pipeline and open decisions in
    [`docs/maps/README.md`](docs/maps/README.md).
    `RideHero` stays on satellite imagery and `WindRouteMap` on the muted standard map until
    those decisions say otherwise.

Kept until onboarding is redesigned: **`DialScreen`** (with `AmbianceStyle`).

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
| Routes panel settling on a detent | `Motion.panelDetent(velocity:)`: a spring (response 0.35, damping 0.86) starting at the drag's release velocity; `.smooth` with Reduce Motion |
| Shortlist card press, row selection | `Motion.glassTapLayout` |
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
| **Ride detail** (push, zoom from hero) | Shorter `RideHero` → verdict card (`ScoreGauge`, verdict, change since last update, last ridden, one or two notes) → "Departure" `DeparturePicker` → "Forecast on the Ride" hourly grid (time, sky, temperature, wind, gusts, rain chance) → "Sky on the Ride" (symbol and summary, sun `ShareBar`, legend) → "Wind on the Ride" (`WindRouteMap`, "Wind from the south-west" beside a `WindCompass`, wind `ShareBar`, legend with speeds, gusts row) → "Along the Route" `RouteProfile` → "Why It Scored 86" `FactorRow`s → Add to Calendar, Open in cycle.travel (accent list buttons) → Apple Weather attribution. Toolbar: back (leading), share + more in one capsule (trailing). |
| **Window sheet** | Large detent (the days list plus Hours need the height). Grabber, Cancel (glass circle, `xmark`) leading, centred "Ride Window", Done (tinted circle, `checkmark`) trailing. Quick picks (Tomorrow, This Weekend, Next 5 Days) → "Days" multi-select list, each day showing its best route and score, sky and temperature → "Hours": segmented Daylight / Custom, Leave After and Back By (`DatePicker(.hourAndMinute)` when Custom). |
| **Track sheet** | Content-height detent, floating glass. Grabber, Close (glass circle, `xmark`) leading → gold star medal → "Track This Ride" and one sentence → "Replaces Your Tracked Ride" card when another ride is tracked → ride card (thumbnail, name, day and times, 40pt `ScoreGauge`) → "We'll Check If" rows (rain, gusts over your limit, below your minimum, a better time or day) and a footnote → "Start Tracking" (`.glassProminent`, the one tinted action) and "Not Now". Tracking mode: "Tracking This Ride" and what the latest check found, "We'll Check If", "Stop Tracking" (`.glass`, red label). Once the API notifies: a bell badge on the medal, "Notify Me If" / "We'll Notify You If", the evening-before footnote and a Notifications Are Off card when denied. |
| **Window passed** | Rides when the saved window is in the past. No hero, so the toolbar is regular glass and the capsule shows the stale range. `ContentUnavailableView` ("Your Window Has Passed", one sentence, "Choose Dates" as the one `.borderedProminent` button) → "Quick Picks" rows with each range's best route and score. |
| **Preferences** (tab) | `Form` with a large title and subtitle "Changes re-rank your rides straight away." Sections: What Makes a Good Ride (Ideal Temperature and Comfortable Wind push to their screens; Sunshine, Rain, Climbing, Recently Ridden are menus; Distance), Deal-Breakers, Riding (average speed stepper, "Use My Strava Average", departure interval), Units (segmented), Connections (Strava, Apple Health), Account. Plumbing is plain settings rows; taste gets a visual screen. |
| **Ideal Temperature** (push) | Big range readout, `TemperatureRange`, one-line explanation → "How Your Routes Fit" range bars per route → "Deal-Breakers" steppers. Saves automatically; no Done. |
| **Comfortable Wind** (push) | `WindEnvelope` → "Limits" sliders (headwind, crosswind, gusts) and crosswind sensitivity → "How Your Routes Fit". Saves automatically. |
| **Widgets & Lock Screen** | `systemSmall` (score ring, day and time, route, one line of conditions), `systemMedium` (map thumbnail, best pick, times, conditions, runner-up). Lock Screen `accessoryInline`, `accessoryCircular` (score ring + day), `accessoryRectangular`. Tap opens the ride. |
| **Routes** (tab) | Full-screen `RoutesMap`, the cycle map on iOS and satellite on the Mac (shortlist in white, selected route in the accent, callout, start marker; `MapControls` top trailing) under the `FloatingPanel`: search capsule ("Search Routes") and "+" menu (Import GPX File, From cycle.travel, Connect Strava) pinned → "Shortlist" with "4 of 12" → `ShortlistCard` carousel → segmented Library N / History N → Library rows, or History rows grouped by month ("October 1 ride") ending with "Weather is the forecast from when you planned each ride, not what you rode in." Selecting a card or row shows it on the map. Focusing search expands the panel. No navigation bar; the tab bar never minimises. |
| **Onboarding** | Not yet redesigned: one control per screen (`DialScreen`), permissions primed one sentence before each system prompt, location on first Rides entry, Health before ride matching. |
| **Weather attribution** | Apple Weather mark + "Other data sources" link (https://developer.apple.com/weatherkit/data-source-attribution/) wherever forecast data shows, via `WeatherService.attribution`. |
