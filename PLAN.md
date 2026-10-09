# Ride On — Build Plan

## Current direction: API MVP (2026-10-09)

This section records the API-first pivot discussed with Dan. It supersedes the
earlier client-first scope below wherever they conflict. The earlier plan remains
a record of the existing implementation, not a checklist for this MVP.

### Product promise and agreed scope

Given a collection of imported routes, a calendar day and the rider's current
preferences, recommend which ride offers the best fit with the forecast and
explain the choice. Develop and evaluate this decision in the API before adapting
the clients to consume it.

- The MVP accepts a day and now recommends a departure as well as a route.
  Dan confirmed 20 km/h as the initial moving speed, overridable per request,
  and daylight hours with the whole ride required to fit. User-specified
  departure times and narrower riding windows remain later refinements.
- Prefer consistently comfortable conditions throughout the modelled ride and
  show hourly variation. Match forecast hours to progress along the route;
  one good hour cannot stand in for the complete ride.
- Weather assessment uses locations along each route's GPX geometry. There is no
  home location, travel-time calculation, nearby-route filter or travel radius.
- Dan's initial preference is comfortable weather: warmer temperatures, lower
  winds and avoiding rain. In the first comparison, Dan conditionally preferred
  18°C with 22 km/h wind over 13°C with 8 km/h wind when the stronger wind is in
  the right direction for the ride. Wind direction relative to route geometry is
  therefore in scope for the MVP. Comfortable ranges, tolerances and relative
  priorities are still to be calibrated; "warmer" does not yet define a scoring
  curve. Dan clarified that favourable wind means assistance for most of the
  ride, without a special preference for assistance towards the end. For this
  day-level MVP, assess that coverage by route distance; angle thresholds and
  the balance between assistance and adverse sections still need calibration.
- With equally light, favourable winds, Dan preferred a dry 13°C day to 18°C
  with two daytime hours of light rain. Preserve this specific comparison as a
  ranking expectation; it does not establish a blanket rain exclusion or exact
  numerical weights.
- When no route meets the rider's minimum standards, still return the best
  available route with its drawbacks and an explicit statement that none meets
  those standards. Relative ranking and minimum-standard assessment are separate
  outputs. The minimum standards are personal, configurable and not yet defined
  as a complete policy.
- Temperature expectations depend on the rider, month and location. Dan gave
  indicative examples of probably skipping below 16°C in summer and below 0°C
  in January, and suggested the location's average high for the month as a
  reference. These are examples for Dan's profile, not product-wide defaults,
  exact adopted thresholds or a complete seasonal/climate formula.
- Climbing is neutral for Dan. Other riders may eventually prefer less or more
  climbing, and a rider's preferences may change with the season or the day.
- The first evaluation set will use Dan's GPX files and his reviews of concrete
  route-and-weather comparisons.

### Proposed API boundary

Keep the existing TypeScript and Hono backend on Cloudflare Workers. Dan accepted
this stack after considering Rust; optimise and measure the complete request path
before introducing another runtime or language.

The two core operations are implemented; full contracts and setup are in
[`docs/api.md`](docs/api.md).

| Operation | Input | Responsibility and output |
|---|---|---|
| `POST /routes` | GPX file | Validate and store the route, derive reusable geometry and available route facts, return an ID and data-quality warnings. |
| `POST /recommendations` | Route IDs, target date, explicit time zone and current preferences | Fetch or reuse forecasts along the routes, search daylight departures at the requested moving speed and rank the choices with explanations and forecast coverage. |

GPX export uploads are the proposed first import path, including files originating
in Garmin or cycle.travel. Direct account connections are a separate future
integration decision. Route storage and access must be scoped to its owner;
private bearer tokens now resolve an owner, with D1 storage scoped to that owner.

### Preference and engine design

Keep objective route facts, forecast observations, rider preferences and the
context needed to resolve those preferences separate. Context includes the target
date and route locations, plus a historical climate reference when the selected
preference policy needs one. An uploaded route has no permanent personal score.
Changing preferences must allow it to be rescored without another upload or
geometry-processing pass.

Start with explicit preferences in each recommendation request. A later saved
profile can supply a baseline, with per-request overrides. If profiles are
introduced, the API resolves them into one effective preference snapshot;
precedence must be documented. Explicitly configured calendar or climate rules
can automatically adapt the effective values to the requested month and route
location. The software must not invent or silently learn a seasonal rule from two
examples. A rider can still change their policy or override it for a request.

