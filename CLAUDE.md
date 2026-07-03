# Ride On

Cycling route recommender. SwiftUI multiplatform (iOS 26 + macOS 26) app + a Cloudflare Worker.
Full spec: `PLAN.md`. All UI decisions: `DESIGN-SYSTEM.md` — **every screen must follow it**, no exceptions.

## Module map

```
app/
├─ project.yml              XcodeGen spec — generates RideOn.xcodeproj (gitignored, not checked in)
├─ RideOn.xctestplan         shared test plan: RideOnTests + RideOnUITests + RideOnCore's tests
├─ RideOnCore/                SPM package: models, scoring engine, GPX/elevation math — platform-free, no UIKit/SwiftUI
│   ├─ Sources/RideOnCore/{Models,Engine,GPX}
│   └─ Tests/{RideOnCoreTests,Fixtures}
├─ RideOn/                    app target: SwiftUI views, DesignSystem/, Services/ (DI + fixtures)
│   ├─ Data/                   SwiftData @Model types (RouteModel, RideLogModel, SavedPlaceModel), PreferencesStore, ModelContainer factory
│   └─ Import/                 GPX import pipeline (RouteImporter) + MKMapSnapshotter route thumbnails (RouteSnapshotService)
├─ RideOnTests/                app-layer XCTest integration tests
└─ RideOnUITests/              XCUITest E2E tests (launch with --fixture-world)
worker/                       Cloudflare Worker (Hono): /classify (Valhalla surface classification), /strava/* OAuth — see worker/CLAUDE.md
```

## Build & test commands

Regenerate the Xcode project after touching `app/project.yml` or adding/removing files in the app target:

```
cd app && xcodegen generate
```

RideOnCore unit tests (fast, no simulator needed):

```
cd app/RideOnCore && swift test
```

Full app test suite (RideOnTests + RideOnUITests + RideOnCore, via the shared test plan) on iOS Simulator:

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
`https://ride-on-api.barclaysd.workers.dev` — `RideOn/Services/ClassifyService.swift`'s
`LiveClassifyClient` hits it directly (see `RideOnTests/LiveClassifyIntegrationTests.swift`
for a skipped-by-default live-network check against it).

## Signing (no paid Apple Developer team yet)

`DEVELOPMENT_TEAM` is blank and `CODE_SIGN_STYLE` is `Manual` with `CODE_SIGN_IDENTITY: "-"`
("sign to run locally" / ad hoc) at the base level for every target. This is what makes
`xcodebuild build`/`test` work with zero team on both iOS Simulator and macOS destinations —
`Automatic` signing with a blank team fails macOS builds with "Signing requires a development
team" even without any entitlements attached.

The iCloud/WeatherKit/HealthKit entitlements (`RideOn/RideOn-iOS.entitlements`,
`RideOn/RideOn-macOS.entitlements`) are only wired up via `CODE_SIGN_ENTITLEMENTS` in the
**Release** config (see `app/project.yml`). Debug builds (what you get from the simulator
commands above) never attach them, so they build fine without a real App ID. Once Dan's
Apple Developer Program membership + App ID with those capabilities exist (PLAN.md
Prerequisites), Release archive/TestFlight builds will need a real `DEVELOPMENT_TEAM` and
`CODE_SIGN_STYLE: Automatic` (or a provisioning profile) for those entitlements to actually
take effect — update `app/project.yml` then.

## Fixture world (deterministic E2E)

Launch the app with `--fixture-world` to get seeded fake `WeatherProviding`/`ETAProviding`/
`HealthStoreProviding`/`StravaClientProtocol` implementations (see `app/RideOn/Services/`)
instead of real network/entitlements. `RideOnUITests` always launches this way. This is the
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
- §7 Motion: use the tokens in `app/RideOn/DesignSystem/Motion.swift`, don't hand-roll
  `.animation()` calls.

## Plan

`PLAN.md` has the full architecture, phase checklist, and testing strategy. Phase 0
(this scaffold) is done; see its checklist for what's stubbed vs. real (e.g. `TimeBudgetFactor`
is real, the other six scoring factors are neutral 0.5 placeholders until Phase 3).
