# Ride On — Design System

iOS 26 / macOS 26 (Tahoe), SwiftUI, Liquid Glass. One codebase, native on both platforms.
Every screen in the app is built from this document. When in doubt: use the stock component and do nothing custom.

Sources: Apple HIG (Materials, Layout, Color, Typography, Sheets, Tab Bars, Toolbars, Onboarding, Privacy), WWDC25 sessions 219 / 323 / 356 / 204 / 313, and pattern studies of Apple Sports, Invites, Maps, Weather, and Fitness. Key API references inline.

---

## 1. Principles

1. **Glass is chrome, never content.** Liquid Glass lives only on the navigation/control layer: tab bar, toolbars, sidebar, sheets at partial detents, floating pills. Never on ride cards, maps, charts, or list content. (HIG: "Don't use Liquid Glass in the content layer.")
2. **Stock components first.** Compiling against the iOS 26 SDK gives toolbars, tab bars, sheets, alerts, menus, and sidebars their glass appearance for free — and their accessibility adaptations (Reduce Transparency/Motion, Increase Contrast) for free. Custom `.glassEffect()` is a last resort and must hand-implement those fallbacks.
3. **Computed state drives the visuals.** The Apple "tell" isn't glass — it's imagery rendered from real data: Weather's sky is the actual sky, Maps' card order is the actual ETA. Our card ambiance, condition chips, and factor bars are always rendered from the actual forecast + route computation for that ride. No stock "sunny day" illustration assets, ever.
4. **One concept per screen, one tinted action per screen.** Fitness onboarding grammar; HIG color-on-glass rule.
5. **Typography over iconography for data.** Apple Sports encodes state in weight/size of SF Pro, not badges. Scores, temperatures, and ETAs are typeset, not iconified.

---

## 2. Materials & Glass Usage

| Surface | Treatment | API |
|---|---|---|
| Tab bar | System glass, free | `TabView` + `.tabBarMinimizeBehavior(.onScrollDown)` |
| Toolbars / nav bar | System glass, free; group with spacers | `.toolbar`, `ToolbarSpacer(.fixed/.flexible, placement:)` |
| Factor-breakdown sheet | System glass at partial detents, free | `.presentationDetents([.fraction(0.35), .medium, .large])` — remove any manual `.presentationBackground` |
| Mac sidebar | Floating glass panel, free | `NavigationSplitView`; detail uses `.backgroundExtensionEffect()` |
| Floating controls over the Today card (bike/hours/intent pill) | Custom glass — the one sanctioned use | `.glassEffect(.regular.interactive())` inside a single `GlassEffectContainer` |
| Buttons on glass | `.buttonStyle(.glass)`; primary action `.buttonStyle(.glassProminent)` + `.buttonBorderShape(.capsule)` |
| Content cards (stats, factor rows) | **Not glass.** `.background(.regularMaterial, in: .rect(corners: .concentric))` or opaque secondary background |

Rules:
- **Regular glass everywhere.** `Glass.clear` only if an element ever floats directly over photographic card media — and then with the HIG 35% dim layer over bright content. Never mix regular and clear in one context.
- All custom glass elements that can overlap or morph share one `GlassEffectContainer` (glass cannot sample glass).
- Custom glass must branch on `@Environment(\.accessibilityReduceTransparency)` → opaque `Material` fallback.

## 3. Color