#### Proposed temperature preference contract

Support a small set of named, validated policy types, rather than encoding any
one rider's limits in the evaluator:

| Policy | Rider configuration | Context required |
|---|---|---|
| Fixed | Explicit comfort range and/or minimum temperature | None beyond the forecast |
| Calendar | Explicit values by month, with a declared fallback for unspecified months | Target date in the assessment time zone |
| Climate-relative | A personal tolerance relative to a specified monthly climate reference, optionally bounded by personal absolute limits | Target month and historical reference data for route locations |

Fixed and calendar minimum-temperature policies are implemented. Climate-relative
rules and saved profiles remain future work. Preference ranking and minimum-standard rules remain distinct under
each policy. Dan's 16°C and 0°C examples do not establish a fixed offset below a
monthly average high, summer month boundaries, or values for the other months.
Do not interpolate the examples into an annual schedule without declaring that
as an assumption.

Resolve the chosen policy on the server before evaluation. Return the effective
limits and their origin (profile, month rule, climate reference or explicit
override), so clients can explain both the result and why a limit changes. Keep
the personal policy independent of weather-provider response formats. Other
factors can acquire their own supported contextual rules as needed; there is no
need for arbitrary user code or a general-purpose rule language in this MVP.

Historical monthly reference data and a live forecast are different inputs. If
climate-relative rules are used, define and retain the source, reference period,
statistic, location mapping and version for reproducibility. Missing reference
data must use an explicitly configured fallback or produce an unresolved
assessment; it must not silently select a different temperature policy.

The first implementation evaluates minimum temperature at each modelled route
section midpoint; any value below the configured threshold fails. It reports
those sections, observation times and worst actual value. This strict sampled
policy and the provisional comfort curves need calibration; they do not establish
Dan's personal seasonal limits. Apply seasonal conventions through configured month rules or local data,
not a worldwide assumption that summer is the same set of months everywhere.

Temperature, route-relative wind (strength and direction) and rain are the first
scoring factors.
Each factor owns its preference interpretation and returns both a contribution
and a reason. Additional factors such as elevation fit should be additive to this
design, with inactive factors having no effect. A tailwind-home preference must
not be assumed for every rider; Dan's profile has no extra weighting for the final
section. Any future use of elevation to estimate duration is distinct from
whether the rider enjoys climbing.

Keep forecast retrieval and caching separate from a deterministic evaluator:
identical route facts, forecast snapshots, resolved contextual preferences and
algorithm version must produce identical results. Retain enough version and input metadata
to reproduce an evaluation. Clients present the API's assessment rather than
reimplementing scoring or preference rules.

### Weather and result requirements

Dan trusts Met Office forecasts for UK rides. Resolve this as a strict UK source
policy, with no silent fallback to another provider; his preference outside the
UK remains unspecified. Other riders may configure a different source or an
explicitly allowed fallback order. Source trust is separate from comfort scoring.

Keep provider-specific requests and payloads behind a generic internal contract.
The evaluator consumes normalised evidence with declared units, statistics,
time intervals, requested/resolved locations, source provenance and missing-data
status. Historical climate references have a separate contract. Less capable
providers must report gaps rather than invent matching data.

Met Office Weather DataHub offers suitable forecast APIs. The supplied key enables
Global Spot; its hourly adapter and strict/ordered source selection are now
implemented and verified locally. BPF v2 remains an optional later product.
Research, quotas and integration design are recorded in
[`docs/weather-providers.md`](docs/weather-providers.md), with draft types in
[`worker/src/weather/contracts.ts`](worker/src/weather/contracts.ts).
The local ignored live check (`evaluation/met-office-live-check.json`) retrieved all eight required
series at 18 sample points across six routes. This is not complete spatial coverage
or a route recommendation. The subsequent local ignored API check (`evaluation/api-live-check.json`)
now covers all six routes, 55 weather locations and 86 departures through the local
Workers runtime, D1 and KV. Shared caching and recommendation endpoints are implemented;
remote provisioning and deployment remain outstanding.

Sample locations along the route at a useful spatial resolution; do not assume a
single starting-point forecast represents the route, or issue one weather request
per raw GPX point. Preserve hourly variation for both scoring and explanations.
Route-point sampling does not imply the weather source can resolve every point.

Return meaningful reasons and trade-offs with the ranking, plus forecast source,
issue/retrieval times where available, coverage and the assessment policy used.
Missing forecasts must be explicit rather than converted into neutral comfort.
A fit score is not a probability of good weather, and individual hourly rain
probabilities are not automatically a whole-ride rain probability.

