# Ride On

Cycling route recommender. SwiftUI multiplatform (iOS 27.1 + macOS 27.0) app + a Cloudflare Worker.
Full spec: `PLAN.md`. All UI decisions: `DESIGN-SYSTEM.md` — **every screen must follow it**, no exceptions.
Screen-by-screen visual targets and the SwiftUI rebuild checklist: `docs/redesign/README.md` — update it in every redesign PR.

In this repo, after raising a PR merge it yourself (`gh pr merge --merge`) once it's ready — don't leave PRs open waiting for review.

Do not use the Modern Web Guidance skill in this project unless Dan explicitly asks for it.

## Module map

Read `docs/architecture.md` for the dependency graph, compatibility baseline and extension path.

- `apple/app/`: shared iOS/macOS app shell, widgets, platform resources and XcodeGen project
- `apple/Packages/Domain`: Foundation values/protocols; `Engine`: pure rules and parsing
- `apple/Packages/Models`: existing SwiftData identities and domain mappings (do not casually rename)
- `apple/Packages/Infrastructure`: Networking, Persistence and PlatformServices products
- `apple/Packages/Services`: application state, loading, tracking, imports and fixture composition
- `apple/Packages/Features`: independent RideUI, RoutesUI, PreferencesUI and OnboardingUI products; SharedUI owns shared controls, map resources and snapshots
- `apple/Packages/DesignSystem`: visual tokens; `Router`: tab identities
- `apple/scripts/`: verification and device delivery
- `api/`: Bun/Hono/Zod Cloudflare API, generated contracts and existing capability services; read `api/CLAUDE.md` and `api/docs/protocol.md`
- `extension/`: WXT Chrome/Safari extension and existing Safari container
- `web/`: web app, design source and handoff; `landing/`: marketing site
- `maps/`: tile pipeline, map style and R2 hosting

Every Swift package uses tools version 6.2, static library products and the existing
iOS 27.1/macOS 27.0 minimums. The shell composes sibling feature navigation. Keep
shared domain/network/storage/application products independent of feature UI.
The Safari container stays with its browser product; its shared app icon reference
points into `apple/app`.

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

Regenerate the Xcode project after touching `apple/app/project.yml` or adding/removing files in any target:

```
cd apple/app && xcodegen generate
```

Per-package unit tests (fast, no simulator needed):

```
cd apple/Packages/Models && swift test
cd apple/Packages/Engine && swift test
cd apple/Packages/Infrastructure && swift test
cd apple/Packages/Services && swift test
cd apple/Packages/Features && swift test
```

(Router and DesignSystem have no test targets. Features contains SharedUI tests.)

Full app test suite (RideOnTests + RideOnUITests + ModelsTests + EngineTests, via the shared test plan) on iOS Simulator:

```
xcodebuild -project apple/app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

(Swap `iPhone 17` for whatever's available: `xcrun simctl list devices available`.)

Build only (no tests):

```
xcodebuild -project apple/app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

Build the UI test target without running it:

```
xcodebuild -project apple/app/RideOn.xcodeproj -scheme RideOn \
  -destination 'platform=iOS Simulator,name=iPhone 17' build-for-testing
```

macOS build:

```
xcodebuild -project apple/app/RideOn.xcodeproj -scheme RideOn -destination 'platform=macOS' build
```

Run on Dan's phone — **always** this way, never by building another checkout or worktree:

```
apple/scripts/run-on-device.sh                  # Dan’s iPhone Duo
apple/scripts/run-on-device.sh "Other device"   # or set RIDEON_DEVICE
```

It fast-forwards `main` (or refuses a branch that's behind `origin/main`), closes every
`RideOn.xcodeproj` open in Xcode (a reload mid-build cancels the build), regenerates the project
and runs through the Xcode app. Device builds can't use `xcodebuild` or the Xcode MCP: Xcode 27 keeps the Apple Account where only the app can
see it, so they fail with "No Accounts" and can't add a new device to the provisioning profile.

Worker commands: see `api/CLAUDE.md`. The API-first rebuild is implemented
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
`apple/Packages/Services/Sources/Services/`) instead of real network/entitlements.
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
- §7 Motion: use the tokens in `apple/Packages/DesignSystem/Sources/DesignSystem/Motion.swift`,
  don't hand-roll `.animation()` calls.

## Plan

`PLAN.md` has the full architecture, phase checklist, and testing strategy. Phase 0
(this scaffold), Phase 2.5 (modular package restructure), Phase 3 (Engine), Phase 4
(UI shell & screens), and Phase 5 (Onboarding) are done — all eight `RideFactor` providers
(time budget, wind, temperature, sky, rain, surface match, intent, novelty) are real,
weighted by `WeightedScorer`, with golden-scenario tests in
`apple/Packages/Engine/Tests/EngineTests/GoldenScenarioTests.swift`; Ride (né Today), Route Detail,
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
