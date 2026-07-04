# Landmarks-standard redesign checklist

Derived from Apple's WWDC 2025 sample "Landmarks: Building an app with Liquid Glass"
(https://developer.apple.com/documentation/SwiftUI/Landmarks-Building-an-app-with-Liquid-Glass)
plus a full audit of this app against it. Work lands as small PRs; tick items as they merge.

## A. Navigation & structure

- [x] **Mac Today card pager** — `TabView` without `.page` renders as a literal tab strip on
  macOS. Replaced with a paging `ScrollView` (`scrollTargetBehavior(.viewAligned)` +
  `containerRelativeFrame` + `contentMargins`), identical on both platforms. (`TodayView.swift`)
- [ ] **Routes as split-view column** — on Mac/iPad, Route Detail should be the detail column of
  the existing `NavigationSplitView`, not a push inside one pane. (`RideOnApp.swift`, `RoutesView.swift`)
- [ ] **Route Detail inspector** — factor breakdown / stats belong in `.inspector` on Mac/iPad
  (Landmarks uses one for landmark editing). (`RouteDetailView.swift`)
- [x] **macOS Settings scene (⌘,)** — natural home for the units toggle (task #18) and
  preferences. (`RideOnApp.swift`)
- [ ] **Filter chips → `.searchSuggestions`** — DESIGN-SYSTEM §9 already asks for this;
  Landmarks hoists one `.searchable` to the split-view root. (`RoutesView.swift`)

## B. Liquid Glass correctness

- [x] **Kill fake glass** — `SpeedPrefillStep`'s `.white.opacity(0.12)` panel → `.ultraThinMaterial`
  (respects Reduce Transparency). (`SpeedPrefillStep.swift`)
- [x] **Today pill → `.safeAreaBar`** — was `.overlay(alignment: .bottom)`, violating
  DESIGN-SYSTEM §5; content now lays out above the pill automatically. (`TodayView.swift`)
- [ ] **`GlassEffectContainer` around ContextPillButton** — required once a second glass element
  shares the screen; Landmarks wraps all custom glass. (`TodayView.swift`)
- [x] **Shared `.tagCapsule()`** — the hand-rolled opacity-fill capsule was duplicated in
  `RouteRow` and `RideLogView`; now one SharedUI helper. (`SharedUI.swift`)

## C. Toolbars

- [x] **Export GPX → toolbar `ShareLink`** — was an inline content button; Landmarks puts share
  actions in the toolbar's glass capsule. (`RouteDetailView.swift`)
- [ ] **`ToolbarSpacer` grouping** — use `.fixed`/`.flexible` spacers to split toolbar items into
  separate glass capsules where more than one action exists (Routes: Import + scope picker).

## D. Spacing, layout & type

- [ ] **Centralized layout constants** — Landmarks keeps every radius/padding in one
  `Constants.swift`; DesignSystem should own `cornerRadius`/`standardPadding` tokens instead of
  the six hard-coded radii (8/14/16/20/24) scattered across views.
- [ ] **`ConcentricRectangle` for nested corners** — DESIGN-SYSTEM §5 mandates it; currently
  unused anywhere.
- [ ] **`@ScaledMetric` for fixed dimensions** — thumbnail sizes, ring sizes, etc. currently
  don't scale with Dynamic Type.
- [ ] **Route Detail width cap on Mac** — content stretches edge-to-edge in wide windows; cap
  with `frame(maxWidth:)` and center.
- [ ] **Route Detail map interactivity** — `.allowsHitTesting(false)` makes the hero inert;
  consider tap-to-expand or pan-enabled map.

## E. Color unification

- [ ] **One score→color ramp** — FactorRow's RangeBar (red/yellow/green), ScoreRing's tint, and
  SurfaceBar's palette are three independent ramps; unify behind `ConditionPalette`.

## F. Code practice

- [ ] **`#Preview` coverage** — Landmarks has one in every view file (with `@Previewable @State`);
  this app has zero. Add previews backed by FixtureWorld data, starting with SharedUI components.
- [ ] **PlatformImage dedup** — the `#if os(macOS) Image(nsImage:) #else Image(uiImage:)` branch
  is duplicated in `RideCard` and `RoutesView`; one `Image(platformImage:)` init in SharedUI.
- [x] **Dead code** — removed unused `Motion.sheetPresentation` token and the always-true
  `#available(iOS 26, macOS 26)` gate around `backgroundExtensionEffect()`.
- [ ] **Onboarding accessibility** — the manual `Group`-switch page flow posts no VoiceOver
  screen-change announcements; add `AccessibilityNotification.ScreenChanged` on step change.
- [ ] **You tab visual-language cleanup** — mixes dial takeovers, Forms, and plain Lists; settle
  on Form-based editing per Landmarks' editing surfaces (Material, never glass, for content).
- [ ] **`.xcstrings` localization catalog** — Landmarks comments every string; we have raw
  string literals throughout. Defer until copy stabilizes.

Strengths already matching Landmarks: ScoreRing is a stock `Gauge`, ElevationProfile is Swift
Charts with an `AXChartDescriptor`, semantic colors + Dynamic Type styles are used throughout,
and DESIGN-SYSTEM.md's closed component inventory mirrors Landmarks' restraint with custom glass.
