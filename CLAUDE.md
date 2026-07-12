# Ride On

Cycling route recommender. SwiftUI multiplatform (iOS 26 + macOS 26) app + a Cloudflare Worker.
Full spec: `PLAN.md`. All UI decisions: `DESIGN-SYSTEM.md` — **every screen must follow it**, no exceptions.

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
│   ├─ Services/               SPM package: ServiceProtocols, AppServices (DI), FixtureWorld, ClassifyService, PreferencesStore, RideOnModelContainer, RouteStats (needs Engine's SpeedModel, so lives here not in Models), Import/ pipeline (RouteImporter, RouteSnapshotService). Depends on Models + Engine + DesignSystem. Strava integration (Phase 6): KeychainStore (minimal Security.framework wrapper), StravaModels (StravaToken, PolylineDecoder), StravaAuthConfig (client ID/scope/redirect — `// set real client id` marker until a real Strava API app exists), StravaTokenManager (refresh state machine actor over an injected `StravaTokenTransport`, has ServicesTests), StravaOAuthSession (ASWebAuthenticationSession + app-to-app), LiveStravaClient (routes/activities/export via Strava API v3), StravaSyncServices (StravaRouteSyncService, StravaActivitySyncService). Live platform services: LiveETAProvider (MapKit), LiveWeatherProvider (WeatherKit, day-level cache actor), LiveHealthKitStore (`#if os(iOS)`, cycling workouts + HKWorkoutRoute). Has ServicesTests (StravaTokenManager refresh state machine, stubbed transport — `swift test`, no simulator/network needed)
│   ├─ Router/                 SPM package: AppTab (tab identity/title/icon only — view construction stays in App/, the one target allowed to import every Features package)
│   ├─ DesignSystem/           SPM package: ConditionPalette, AmbianceStyle, Motion tokens
│   └─ Features/               SPM package, one manifest, multiple static-library products: TodayUI (card stack, context pill, breakdown sheet), RoutesUI (library list, import, Route Detail), YouUI (preference rows, weights, saved places, ride log), OnboardingUI (9-step first-run flow — welcome, four reactive dial steps, Strava connect, speed prefill, finish), SharedUI (the closed 8-component DESIGN-SYSTEM.md §6 inventory: RideCard, ConditionChip, FactorRow, ElevationProfile, SurfaceBar, DialScreen, BestDayBadge, ScoreRing — plus the non-inventory `PermissionPrimingSheet` helper). Each depends on Models/Services/DesignSystem as needed
├─ RideOnTests/                app-layer XCTest integration tests (import pipeline, live-classify smoke check, AppServices wiring)
└─ RideOnUITests/              XCUITest E2E tests (launch with --fixture-world)
worker/                       Cloudflare Worker (Hono): /classify (Valhalla surface classification), /strava/* OAuth — see worker/CLAUDE.md
```

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

Worker commands: see `worker/CLAUDE.md`. The classification worker is deployed and live at
`https://ride-on-api.barclaysd.workers.dev` — `Packages/Services/Sources/Services/ClassifyService.swift`'s
`LiveClassifyClient` hits it directly (see `RideOnTests/LiveClassifyIntegrationTests.swift`
for a skipped-by-default live-network check against it).

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
- §2 Materials: Liquid Glass is chrome only (tab bar, toolbars, sheets, floating pills), never content.
- §3 Color: semantic system colors for UI; the only custom palette is `ConditionPalette`
  (temperature ramp); ambiance gradients come from `AmbianceStyle`, computed from real
  forecast + time of day, never a stock illustration.
- §6: the custom component inventory is closed at 8 components — don't add a 9th without
  updating the doc first.
- §7 Motion: use the tokens in `app/Packages/DesignSystem/Sources/DesignSystem/Motion.swift`,
  don't hand-roll `.animation()` calls.

## Plan

`PLAN.md` has the full architecture, phase checklist, and testing strategy. Phase 0
(this scaffold), Phase 2.5 (modular package restructure), Phase 3 (Engine), Phase 4
(UI shell & screens), and Phase 5 (Onboarding) are done — all eight `RideFactor` providers
(time budget, wind, temperature, sky, rain, surface match, intent, novelty) are real,
weighted by `WeightedScorer`, with golden-scenario tests in
`app/Packages/Engine/Tests/EngineTests/GoldenScenarioTests.swift`; Today, Route Detail,
Routes, You, and the first-run onboarding flow are all built per DESIGN-SYSTEM.md.
Onboarding shows once on first launch (`PreferencesStore.hasCompletedOnboarding`);
`--reset-onboarding` forces it back on for E2E (`RideOnUITests`'s
`testOnboardingHappyPathThroughAllStepsLandsOnToday`/`testOnboardingSkipPathLandsOnToday`).
Phase 6 (Integrations) is done: Strava OAuth (`ASWebAuthenticationSession` + app-to-app),
route sync, activity-derived speed defaults, activity↔route matching with auto ride logs,
HealthKit cycling-workout matching (iOS only), live WeatherKit, and MapKit ETAs are all
wired behind the existing Services protocols, with FixtureWorld fakes so `RideOnUITests`
stays deterministic. Live WeatherKit is verified end-to-end (real forecast returned on
macOS with the entitled Debug build — see Signing section for the App Services gotcha).
See the checklist for what's next (Phase 7 — polish & platform).
