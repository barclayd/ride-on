# Ride On — Build Plan

**Ride On** answers one question every morning: *which of my routes should I ride today?*
Routes are built elsewhere (Strava, cycle.travel, Garmin) and imported; Ride On scores them daily against wind, weather-vs-your-preferences, travel time, your time budget, training intent, bike choice, and novelty — and explains itself.

---

## Decision record (agreed 2026-07-03)

| Area | Decision |
|---|---|
| Platform | Native SwiftUI multiplatform: iOS 26 + macOS 26, one codebase. iPhone-first layouts, `NavigationSplitView` on iPad/Mac |
| Project | XcodeGen (`project.yml`), app name **Ride On**, bundle `com.danbarclay.rideon`, module `RideOn` |
| Persistence | SwiftData + CloudKit mirroring from day one (models CloudKit-safe: optionals/defaults, no unique constraints) |
| Import | GPX file import (Files/share sheet) + Strava OAuth route sync. FIT + Garmin Courses API = backlog (Garmin dev program currently closed to new applicants) |
| Backend | One Hono Cloudflare Worker (TypeScript). Tooling mirrors `promptly-api`: Bun, Biome, tsgo typecheck, `bun test`, `wrangler.jsonc`, KV. Jobs: (1) surface classification, (2) Strava OAuth token exchange/refresh (no PKCE at Strava → secret stays server-side) |
| Surface classification | Valhalla `trace_attributes` (bicycle costing) against FOSSGIS public instance for dev, with per-tile KV caching; Overpass as fallback path. Douglas-Peucker simplify to ≤500 pts before calls. User can override the resulting road/gravel/mixed tag |
| Engine | Transparent weighted scoring, on-device, deterministic, unit-tested. Factor weights user-adjustable in a Settings panel |
| Weather | WeatherKit (240h hourly / 10-day daily). Scores computed over the actual riding window, not the whole day. Attribution mandatory |
| Travel | MapKit ETAs: automobile, cycling (native since iOS 14, new routing engine in 26), transit (best-effort, bike-carriage caveat shown). Current location + saved places |
| Trip scope | Single-day rides only in v1. No notifications in v1 (pull-only) |
| Ride logging | Manual "I rode this" + Strava activity matching + HealthKit cycling workouts (`HKWorkoutRoute` geometry match). HealthKit is iOS-only at runtime — Mac gets history via CloudKit sync |
| Speed model | Per-surface cruising speed + climbing penalty; defaults derived from last 3 months of Strava activity streams when connected, else sensible defaults; editable in Settings |
| Strava policy constraints | 7-day max cache of Strava data; derived personal aggregates (speed model) computed once, stored as our data; GPX exports become user-initiated app-owned imports. Dev mode = 1 athlete, self-serve to 10, Strava review beyond that + branding rules |
| UX | 3 tabs Today/Routes/You. Today = full-bleed swipeable card stack, condition chips, swipe-up scored breakdown sheet. Condition-adaptive ambiance. Route detail shows "Best day this week" only when one exists. Onboarding: 9 steps, four animated weather-dial screens (temp/sun/rain/wind), Strava/Health early for prefill |
| Design | `DESIGN-SYSTEM.md` governs all UI. Stock components + Liquid Glass rules; custom component inventory is closed (8 components) |
| Distribution | App Store from day one: privacy policy, App Review, Strava production review, WeatherKit attribution, Strava branding |

## Prerequisites (Dan)