Keep relative comfort ranking separate from the rider's minimum standards:

- If all assessable routes fall below the standards, return the best available
  route and its alternatives, explicitly labelled as below the standards. Explain
  the selected route's drawbacks and exactly which standards it fails.
- Include a collection-level assessment as well as per-route assessments, so
  every client can clearly say that none of the routes meets the standards.
- Minimum-standard failures must remain visible regardless of a high overall
  comfort score. Warmth cannot erase a failed rain threshold, for example.
- Treat standards as rider-configurable inputs, separate from ranking priorities.
  A missing threshold is not an invented limit, and an unconfigured profile must
  not be presented as a completed minimum-standard assessment.
- Insufficient forecast coverage is an unknown assessment, not a standards
  failure or a pass. If some routes cannot be assessed, say that none of the
  assessed routes qualifies rather than claiming that none of all submitted
  routes qualifies. If none can be ranked reliably, return an explicit
  insufficient-data result instead of inventing a best route.

Implemented selection rule: prefer routes known to meet all configured standards,
ranked by comfort. When none qualifies, offer the highest-ranked assessable route
as the best available fallback. Return structured failure reasons (criterion,
configured limit, forecast evidence and affected hours/route sections) alongside
readable explanations. The request/response fields and threshold rules are documented
in `docs/api.md`; every result includes the resolved preferences and algorithm version.

For speed, perform reusable route analysis during ingestion and cache forecasts
with an explicit freshness policy. Set measurable latency and workload targets
once the initial route collection is available, separating fresh-fetch requests
from requests answered using cached forecasts.

### Day-level comparison policy (refined with Dan)

The API accepts a day and searches daylight departures, then scores conditions
encountered at the rider's estimated arrival along each route. Dan chose 20 km/h
as the starting pace; whole rides must fit in daylight. This supersedes the earlier
proposal to aggregate the entire day without modelling a departure.

The first evaluator uses constant moving speed, a 30-minute departure grid,
500-metre route sections, and weather samples every 10 km. Duration does not yet
account for breaks, elevation or wind. The daylight window is the conservative
intersection of sunrise-to-sunset across sampled locations. These assumptions are
returned in each response, and speed/departure grid are request inputs.

Provisional comfort is 75% distance-weighted mean plus 25% worst sampled section.
Temperature, route-relative headwind/crosswind/gust and precipitation each have
explicit preference settings. Wind assistance is reported by route distance; no
tailwind-home bonus is added. Dates and time zones include DST handling. Native
weather period semantics are preserved, and missing evidence is explicit.

### Working API slice (2026-10-09)

Implemented GPX ingestion, D1 ownership, bearer authentication, provider contracts,
Global Spot hourly, shared forecast caching, daylight departure search, preference
resolution and ranked explanations. `docs/api.md` describes the exact boundaries.
The earlier surface-classification and Strava endpoints were removed with Dan's
authorization to start afresh. The app clients remain to be adapted.

All six supplied files were uploaded through the local Workers HTTP API and ranked
using live Met Office forecasts. The cold baseline was about 605 ms; after lookup
optimization, ten warm comparisons had a median of 29 ms and maximum/p95 of 37 ms,
with all 55 weather lookups cached. These are local observations, not cloud latency
or load guarantees. See the stored report for inputs, provenance and rankings.

Next: review real ranked comparisons with Dan to tune the provisional curves and
personal standards. Climate normals, elevation preferences, pace modelling and
additional providers are subsequent extensions. Remote D1, Worker secrets and an
appropriate Workers plan must be configured before deploying this rebuild.

### First evaluation milestone

1. Import a small, varied selection of Dan's real GPX files and inspect their
   geometry, distance, elevation availability and data quality.
2. Pair those routes with fixed forecast scenarios. Ask for pairwise choices,
   acceptability and reasons, rather than a permanent rating for each route.
3. Record the preferences used for every judgement so seasonal or daily changes
   do not become contradictory labels.
4. Turn agreed comparisons into repeatable acceptance tests. Include different
   rider preferences, missing weather, differing conditions along a route and
   days where none of the routes is appealing. Check that a below-standard best
   available route is returned with explicit failures, and that missing data is
   not mistaken for a minimum-standard failure. Include the same weather evaluated
   under different rider/month profiles and missing climate-reference data. Keep
   season-unspecified human comparisons separate from confirmed seasonal cases;
   the earlier dry-13°C preference does not assert that 13°C meets summer minimums.
   Reserve some comparisons to check
   generalisation instead of tuning against every example.
