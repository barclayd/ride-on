# Landmarks-standard redesign checklist

Derived from Apple's WWDC 2025 sample "Landmarks: Building an app with Liquid Glass"
(https://developer.apple.com/documentation/SwiftUI/Landmarks-Building-an-app-with-Liquid-Glass)
plus a full audit of this app against it. Work lands as small PRs; tick items as they merge.

## A. Navigation & structure

- [x] **Mac Today card pager** — `TabView` without `.page` renders as a literal tab strip on
  macOS. Replaced with a paging `ScrollView` (`scrollTargetBehavior(.viewAligned)` +
  `containerRelativeFrame` + `contentMargins`), identical on both platforms. (`TodayView.swift`)
- [x] **Routes as split-view column** — on Mac/iPad, Route Detail should be the detail column of
  the existing `NavigationSplitView`, not a push inside one pane. Routes tab now uses a
  three-column split (sidebar / routes list / detail); iPhone keeps push navigation.
  (`RideOnApp.swift`, `RoutesView.swift`)
- [x] **Route Detail inspector** — stats, best-day, and ride history now live in a toggleable
  `.inspector` on Mac (Landmarks idiom). Skipped on iPad: the Routes tab is already a
  three-column split there, a fourth column crowds it. (`RouteDetailView.swift`)
- [x] **macOS Settings scene (⌘,)** — natural home for the units toggle (task #18) and
  preferences. (`RideOnApp.swift`)
- [x] **Filter chips → `.searchSuggestions`** — DESIGN-SYSTEM §9 already asks for this;
  Landmarks hoists one `.searchable` to the split-view root. Chips now appear as toggleable
  suggestions under the focused search field (Maps' pre-typed pattern); the inline chip row
  only shows while a filter is active, so it stays removable. (`RoutesView.swift`)

## B. Liquid Glass correctness

- [x] **Kill fake glass** — `SpeedPrefillStep`'s `.white.opacity(0.12)` panel → `.ultraThinMaterial`
  (respects Reduce Transparency). (`SpeedPrefillStep.swift`)
- [x] **Today pill → `.safeAreaBar`** — was `.overlay(alignment: .bottom)`, violating
  DESIGN-SYSTEM §5; content now lays out above the pill automatically. (`TodayView.swift`)
- [x] **`GlassEffectContainer` around ContextPillButton** — required once a second glass element
  shares the screen; Landmarks wraps all custom glass. (`TodayView.swift`)
- [x] **Shared `.tagCapsule()`** — the hand-rolled opacity-fill capsule was duplicated in
  `RouteRow` and `RideLogView`; now one SharedUI helper. (`SharedUI.swift`)

## C. Toolbars

- [x] **Export GPX → toolbar `ShareLink`** — was an inline content button; Landmarks puts share
  actions in the toolbar's glass capsule. (`RouteDetailView.swift`)
- [x] **`ToolbarSpacer` grouping** — use `.fixed`/`.flexible` spacers to split toolbar items into
  separate glass capsules where more than one action exists. Applied in Route Detail on Mac,
  where the inspector toggle joined Export GPX as a second `.primaryAction`.

## D. Spacing, layout & type

- [x] **Centralized layout constants** — DesignSystem now owns a semantic `CornerRadius` token
  set (card/hero/panel/badge/thumbnail); no view hard-codes a radius anymore. (`Layout.swift`)
- [ ] **`ConcentricRectangle` for nested corners** — DESIGN-SYSTEM §5 mandates it *for nested
  shapes*. N/A today: no rounded shape sits inset inside another rounded container — apply the
  moment one does.
- [x] **`@ScaledMetric` for fixed dimensions** — RouteRow thumbnail, BreakdownSheet ScoreRing,
  and the fixed-size SF Symbols (priming sheet, rest-day leaf, finish checkmark) now scale with
  Dynamic Type.
- [x] **Route Detail width cap on Mac** — content stretches edge-to-edge in wide windows; cap
  with `frame(maxWidth:)` and center.
- [ ] **Route Detail map interactivity** — `.allowsHitTesting(false)` makes the hero inert;
  consider tap-to-expand or pan-enabled map.

## E. Color unification

- [x] **One score→color ramp** — FactorRow's RangeBar and ScoreRing disagreed on the middle
  band (yellow vs accent); both now use `ConditionPalette.color(forScore:)`. SurfaceBar's
  palette is categorical (per surface type, semantic system colors), not a score ramp — left as is.

## F. Code practice

- [x] **`#Preview` coverage** — Landmarks has one in every view file (with `@Previewable @State`);
  this app has zero. Every SharedUI component file now has one (ElevationProfile uses
  `@Previewable @State` for chart scrubbing). Screen-level views (Today/Routes/You/Onboarding)
  need the full services environment — add those when FixtureWorld grows a preview-friendly
  entry point.
- [x] **PlatformImage dedup** — the `#if os(macOS) Image(nsImage:) #else Image(uiImage:)` branch
  is duplicated in `RideCard` and `RoutesView`; one `Image(platformImage:)` init in SharedUI.
- [x] **Dead code** — removed unused `Motion.sheetPresentation` token and the always-true
  `#available(iOS 26, macOS 26)` gate around `backgroundExtensionEffect()`.
- [x] **Onboarding accessibility** — the manual `Group`-switch page flow posts no VoiceOver
  screen-change announcements; add `AccessibilityNotification.ScreenChanged` on step change.
- [ ] **You tab visual-language cleanup** — mixes dial takeovers, Forms, and plain Lists; settle
  on Form-based editing per Landmarks' editing surfaces (Material, never glass, for content).
- [ ] **`.xcstrings` localization catalog** — Landmarks comments every string; we have raw
  string literals throughout. Defer until copy stabilizes.

Strengths already matching Landmarks: ScoreRing is a stock `Gauge`, ElevationProfile is Swift
Charts with an `AXChartDescriptor`, semantic colors + Dynamic Type styles are used throughout,
and DESIGN-SYSTEM.md's closed component inventory mirrors Landmarks' restraint with custom glass.