- [ ] Apple Developer Program membership active; App ID `com.danbarclay.rideon` with WeatherKit, HealthKit, iCloud/CloudKit capabilities
- [ ] Strava API application created (gives client ID/secret; callback domain registered — the Worker's domain)
- [ ] Cloudflare account for the Worker (paid plan if classification CPU needs it)
- [ ] Xcode 26 installed; `brew install xcodegen`

## Architecture

```
RideOn (SwiftUI, iOS 26 + macOS 26)
├─ RideOnCore (SPM package: models, engine, GPX parsing — platform-free, fully unit-tested)
│   ├─ Models: Route, RideLog, Bike, Preferences, SavedPlace, DailyContext
│   ├─ Engine: FactorScore providers → WeightedScorer → RankedRecommendation(+ reasons)
│   └─ GPX import, elevation smoothing, geometry utils (overlap %, bearing segments)
├─ App layer: SwiftData store (CloudKit), WeatherKit/MapKit/HealthKit/CoreLocation services
└─ UI layer: DESIGN-SYSTEM.md components + screens

ride-on-worker (Hono on Cloudflare Workers, TypeScript/Bun/Biome)
├─ POST /classify      { polyline } → { surfaces: {busyRoad, paved, unpaved, path}, segments[] }   (Valhalla + KV tile cache)
├─ POST /strava/token  { code } → tokens        (exchange; secret server-side)
├─ POST /strava/refresh { refresh_token } → tokens
└─ KV: tile-keyed classification cache (long TTL)
```

Scoring factors (each returns 0–1 + human reason): wind alignment vs segment bearings (tailwind-home bias) · temp fit · sky fit · rain fit · wind-strength fit · time-budget fit (travel out + est. ride + travel back vs hours available/back-by) · surface/bike match · training-intent fit (distance/elevation/easy) · novelty (recency decay on route + geographic overlap, weighted by user dial).

## Phase checklist

### Phase 0 — Foundations
- [ ] Repo layout: `app/` (XcodeGen project + `RideOnCore` SPM package), `worker/`, docs at root
- [ ] `project.yml`: iOS 26 + macOS 26 targets, entitlements (WeatherKit, HealthKit, CloudKit), asset catalog, `xcodebuild` verified from CLI
- [ ] `RideOnCore` package with placeholder tests running via `swift test`
- [ ] Design tokens in code: `ConditionPalette`, `AmbianceStyle`, motion tokens per DESIGN-SYSTEM.md (accent `#BE5103` in asset catalog)
- [ ] Test infrastructure: service protocols + fixture fakes, launch-argument "fixture world" mode (seeded store, fixture forecast, fake location, stubbed network), XCUITest target + shared test plan, GPX fixtures folder — E2E determinism is designed in from day one, not retrofitted
- [ ] CLAUDE.md for the repo: build/test commands, module map, design-system pointer

### Phase 1 — Worker (parallel with 0)
- [ ] Hono scaffold mirroring promptly-api tooling (Bun, Biome, tsgo, `bun test`, wrangler.jsonc, observability)
- [ ] `/classify`: polyline decode → simplify → Valhalla `trace_attributes` → length-weighted surface/road-class buckets → response; KV tile cache; sequential/failover etiquette for public instances
- [ ] `/strava/token` + `/strava/refresh` (secrets in Worker env; no Strava data stored server-side)
- [ ] Smoke tests + deploy to workers.dev (this URL is the Strava OAuth callback domain — register it in the Strava app settings)

### Phase 2 — Core data & import
- [ ] SwiftData models (CloudKit-compatible) + migration-safe defaults
- [ ] GPX import: file/share-sheet ingestion, parsing (CoreGPX or minimal XMLParser — decide at implementation by extension needs), elevation smoothing + gain (moving average, min-delta threshold), distance, bearing segments, start/end coords
- [ ] Import flow calls `/classify` once, stores surface breakdown + suggested type; user confirm/override
- [ ] Route stats: est. ride time from speed model; map snapshot generation + caching

### Phase 2.5 — Modular package restructure (agreed 2026-07-03, before Phase 3)
Adopt the keepfresh-ios architecture (`/Users/danbarclay/Documents/Coding/keepfresh-ios`): thin `App/` shell + `Packages/` monorepo of local SPM packages (swift-tools-version 6.2, static libraries, platforms iOS 26 **and** macOS 26 — we're multiplatform, keepfresh is iOS-only). Keep XcodeGen (project.yml shrinks to the App shell + package references) and the shared xctestplan (extend to package test targets).
- [x] `App/` — RideOnApp.swift, assets, entitlements only; composes packages, `@Observable` state injected via `@Environment`
- [x] `Packages/Models` — value types (ex-RideOnCore/Models) + Phase 2 SwiftData models
- [x] `Packages/Engine` — scoring + GPX/elevation math (ex-RideOnCore/Engine+GPX); stays platform-free, fast `swift test`
- [x] `Packages/Services` — service protocols, AppServices, FixtureWorld, ClassifyClient; later WeatherKit/Strava/HealthKit clients
- [x] `Packages/Router` — AppTab (view construction stays in `App/`, the one target that imports every Features package; `RouterDestination`/sheet destinations deferred until Phase 4 needs cross-feature navigation)
- [x] `Packages/DesignSystem` — ConditionPalette, AmbianceStyle, Motion + custom components as built
- [x] `Packages/Features` — one package, library targets: TodayUI, RoutesUI, YouUI, SharedUI, OnboardingUI (added Phase 5)
- [x] All existing tests green after the move; update root CLAUDE.md module map + build commands
- [x] Also fold in if Phase 2 didn't: `UILaunchScreen: {}` in Info.plist properties (fixes simulator letterboxing/compatibility mode)

### Phase 3 — Engine
- [x] Factor providers + `WeightedScorer` with reasons, in `Packages/Engine`, pure functions over `DailyContext`
- [x] Novelty: ride-log recency decay + geometric overlap between routes
- [x] Time-window weather scoring (hourly slices over the predicted ride window)
- [x] "Best day this week" scan (threshold; absent below it)
- [x] Unit tests: golden scenarios (windy day flips route direction preference, short window drops far routes, novelty decay, intent reweighting)

### Phase 4 — UI shell & screens
- [x] Tab structure + `NavigationSplitView` adaptation (Mac/iPad); Liquid Glass audit per DESIGN-SYSTEM.md §2
- [x] Today: card stack (RideCard, ConditionChipRow, ambiance), context pill (bike/hours/intent/back-by), breakdown sheet (FactorRow, detents), empty states (no routes / no good day — "rest day" card)
- [x] Route Detail: map hero (`MapPolyline`, `.excludingAll` POIs), ElevationProfile w/ scrub-sync to map, SurfaceBar, stats, BestDayBadge, ride history, GPX re-export share link, zoom transition
- [x] Routes library: searchable list + suggestion chips, Saved/Ridden toggle, import entry points, swipe actions
- [x] You tab: preference rows → DialScreens, priorities (weights) panel, speed model editor, saved places, Strava connection state, ride log, About + attributions

### Phase 5 — Onboarding
- [x] 9-step flow per decision record; feature-splash welcome; dots; skippable except welcome
- [x] Four DialScreens with reactive ambiance crossfades (the centrepiece — this is where the animation budget goes)
- [x] Contextual permission priming screens (location on first Today entry; Health before ride-matching)
- [x] Prefill speeds from Strava when connected; land on a working Today

### Phase 6 — Integrations
- [x] Strava OAuth via `ASWebAuthenticationSession` (+ app-to-app when Strava app present), tokens in Keychain, refresh rotation
- [x] Route sync: list `/athletes/{id}/routes` → `export_gpx` → import pipeline (user-initiated, becomes app-owned data)
- [x] Activity fetch (3 months) → per-surface speed distribution → speed model defaults; recompute on demand; respects 7-day cache rule (derive-and-discard — only `RideLogModel`/`speedKphBySurface` persist, never raw Strava responses). Ponytail: derives from `map.summary_polyline` on the activities-list response rather than a per-activity `/streams` call (avoids Strava's 100-req/15-min rate limit); upgrade to real streams if matching/speed accuracy ever needs finer resolution.
- [x] Activity ↔ route matching (geometry overlap, `Engine.ActivityMatcher` over the existing `GPXGeometry.overlapFraction`) → auto ride logs; "View on Strava" links + Connect-with-Strava button copy (real brand asset/color treatment still pending — Phase 8 branding-compliance gate)
- [x] HealthKit: cycling workouts + `HKWorkoutRoute` matching (iOS only), contextual auth wired into the existing Ride Matching priming sheet
- [x] WeatherKit service with day-level caching + attribution UI (existing `WeatherAttributionFooter`)
- [x] MapKit ETAs (auto/cycling/transit) with graceful regional-failure handling (`ETAProvidingError.unavailable(mode:)`)
- [ ] Live on-device verification of WeatherKit/HealthKit entitlements — real team `R2GGK3VN2C` now signs everything and the iOS entitlements attach in Debug too (see CLAUDE.md Signing section); remaining blockers are user-side: agree to the latest Program License Agreement at developer.apple.com (unblocks macOS Debug entitlements + provisioning), then verify WeatherKit returns data on device/simulator once the App ID's WeatherKit capability propagates.

### Phase 7 — Polish & platform
- [x] Mac: keyboard navigation, menu bar, window sizing, sidebar polish, `backgroundExtensionEffect`
- [x] Accessibility pass: Dynamic Type sweep, VoiceOver labels/chart descriptors, Reduce Motion/Transparency fallbacks, contrast verification over ambiance extremes
- [x] Performance: snapshot caching, glass container audit, cold-launch time
- [x] App icon + launch screen (launch ≈ first real screen, per HIG)

### Phase 8 — Release
- [ ] Privacy policy + App Privacy nutrition labels (location, health, fitness data)
- [ ] Strava production review submission (screenshots of every Strava-data surface, branding compliance)
- [ ] TestFlight (Dan + friends ≤10 athletes while awaiting Strava review) → App Store submission

## Sub-agent workstreams

| Agent | Scope | Phases |
|---|---|---|
| **design** (swiftui-architect) | DESIGN-SYSTEM.md components, screens, onboarding, motion | 0, 4, 5, 7 |
| **engine** (general) | RideOnCore models, GPX, scoring, tests | 2, 3 |
| **api-integration** (general) | Strava/WeatherKit/HealthKit/MapKit services + OAuth | 6 |
| **worker** (typescript-developer) | Hono worker, classification, token exchange | 1 |

Sequencing: 0 ∥ 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, with design starting component work during 2–3.

## Testing strategy

Goal: bullet-proof confidence — every phase closes only when its slice of this pyramid is green, and the full suite stays green thereafter.

### App — unit (RideOnCore, `swift test`)
- [x] Engine golden-scenario tests: windy day flips direction preference; short time window drops far routes; novelty decay curve; intent reweighting; weights-panel changes alter ranking deterministically; "best day this week" threshold (present/absent)
- [ ] GPX parsing against a fixtures folder of real exports (cycle.travel, Strava, Garmin Connect, RideWithGPS) incl. malformed/truncated files
- [ ] Elevation smoothing + gain against known-answer fixtures; geometry utils (bearing segments, route-overlap %) property-tested with roundtrip/symmetry invariants
- [ ] Speed model: estimate accuracy against fixture activities; Strava-derived defaults computation

### App — integration (XCTest, simulator)
- [ ] Import pipeline end-to-end with a stubbed `/classify` response: GPX file → parsed → classified → persisted SwiftData route with correct stats
- [ ] SwiftData store: CloudKit-safe schema round-trips, migration smoke, ride-log ↔ novelty queries
- [x] Service layer behind protocols (`WeatherProviding`, `ETAProviding`, `HealthStoreProviding`, `StravaClient`) with fixture-backed fakes — every screen's data path testable without network/entitlements
- [ ] Strava client against recorded HTTP fixtures: token refresh rotation ✅ (`ServicesTests/StravaTokenManagerTests.swift`, stubbed transport, 7 tests), pagination/rate-limit (429)/scope-denied still uncovered

### App — E2E (XCUITest, iPhone + Mac destinations, one test plan)
Deterministic world via launch arguments: seeded SwiftData store, fixture forecast, fake location, stubbed network (no live services in E2E).
- [x] **First-run journey**: full onboarding — all 9 steps, dial screens change selection, skip paths, permission-priming screens — lands on a populated Today
- [ ] **Core daily loop**: Today shows expected top card for the fixture world (assert route name + chips); swipe through stack; swipe up → factor breakdown values match engine output; change hours/intent/bike in context pill → ranking updates
- [ ] **Import journey**: import GPX via Files → confirm suggested type → route appears in library with surface bar; re-export/share produces a valid GPX
- [ ] **Route detail**: zoom in from card, elevation scrub syncs map dot, BestDayBadge present/absent per fixture forecast
- [ ] **Log & novelty**: mark route ridden → tomorrow's fixture run demotes it and overlapping routes
- [ ] **Settings**: edit a weather dial + weights panel → Today reorders accordingly; prefs persist across relaunch
- [ ] **Accessibility gates**: `performAccessibilityAudit()` on every key screen; a Dynamic Type XXL + Reduce Motion/Transparency pass of the daily loop
- [ ] Suite runs via `xcodebuild test` on both platforms; grows with each phase (4→6); red E2E blocks phase close

### Worker — unit (`bun test`)
- [ ] Polyline decode/simplify (Douglas-Peucker vertex bounds), tile-key derivation, length-weighted bucket math against hand-computed fixtures
- [ ] Valhalla/Overpass response parsing incl. partial-match and error shapes; Strava token exchange/refresh handlers with mocked upstream (rotation semantics, error passthrough, no secret in any response body/log)

### Worker — integration (local `wrangler dev` + Miniflare)
- [ ] `/classify` full path with recorded Valhalla fixtures: cold call → KV write; second call → cache hit (assert no upstream fetch); failover path on 429/5xx
- [ ] CORS/auth/malformed-body/oversized-polyline rejection; response schema contract-tested against the Swift client's decoder (shared JSON schema fixtures)

### Worker — deployed smoke (promptly-api pattern: `bun test` against the live URL, post-deploy gate)
- [ ] Health check; `/classify` with the real Banbury→Kemble GPX against live Valhalla → within tolerance of cycle.travel's 98% paved breakdown (the golden real-world test)
- [ ] KV cache-hit latency assertion on repeat call; Strava token endpoint returns clean 4xx for a bogus code (no upstream secrets leaked in errors)

### Manual gates
- [ ] Before phases 4–6 close: real-device run (iPhone + Mac) with the seed set of real Chilterns/Cotswolds GPX files, live WeatherKit/MapKit — the one place we verify against reality instead of fixtures

## Backlog (agreed out of v1)

Multi-day trips · notifications/morning briefing + good-weather alerts · widgets & Live Activities (WidgetKit accented mode, "Start Ride" ControlWidget) · App Intents/Siri ("what should I ride today?") · FIT import (Garmin fit-swift-sdk — license restricts redistribution; revisit if open-sourcing) · Garmin Courses API (program closed; watch) · cycle.travel direct integration (no public API; bespoke deal only) · ML re-ranking from accept/ride history · photos & notes on routes · Apple Watch

## Open questions (non-blocking)

None.

Settled: worker runs on workers.dev (no custom domain yet — the `*.workers.dev` URL is what gets registered as the Strava callback domain; swapping to a custom domain later means updating Strava app settings). Accent color: burnt orange `#BE5103`. App icon: Icon Composer bundle at `app/RideOn.icon` (glass bike over route map) — wire into project.yml (`ASSETCATALOG_COMPILER_APPICON_NAME: RideOn` + add the .icon to the target) during the Phase 2.5 restructure. Apple Developer Program membership: Dan already has it (Release signing can move to Automatic + real team when Phase 6 needs WeatherKit).