5. Implement the smallest API slice that passes those checks; review its rankings
   together before expanding integrations, factors or client work.

### Initial route collection inspected (2026-10-09)

All six supplied files in `/Users/danbarclay/Downloads/GPX` parsed successfully,
with finite coordinates inside latitude/longitude bounds. This is a geometry
inspection, not full schema or riding-suitability validation. The reproducible
inventory, source fingerprints and measurement definitions are in
`evaluation/initial-route-inventory.json` (local and Git-ignored).

| Route | Distance | Ascent from supplied elevations | Geometry |
|---|---:|---:|---|
| London Loop | 39.8 km | 137 m | Same start and end |
| Braintree | 51.0 km | 274 m | Different start and end |
| Potters Bar | 77.1 km | Unknown | End within 185 m of start |
| Woking to Brighton | 84.1 km | Unknown | Different start and end |
| Pilgrim's Way | 96.4 km | 969 m | Different start and end |
| East Anglia | 111.7 km | 671 m | Different start and end |

Distances follow supplied track geometry; ascent is the unsmoothed sum of positive
elevation changes, not a surveyed value. These are all cycle.travel GPX 1.0
exports, each containing one track segment and no point timestamps. They do not
yet demonstrate compatibility with Garmin exports or other GPX structures.

Ingestion and assessment cases revealed by the collection:

- Missing elevation: Potters Bar and Woking to Brighton remain eligible for
  weather scoring; elevation must be unknown, not zero.
- Repeated coordinates: East Anglia and London Loop each contain one consecutive
  duplicate. A zero-length leg must not create a bearing or distort weighting.
- Variable spacing: use distance-based spatial sampling or segment-length
  weighting so dense sections do not dominate the weather assessment.
- Geographic variation: London Loop spans about 9 km east/west and 6 km
  north/south; East Anglia spans about 64 km north/south and Pilgrim's Way about
  60 km east/west. The collection supports comparing compact and dispersed routes.
- Route direction: four routes finish far from their start. "Favourable wind"
  cannot universally mean a tailwind on a homeward leg. Preserve supplied
  traversal order; do not assume routes can safely be reversed.
- Metadata: the Woking to Brighton file's embedded name is truncated to
  "Woking to Brigh". Retain the original metadata; the inventory uses the filename
  for its display name.

The preference comparisons and Dan's responses are recorded in
[`evaluation/preference-comparisons.json`](evaluation/preference-comparisons.json).
These conditions are invented examples, not fetched forecasts. The wind response
is conditional on assistance for most of the ride; the rain response ranks dry
13°C ahead of 18°C with two hours of light rain. Neither establishes universal
weights, and exact forecast inputs still need definition for executable fixtures.
Dan also specified that a day with no qualifying routes should still return the
best available route with drawbacks and an explicit no-routes-meet-standards
assessment. This is an agreed response requirement, not a numeric threshold.

The working slice now provides those request/response schemas and daytime policies.
Fixed scenarios exercise different personal limits without evaluator changes. Human
comparison records remain distinct from synthetic numeric test inputs; Dan's
personal numerical calibration is the next review step.

---

## Earlier app implementation plan

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

- [x] Apple Developer Program membership active; App ID `com.danbarclay.rideon` with WeatherKit, HealthKit, iCloud/CloudKit capabilities (WeatherKit needs BOTH the Capabilities and App Services tabs ticked on the identifier — see CLAUDE.md Signing)
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
- [x] Best-day scan over the next 10 forecast-confident days, graded as a `RideTier` letter (S/A/B/C/D; D = explicit "don't ride" recommendation)
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
- [x] Live on-device verification of WeatherKit entitlements — real team `R2GGK3VN2C` signs everything, entitlements attach in Debug on both platforms, Mac provisioning profile minted (PLA agreed, device registered), and live WeatherKit returns real forecasts on macOS (verified 2026-07-12 after enabling WeatherKit under the App ID's App Services tab — see CLAUDE.md Signing section). HealthKit live verification folds into the Phase 7 real-device run below.

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
- [x] Engine golden-scenario tests: windy day flips direction preference; short time window drops far routes; novelty decay curve; intent reweighting; weights-panel changes alter ranking deterministically; best-day scan picks the standout day, tie-breaks early, grades all-bad stretches as D; tier boundary mapping
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