- **Semantic system colors only** for UI: `.primary`, `.secondary`, `Color(.systemBackground)` family. Vibrant foreground styles on any material — never hardcoded hex on glass.
- **Accent**: burnt orange `#BE5103`, defined once in the asset catalog (`AccentColor`) with a lightened dark-mode variant (raw `#BE5103` will sit too dark on dark backgrounds — tune on device, ~`#E06A1B` starting point) and verified for 3:1 contrast as a control tint in both modes. Applied via `.tint()`. On any screen, at most one glass element carries `Glass.tint(accent)` — the primary action.
- **Condition scale** (the only custom palette): a fixed temperature/severity ramp borrowed from Apple Weather's convention — deep blue < 0°C → light blue → green → yellow → orange → red > 30°C. Used by: condition chips, the 10-day "best day" markers, factor range bars. Defined as `ShapeStyle` tokens in `ConditionPalette.swift`; chips must also differ by SF Symbol, not color alone (Differentiate Without Color).
- **Ambiance gradients** (Today cards, onboarding dials): generated at runtime from forecast condition + time of day (sun position → warm top-light; overcast → flat cool grey; rain → darkened blue-grey with particle layer). Implemented as one `AmbianceStyle(condition:date:location:)` factory returning gradient + optional particle effect. Dark-mode aware. This is the app's visual signature — and it's computed, not drawn.

## 4. Typography

SF Pro, system text styles only, Dynamic Type always on. No custom fonts, no fixed point sizes.

| Role | Style |
|---|---|
| Card route name (over media) | `.largeTitle` emphasized (`.bold()`), white with scrim |
| Screen titles / onboarding titles | `.largeTitle` bold, left-aligned (iOS 26 convention) |
| Hero numbers (score, temp, ETA) | `.title` / `.title2` emphasized; use monospaced digits `.monospacedDigit()` where values tick |
| Section headers | `.headline` |
| Body copy, factor explanations | `.body`; onboarding body is one sentence, sentence case |
| Chips, captions, attribution | `.footnote` / `.caption` |

Spacing that scales with type uses `@ScaledMetric(relativeTo:)`. Titles: Title Case, 2–4 words ("Rain or Shine?"). Body: sentence case, plain language. One CTA label — **Continue** — across the entire onboarding.

## 5. Layout & Shape

