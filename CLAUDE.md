# Ride On

Cycling route recommender. SwiftUI multiplatform (iOS 26 + macOS 26) app + a Cloudflare Worker.
Full spec: `PLAN.md`. All UI decisions: `DESIGN-SYSTEM.md` — **every screen must follow it**, no exceptions.
Screen-by-screen visual targets and the SwiftUI rebuild checklist: `docs/redesign/README.md` — update it in every redesign PR.

In this repo, after raising a PR merge it yourself (`gh pr merge --merge`) once it's ready — don't leave PRs open waiting for review.

Do not use the Modern Web Guidance skill in this project unless Dan explicitly asks for it.

## Module map

Modular local SPM package architecture (keepfresh-ios style, adopted Phase 2.5): a thin `App/`
shell composes packages under `Packages/`. Every package: swift-tools-version 6.2,
`.library(type: .static)`, platforms `.iOS("26.0")` + `.macOS("26.0")`.

```
app/
├─ project.yml              XcodeGen spec — generates RideOn.xcodeproj (gitignored, not checked in)
├─ RideOn.xctestplan         shared test plan: RideOnTests + RideOnUITests + ModelsTests + EngineTests
├─ App/                       app shell target: RideOnApp.swift, Assets.xcassets, entitlements — composes packages, builds AppTab → view mapping
├─ RideOn.icon                Icon Composer app icon bundle
├─ Packages/
│   ├─ Models/                 SPM package: value types (Route, RideLog, Bike, Preferences, SavedPlace, DailyContext, BearingSegment) + SwiftData @Model types (RouteModel, RideLogModel, SavedPlaceModel) + RouteMapping — platform-free, no UIKit/SwiftUI. Depends on nothing else in-repo. Has ModelsTests (SwiftData round-trip)
│   ├─ Engine/                 SPM package: scoring engine + GPX parsing + elevation smoothing — platform-free. Depends on Models. Has EngineTests (fast, no simulator)
│   ├─ Services/               SPM package: ServiceProtocols, AppServices (DI), FixtureWorld, ClassifyService, PreferencesStore, RideOnModelContainer, RouteStats (needs Engine's SpeedModel, so lives here not in Models), Import/ pipeline (RouteImporter, RouteSnapshotService). Depends on Models + Engine + DesignSystem. Ride On API: RideOnAPI (client), RideBoardLoader (Rides tab), RouteLibraryLoader (Routes tab: library, history, shortlist saves with 409 replay, has ServicesTests), RideTracker (the tracked ride, has ServicesTests). Strava integration (Phase 6): KeychainStore (minimal Security.framework wrapper), StravaModels (StravaToken, PolylineDecoder), StravaAuthConfig (client ID/scope/redirect — `// set real client id` marker until a real Strava API app exists), StravaTokenManager (refresh state machine actor over an injected `StravaTokenTransport`, has ServicesTests), StravaOAuthSession (ASWebAuthenticationSession + app-to-app), LiveStravaClient (routes/activities/export via Strava API v3), StravaSyncServices (StravaRouteSyncService, StravaActivitySyncService). Live platform services: LiveETAProvider (MapKit), LiveWeatherProvider (WeatherKit, day-level cache actor), LiveHealthKitStore (`#if os(iOS)`, cycling workouts + HKWorkoutRoute). Has ServicesTests (StravaTokenManager refresh state machine, stubbed transport — `swift test`, no simulator/network needed)
│   ├─ Router/                 SPM package: AppTab (tab identity/title/icon only — view construction stays in App/, the one target allowed to import every Features package)
│   ├─ DesignSystem/           SPM package: ConditionPalette, AmbianceStyle, Motion tokens
│   └─ Features/               SPM package, one manifest, multiple static-library products: RideUI (day selector, card stack, context capsule, breakdown sheet), RoutesUI (Routes tab: full-screen map, floating glass panel with shortlist carousel, library and history; `LiveRoutesView` loads it from the API and saves shortlist edits, the fixture world renders `RouteLibrary.sample`; its `RoutesMap` opens in SharedUI's `CycleMap`, the Cycle look, on iOS; the Mac keeps MapKit's looks — see docs/maps/README.md WS3), PreferencesUI (Preferences tab, Ideal Temperature, Comfortable Wind, Distance, Account, About — edits `RiderSettingsStore`, which saves to `PATCH /users/me`), OnboardingUI (9-step first-run flow — welcome, four reactive dial steps, Strava connect, speed prefill, finish), SharedUI (the closed 8-component DESIGN-SYSTEM.md §6 inventory: RideCard, ConditionChip, FactorRow, ElevationProfile, DialScreen, BestDayBadge, ScoreRing — plus the non-inventory `PermissionPrimingSheet` helper; also `CycleMap`, §6 #17, the cycle.travel-look map: on iOS it depends on MapLibre Native (`maplibre-gl-native-distribution`, iOS-only condition) and bundles the style, sprite and glyphs `maps/style` builds in `CycleMap/`). Each depends on Models/Services/DesignSystem as needed
├─ RideOnTests/                app-layer XCTest integration tests (import pipeline, live-classify smoke check, AppServices wiring)
└─ RideOnUITests/              XCUITest E2E tests (launch with --fixture-world)
extension/                    Browser extension (WXT + Preact) for cycle.travel: Chrome MV3, and Safari (macOS + iOS) via the XcodeGen container in extension/safari/ — see extension/README.md
maps/                         Cycle map data (docs/maps/README.md is the plan): tiles/ is the planetiler profile for the GB cycling overlay (Java, built and tested in Docker) — see maps/tiles/README.md; style/ builds the MapLibre style (TypeScript + Bun) into SharedUI's CycleMap/ resources with its Montserrat glyph PBFs — see maps/style/README.md; hosting/ publishes archives to the `ride-on-maps` R2 bucket, served at https://maps.ride-on.cc — see maps/README.md. `.github/workflows/maps-tiles.yml` rebuilds the overlay monthly (the basemap quarterly) and opens a PR pointing the style at it
worker/                       Cloudflare Worker (Hono): GPX upload, route storage and weather-aligned ride recommendations — see worker/CLAUDE.md and docs/api.md
```

## Browser extensions

One WXT source ships to Chrome and Safari. **Every extension change goes into both unless told
otherwise**: keep browser differences behind `import.meta.env.SAFARI` and the per-browser manifest in
`extension/wxt.config.ts`, and check `bun run build:safari` (or `bun run safari` for the Xcode build)
alongside `bun run check` and `bun run test:e2e`.

Safari runs **every** registered build of the extension at once, so builds left in other
DerivedData folders, worktrees or `-derivedDataPath` scratch folders fight the current one and keep
serving old code. A Mac build of `extension/safari` unregisters the others itself; after anything
else, run `bun run safari:unregister-stale` in `extension/` (see `extension/README.md`).

## Build & test commands

Regenerate the Xcode project after touching `app/project.yml` or adding/removing files in any target:

```
cd app && xcodegen generate
```

Per-package unit tests (fast, no simulator needed):

```
cd app/Packages/Models && swift test
cd app/Packages/Engine && swift test
cd app/Packages/Services && swift test
```

(Router, DesignSystem, Features have no test targets yet — no non-trivial logic to cover.)

Full app test suite (RideOnTests + RideOnUITests + ModelsTests + EngineTests, via the shared test plan) on iOS Simulator:

```
xcodebuild -project app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

(Swap `iPhone 17` for whatever's available: `xcrun simctl list devices available`.)

Build only (no tests):

```
xcodebuild -project app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

Build the UI test target without running it:

```
xcodebuild -project app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' build-for-testing
```

macOS build:

```
xcodebuild -project app/RideOn.xcodeproj -scheme RideOn -destination 'platform=macOS' build
```

Worker commands: see `worker/CLAUDE.md`. The API-first rebuild is implemented
with `/routes`, `/recommendations`, `/users`, `/route-imports`, `/route-sources`
and `/route-selection`; the API is deployed at
`https://ride-on-api.barclaysd.workers.dev` (10 October 2026). The existing
client `ClassifyService.swift` and Strava token transports still target legacy
endpoints and need migration before using the rebuilt backend. The API algorithm
is now the current product focus; the app package map below/above describes the
existing client implementation, not the target business-logic ownership.

## Signing (real team: R2GGK3VN2C)

`CODE_SIGN_STYLE` is `Automatic` with `DEVELOPMENT_TEAM: R2GGK3VN2C` (Dan's paid Apple
Developer membership) at the base level for every target. Entitlements attach in **both**
Debug and Release on both platforms — `CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*/iphonesimulator*]`
→ `App/RideOn-iOS.entitlements`, `CODE_SIGN_ENTITLEMENTS[sdk=macosx*]` →
`App/RideOn-macOS.entitlements` (iCloud/WeatherKit/HealthKit) — so live WeatherKit works in
day-to-day dev builds everywhere.

The Mac Team Provisioning Profile for `com.danbarclay.rideon` exists locally, so plain
`xcodebuild` works. On a fresh machine (or after clearing
`~/Library/Developer/Xcode/UserData/Provisioning Profiles`), the first macOS build fails
with "No profiles for 'com.danbarclay.rideon' were found" — run it once with
`-allowProvisioningUpdates -allowProvisioningDeviceRegistration` to register the Mac and
mint the profile, then plain builds work again.

WeatherKit also needs the App ID's WeatherKit service enabled in **both** tabs at
developer.apple.com → Identifiers → `com.danbarclay.rideon`: automatic signing only sets
the Capabilities tab; the separate **App Services** tab must be ticked manually or every
weather fetch fails with `WDSJWTAuthenticatorServiceListener.Errors Code=2` (JWT refused
server-side, even with a correctly entitled build). Both are enabled now — live WeatherKit
verified working on macOS 2026-07-12.

## Fixture world (deterministic E2E)

Launch the app with `--fixture-world` to get seeded fake `WeatherProviding`/`ETAProviding`/
`HealthStoreProviding`/`StravaClientProtocol` implementations (see
`app/Packages/Services/Sources/Services/`) instead of real network/entitlements.
`RideOnUITests` always launches this way. This is the
only supported way to drive the app in CI/E2E — no live services in tests, ever (PLAN.md
Testing strategy).

## Design system

`DESIGN-SYSTEM.md` is not optional guidance — it's the spec. In particular:
- §1: Ride On recommends routes, it doesn't navigate — no Directions CTA anywhere.
- §2 Materials: Liquid Glass is the functional layer only (tab bar, toolbars, sheets, the
  window capsule), never content. Regular glass by default; clear glass only over the hero map.
- §3 Colour: semantic system colours for UI, green accent in the asset catalog; the only
  custom palette is `ConditionPalette` (temperature ramp). `AmbianceStyle` is onboarding-only.
- §6: the custom component inventory is closed — don't add a component without adding it
  to the doc first.
- §7 Motion: use the tokens in `app/Packages/DesignSystem/Sources/DesignSystem/Motion.swift`,
  don't hand-roll `.animation()` calls.

## Plan

`PLAN.md` has the full architecture, phase checklist, and testing strategy. Phase 0
(this scaffold), Phase 2.5 (modular package restructure), Phase 3 (Engine), Phase 4
(UI shell & screens), and Phase 5 (Onboarding) are done — all eight `RideFactor` providers
(time budget, wind, temperature, sky, rain, surface match, intent, novelty) are real,
weighted by `WeightedScorer`, with golden-scenario tests in
`app/Packages/Engine/Tests/EngineTests/GoldenScenarioTests.swift`; Ride (né Today), Route Detail,
Routes, You, and the first-run onboarding flow are all built per DESIGN-SYSTEM.md.
Onboarding shows once on first launch (`PreferencesStore.hasCompletedOnboarding`);
`--reset-onboarding` forces it back on for E2E (`RideOnUITests`'s
`testOnboardingHappyPathThroughAllStepsLandsOnRide`/`testOnboardingSkipPathLandsOnRide`).
Phase 6 (Integrations) is done: Strava OAuth (`ASWebAuthenticationSession` + app-to-app),
route sync, activity-derived speed defaults, activity↔route matching with auto ride logs,
HealthKit cycling-workout matching (iOS only), live WeatherKit, and MapKit ETAs are all
wired behind the existing Services protocols, with FixtureWorld fakes so `RideOnUITests`
stays deterministic. Live WeatherKit is verified end-to-end (real forecast returned on
macOS with the entitled Debug build — see Signing section for the App Services gotcha).
See the checklist for what's next (Phase 7 — polish & platform).