- **Edge-to-edge content**: scrollable content runs under the tab bar/toolbars; system scroll-edge effect handles legibility (`.scrollEdgeEffectStyle(.soft, for: .bottom)` is the default — don't fight it). Custom bottom bars use `.safeAreaBar(edge: .bottom)`, not `.safeAreaInset`.
- **Corner radii are never hard-coded.** Nested shapes use `ConcentricRectangle` / `.rect(corners: .concentric)` with `.containerShape(_:)` on the ancestor. Touch targets are capsules on iOS; macOS resolves its own control shapes.
- **Today hero card**: full-bleed, ignores horizontal safe areas via `.backgroundExtensionEffect()` where chrome overlaps; text sits on a bottom scrim gradient (black 0% → 45%), Invites-style — data layered *on* the image, never below it.
- Breakpoints: iPhone = hero + list + tab bar; iPad/Mac = `NavigationSplitView` (sidebar: Today/Routes/You) with the same hero + list in the detail column and detail panes side-by-side where space allows.

## 6. Components (the complete custom inventory)

Anything not listed here is a stock SwiftUI component.

1. **`RideCard`** — full-bleed hero card for the top-ranked route: `MKMapSnapshotter` image (route polyline drawn on, POI-free `.standard(pointsOfInterest: .excludingAll)`) under `AmbianceStyle` gradient wash + scrim; route name; distance · gain · est-time stats line; `ConditionChipRow`; `ScoreRing` top-trailing on a thin-material circle. Tap opens the breakdown sheet — no swipe-up shortcut: the card sits in a vertical ScrollView where an upward drag is a scroll; `matchedTransitionSource` for zoom into Route Detail.
2. **`ConditionChip`** — SF Symbol + value in `.footnote`, condition-palette tint, on thin material capsule. Max 4 per card: wind (e.g. "↘ tailwind home"), temp+sky, travel ("45m away"), duration ("~3h ride").
3. **`FactorRow`** — one scored factor in the breakdown sheet: symbol, name, dual-layer range bar (grey bar = your preference range, colored segment/dot = today's value — Apple Weather's 10-day bar pattern), 0–1 score as text. Tap expands explanation.
4. **`ElevationProfile`** — Swift Charts `AreaMark` (distance → elevation), `.interpolationMethod(.monotone)`, gradient fill, `chartXSelection` scrubbing with `RuleMark` + annotation, selection synced to a dot on the route `Map`.
5. **`SurfaceBar`** — the cycle.travel-style stacked horizontal bar: busy road / paved / unpaved / path percentages, condition-palette-adjacent fixed colors, legend as `.caption` rows.
6. **`DialScreen`** — onboarding preference screen scaffold: large title, one-sentence body, ONE control (slider for temp range; segmented for sun/rain/wind), `Continue`, page dots. Background is a live `AmbianceStyle` that crossfades (`.animation(.smooth)`) as the selection changes — rain → sun reacts to the tap. Reused verbatim as the Settings editor for each preference (Sports' "onboarding is the settings" model).
7. **`BestDayBadge`** — route detail: "Best day: Thursday" chip with mini condition summary; rendered only when the 7-day scan clears the user's quality threshold, otherwise absent (never an empty state).
8. **`ScoreRing`** *(small)* — compact 0–100 ride-score indicator used on list rows and the breakdown header.

## 7. Motion

| Moment | Token |
|---|---|
| Today ranked list scrolling | Plain vertical `ScrollView`; no parallax |
| Sheet presentation, panel materialize | `.smooth` (0.5s, no bounce) |
| Tap feedback on glass pills | `Glass.interactive()` (system) + `.snappy` for any accompanying layout change |
| Card → Route Detail | `.navigationTransition(.zoom(sourceID:in:))` with `matchedTransitionSource` |
| Glass morphs (pill expand/collapse) | `glassEffectID` + `@Namespace` in shared container; `.glassEffectTransition(.matchedGeometry)` |
| Onboarding page transitions | Spring slide+fade; content staggers in with scale/fade |
| Ambiance crossfade (dial screens, card weather) | `.smooth(duration: 0.8)` opacity crossfade between gradient states |

Reduce Motion: zoom transitions fall back to `.automatic`, glass transitions to `.materialize`, ambiance crossfades to instant, particles disabled.

## 8. Accessibility bar

- Dynamic Type through `accessibility5`; card text reflows, chips wrap to two rows, charts get `axChartDescriptor`.
- Contrast: 4.5:1 body / 3:1 large text over every ambiance gradient — scrim strength is computed, verified in previews for lightest and darkest ambiance.
- All meaning triple-encoded: color + symbol + text. VoiceOver labels on cards read as a sentence: "Chilterns Loop, recommended. Tailwind home, 19 degrees sunny, 45 minutes away, about 3 hours riding."
- Reduce Transparency: custom glass falls back to opaque material (see §2).

## 9. Screen ↔ pattern map

| Screen | Pattern source |
|---|---|
| Today hero + ranked list | Invites full-bleed hero card; every route ranked below in rows (thumbnail, stats, per-route sky + temp, compact `ScoreRing`); rest-day card takes the hero slot when the top score is poor, list stays. Weather is fetched per route start; failure → `ContentUnavailableView` + Retry, never a stuck loader |
| Factor breakdown sheet | Maps peek→medium→large detents; Weather metric-grid cards |
| Route Detail | Maps place card: map hero, stats, progressive disclosure; zoom transition in |
| Routes library | Searchable list; Maps' pre-typed search suggestions (chips: Road, Gravel, Under 2h, Not ridden lately); segmented Saved/Ridden toggle |
| Onboarding | Fitness one-control-per-screen; splash screen = UIOnboarding feature-splash pattern; permissions primed contextually with one-sentence explainer immediately before each system sheet — location asked on first Today entry, Health before enabling ride matching, never all upfront |
| You tab | Sports no-settings philosophy: preference rows reopen their DialScreen; priorities panel for engine weights; connections (Strava), about, attribution |
| Weather attribution | ` Weather` mark + legal link in factor sheet footer and You → About (mandatory, `WeatherService.attribution`) |
