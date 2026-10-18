# Cycle map: plan

Replace the app's Apple Maps backgrounds with a map that looks like cycle.travel's: its colours, dotted
cycle routes, route-number badges, cycle paths by surface and labelling, set in Montserrat. This doc is
the plan; an agent should be able to start any workstream from it without the conversation that
produced it.

| | |
|---|---|
| Status | In progress. Prototype done ([`prototype/`](prototype/)); WS4a done (spec in DESIGN-SYSTEM.md, decisions below); WS3.0 spike done: MapLibre Native works ([findings](#ws3-app-integration-115-weeks)); WS1.2 next |
| Estimate | 4–6 weeks for one person |
| Style spec | [`cycle-travel-style.md`](cycle-travel-style.md): every measured rule, the palette and the known gaps |
| Prototype | [`prototype/README.md`](prototype/README.md): how to run it and how the comparison screenshots were taken |
| Comparisons | [`screenshots/`](screenshots/), cycle.travel on the left, prototype on the right ([gallery](#comparison-screenshots)) |
| Written | 18 October 2026 |

## Goal

Dan's words, from the conversation that started this:

- "use effectively exactly the same map that cycle.travel share on their website"
- "use Montserrat throughout"
- route dots sized and spaced "to match those that denote a cycle route on cycle.travel", with "lines
  between the dots to connect the route, just like how cycle.travel shows it"
- the repeater badges copied "from cycle.travel as much as possible", and "all our labelling matches
  their labelling exactly so that it feels like a single harmonious and continuous experience for users"

Why it matters: Ride On recommends routes and links out to cycle.travel ("Open in cycle.travel" on Ride
detail; the browser extension imports from it). A map that looks the same makes the hand-off seamless.

Success is judged by eye against cycle.travel at the [six comparison views](#comparison-screenshots),
on an iPhone, by Dan.

## How we got here

### What cycle.travel uses

- **Renderer:** Leaflet showing pre-drawn PNG tiles from its own server
  (`raster-eu.cycle.travel/topoclassical_eu@2x/{z}/{x}/{y}.png`, up to z17). No vector tiles, so no style
  file to read: everything in the style spec was measured off screenshots and the map key.
- **Data:** OpenStreetMap, plus Ordnance Survey and Department for Transport data for the UK and
  elevation data for hill shading. Rebuilt about monthly.
- **Fonts:** Montserrat (place names) and what looks like Open Sans (small labels), by eye. We use
  Montserrat for everything.
- **Permission:** no public tile service or usage policy. Its tile server returns 403 to non-browser
  clients. See [open decision 1](#open-decisions).

### Options considered

| | What | Verdict |
|---|---|---|
| A | Load cycle.travel's tiles in the app | Identical, hours of work, but needs Richard Fairhurst's permission, blurs when rotated, and depends on his server. Not pursued |
| A2 | OpenCycleMap (Thunderforest) tiles over Apple Maps | Opaque full map, not a layer; fixed lines and fonts; £95/month past the free tier. Doesn't meet the goal |
| A3 | Apple Maps plus our own dotted routes and badges drawn on top | 3–5 days, works on macOS, gets the dots. But Apple's labels stay in SF and the base map can't be recoloured. Doesn't meet "Montserrat throughout" |
| **B** | **MapLibre + Protomaps basemap restyled + our own cycling layer** | **Chosen.** Full control of every colour, line and font; a few dollars a month on R2; no third-party tile servers. Costs: a data pipeline, a new map SDK, and macOS needs a plan |
| C | Our own whole-UK basemap (tilemaker/planetiler) | Closest possible match (e.g. minor-road density), longest. B can grow into it: see [WS1](#ws1-map-data-152-weeks) |

### What the prototype proved

[`prototype/`](prototype/) is option B in a browser: MapLibre GL JS 6.11.2, the Protomaps world basemap,
and cycle routes, paths and POIs from Overpass as GeoJSON for south-east England. Dan reviewed it and
was "really happy with this". It matches cycle.travel closely on route dots (size, spacing, colours,
the road or path visible underneath), badges, road colours and widths, path styling by surface, place
and street labels, and the zoom each thing appears at. The [style spec](cycle-travel-style.md) records
how, and lists what still differs.

What the prototype does that **can't ship**:

- Data from Overpass as 33 MB of GeoJSON for one region (WS1 replaces it with vector tiles).
- Basemap streamed from strava-stitch's file (Ride On needs its own).
- Fonts as woff2 via `font-faces`, badges drawn at runtime in JavaScript (WS2).
- Tuned at 2× in desktop Chrome (WS2 re-tunes at 3× on iPhone).

## Architecture

```
            OSM GB extract (Geofabrik)                 DEM (Mapterhorn / OS Terrain 50 / Copernicus)
                       │                                              │
              planetiler profile                       gdal hillshade/terrain-RGB + gdal_contour
           (routes, badges, paths, lanes, POIs)              + tippecanoe / pmtiles convert
                       │                                              │
           cycling-YYYYMMDD.pmtiles              terrain-YYYYMMDD.pmtiles, contours-YYYYMMDD.pmtiles
                       └───────────────┬──────────────────────────────┘
  Protomaps build ──► basemap-YYYYMMDD.pmtiles (world copy or `pmtiles extract` of our region)
                                       │
                          R2 bucket (same Cloudflare account as ride-on-api)
                                       │
               ride-on-api Worker: GET /maps/<file>.pmtiles, HTTP Range, immutable caching
                                       │
   App bundle: style.json + glyph PBFs + sprite ──► MapLibre Native (iOS) ──► SwiftUI wrapper
                                                    + route line, casing, start marker as layers
```

- **Basemap:** Protomaps' OpenStreetMap build, the same schema the prototype styles. strava-stitch
  already hosts `world-20260908.pmtiles` (137,855,359,979 bytes, z0–15) in R2 bucket `strava-stitch-maps`
  and serves it from its Worker (`worker.ts`, `app/data/maps.ts`, `app/maps.ts`; ops notes in its
  `docs/map-background-options.md`: quarterly refresh, new dated keys, multipart copy). Ride On gets its
  own dated copy, or a regional `pmtiles extract`, so the two apps can refresh independently. Don't point
  the app at strava-stitch's URL.
- **Cycling overlay:** our own PMTiles built from a Geofabrik GB extract with
  [planetiler](https://github.com/onthegomap/planetiler) (Java, fast, handles relations, writes PMTiles
  directly; `FeatureMerge.mergeLineStrings` replaces the prototype's hand-written way chaining).
  tilemaker (Lua profiles; cycle.travel's author wrote it) is the alternative.
- **Terrain:** hillshade as a `raster-dem` source and contours as a vector source, from a DEM.
- **Serving:** one Worker route on `ride-on-api` that streams R2 objects with HTTP Range (single ranges,
  ≤ 8 MiB, as strava-stitch does), `Cache-Control: public, max-age=31536000, immutable` because keys are
  dated. R2 egress is free.
- **Style:** generated by a script (the prototype's `build-style.mjs`, grown up), bundled in the app with
  glyphs and sprite, so the map's look ships with the app version and can be reviewed in PRs. Tile URLs
  inside it point at `https://api.ride-on.cc/maps/...`.
- **App:** MapLibre Native for iOS through SPM, wrapped once for SwiftUI. The route the user is looking
  at is drawn as style layers on top of the cycle map (line, white casing, start marker), not as SwiftUI
  overlays, so it sits under the labels.
- **Directions and ETAs** stay on MapKit (`LiveETAProvider`): only the map display changes.

Suggested home for the pipeline: a top-level `maps/` directory next to `worker/` and `extension/`
(`maps/tiles/` for the planetiler profile, `maps/style/` for the style builder, fonts and sprite
sources). The prototype stays in `docs/maps/prototype/` as the reference.

## Workstreams

Do WS4's spec entries first: DESIGN-SYSTEM.md is the spec ("every screen must follow it") and §6's
component inventory is closed, so the map component has to be in the doc before any UI code. WS1 and the
WS3 spike can then run in parallel.

### Suggested PR sequence

1. **WS4a** — Record the [open decisions](#open-decisions); add the cycle map to DESIGN-SYSTEM.md (§2, §3,
   §4, §6) and a phase to PLAN.md.
2. **WS1.1** — Basemap on R2 + Worker route.
3. **WS3.0** — Spike: MapLibre Native in the Routes map behind `--cycle-map`, basemap only.
4. **WS1.2** — planetiler profile + first GB cycling overlay.
5. **WS2** — Production style builder, glyphs, sprite, colour fix.
6. **WS3.2–3.4** — Routes map "Cycle" look; then cards and thumbnails; then the hero.
7. **WS1.3–1.4** — Cycle lanes, POIs, hillshade, contours.
8. **WS1.5** — Scheduled rebuilds.
9. **WS3.6** — macOS.
10. **WS4b** — Final doc pass; remove the flag.

Each PR follows the repo's rules: branch off `main`, update `docs/redesign/README.md` in any redesign PR,
merge with `gh pr merge --merge` when ready.

### WS1: Map data (1.5–2 weeks)

**1.1 Basemap hosting.**
- Decide the coverage ([decision 4](#open-decisions)). For GB only, `pmtiles extract world.pmtiles
  gb.pmtiles --bbox=-8.7,49.8,1.9,60.9` cuts the 128 GiB world file to a few GB; with Europe, a wider
  bbox. Or copy the whole dated world file server-side (multipart copy, as strava-stitch's doc
  describes).
- Bucket: a new `ride-on-maps` bucket, or bind `strava-stitch-maps` to ride-on-api with Ride On's own
  keys. Both are on the same Cloudflare account.
- Worker route in `worker/` (read `worker/CLAUDE.md` first): `GET /maps/:key` → R2 `get` with the
  request's single Range, 206 with `Content-Range`, `Accept-Ranges: bytes`, ETag, immutable caching;
  reject multi-range and ranges over 8 MiB with 416 as strava-stitch does; `HEAD` support. Document it
  in `docs/api.md`.
- Done when `curl -r 0-16383 https://api.ride-on.cc/maps/<file>` returns 206 starting with the
  `PMTiles` magic bytes and the prototype renders with `serve.ts` pointed at it.

**1.2 Cycling overlay (planetiler).** Port the prototype's rules from `prototype/tools/*.mjs`; the style
spec explains each one. Layers:

| Layer | Geometry | Attributes | Zooms | From |
|---|---|---|---|---|
| `routes` | line | `network` (icn/ncn/rcn/lcn), `rank`, `minz`, `ref` (≤ 2 refs) | 5–14 | `routes.mjs`: highest network per way, lowest `minz`, London rule |
| `route_badges` | line | `badge` (red/blue/eu), `label`, `ev` | 10–14 | `shields.mjs`: one merged line per signed relation, ref regex |
| `paths` | line | `class` (p/u/f), `bridge`, plus plain footpaths as `class=foot` | 11–14 | `paths.mjs`: the path rule. Include footpaths so the style stops using the basemap's paths and the knockout layer goes |
| `cycle_lanes` | line | `side` (left/right/both) | 12–14 | New: `cycleway=lane`, `cycleway:left/right/both=lane` (and `share_busway`?) on roads. Check against cycle.travel's purple lanes |
| `pois` | point | `kind`, `name` | 10–14 | `pois.mjs` (stations, peaks) plus new kinds: cafe, pub, toilets, drinking_water, bicycle_parking, shop=bicycle, camp_site, parking, viewpoint |

- Merge lines per feature group (`FeatureMerge.mergeLineStrings`) so dashes and dots don't restart at
  every way join; simplify per zoom; keep z14 as max and let MapLibre overzoom.
- Test the profile with planetiler's test utilities against small OSM fixtures: the path rule table,
  London's `minz`, badge refs.
- Done when the prototype, switched from GeoJSON to the overlay, looks the same at the six comparison
  views (re-take the screenshots), and the GB file size and build time are recorded here.

**1.3 Cycle lanes and POIs.** Data from 1.2's new layers; styling in WS2.

**1.4 Terrain.** cycle.travel shades hills and draws contours (see the Surrey Hills comparison).
- DEM options: [Mapterhorn](https://mapterhorn.com) (open terrain tiles, already PMTiles), OS Terrain 50
  (OGL, GB only), Copernicus GLO-30.
- Hillshade: terrain-RGB PMTiles → `raster-dem` source + `hillshade` layer. Verify MapLibre Native reads
  `raster-dem` from `pmtiles://` (see the [capability table](#maplibre-native-capabilities)).
- Contours: `gdal_contour` (10 m? match cycle.travel's interval by measuring) → tippecanoe → PMTiles.
- Done when the Surrey Hills view shows shading and contours at cycle.travel's density.

**1.5 Scheduled rebuilds.** GitHub Actions on a monthly cron (cycle.travel rebuilds about monthly):
download the Geofabrik extract, run planetiler, upload with a dated key, open a PR bumping the dated URLs
in the style. Large uploads go through the S3 API (rclone or multipart), not `wrangler r2 object put`,
which caps object size. Keep the previous two builds so older app versions keep working. Basemap:
quarterly, like strava-stitch.

### WS2: Style for MapLibre Native (~1 week)

**2.1 Production style builder.** Move `build-style.mjs` into `maps/style/`. Sources become the PMTiles
URLs; GeoJSON sources go. Point path layers at the overlay's `paths` (drop `ct_footpaths` on the basemap
and `ct_unpaved_knockout`). Validate the output with `@maplibre/maplibre-gl-style-spec`'s validator in
CI.

**2.2 Colours.** Use map-key values as they are and fix the screenshot inverse; values are in the
style spec's [palette](cycle-travel-style.md#palette). Re-take the comparisons.

**2.3 Glyphs.** MapLibre Native supports `font-faces` from 6.18.0 but can't omit `glyphs`
([#165](https://github.com/maplibre/maplibre-native/issues/165)). Generate glyph PBFs for the seven
Montserrat faces with [maplibre/font-maker](https://github.com/maplibre/font-maker), latin and
latin-ext ranges, bundle them, and set `glyphs` to the bundle (`asset://` or a file URL resolved at
load). Font names in the style must match the PBF directory names.

**2.4 Sprite.** Badge images (red, blue, EuroVelo) with stretch areas and a `content` box so
`icon-text-fit` works, plus POI icons from [Maki](https://github.com/mapbox/maki) /
[Temaki](https://github.com/ideditor/temaki) (CC0) or drawn by us, never cycle.travel's SVGs. Build
@2x and @3x with [spreet](https://github.com/flother/spreet). Alternative for badges only: draw them in
`mapView(_:didFailToLoadImage:)` like the prototype's `styleimagemissing`.

**2.5 Gaps.** Work through the style spec's [known gaps](cycle-travel-style.md#known-gaps).

**2.6 3× and device.** Every size was tuned at 2× in Chrome. Re-check dots, badges and labels on an
iPhone 17 at 3×. MapLibre Native draws text slightly differently from GL JS.

**2.7 Dark mode** ([decision 6](#open-decisions)). Either a dark variant built from the same script, or
the map stays light in Dark Mode.

Done when the six comparison views on device read as cycle.travel to Dan, and the style validates.

### WS3: App integration (1–1.5 weeks)

**3.0 Spike.** Done, 18 October 2026: **MapLibre Native is good enough; build on it** (no
`WKWebView` fallback). `CycleMapSpike` (`RoutesUI/CycleMapSpike.swift`) stands in for the Routes map's
MapKit view when the app is launched with `--cycle-map`; `RoutesMap.body` switches on it. It shows the
prototype style's 73 basemap layers (overlay layers removed, built by
`prototype/scripts/native-spike.sh`), the shortlist as route lines (others white, the selected one in
the accent with a white casing) under the labels, tap-to-select and framing above the panel. Throwaway:
3.2 replaces it.

| | |
|---|---|
| Launch | `--fixture-world --cycle-map` opens on Routes with the cycle map. `-CycleMapBasemap <url>` swaps the basemap archive (e.g. `pmtiles://file:///…/basemap-gb-20261017.pmtiles` in the Simulator); `-CycleMapCamera 51.4455,-0.2665,13` pins the camera (latitude, longitude, zoom) for screenshots |
| Screenshots | [Richmond Park z11](screenshots/native-spike-richmond-park-z11.jpg), [z15](screenshots/native-spike-richmond-park-z15.jpg) (iPhone 17 Simulator) |
| Version | MapLibre Native iOS 6.31.0, `maplibre-gl-native-distribution` with `exact:`, RoutesUI only, `.when(platforms: [.iOS])` |
| PMTiles | `pmtiles://https://…` (checked against `build.protomaps.com/20261017.pmtiles`, the build our extract came from) and `pmtiles://file://…` both render the same |
| Fonts | Montserrat from glyph PBFs bundled in RoutesUI's resources, 7 faces × 6 ranges = 3.5 MB |
| App size | Release, arm64: 35 MB app, of which `MapLibre.framework` 7.8 MB and the glyph bundle 3.5 MB (both uncompressed) |
| Memory | 118–126 MB footprint on the Routes tab at z11–16.5 (Simulator: indicative only) |
| macOS | Builds; MapLibre isn't linked, `RoutesMap` stays on MapKit. The glyph bundle still ships (SwiftPM resources can't be per-platform) |
| Not checked | Frame rate, memory and battery **on a device** (Dan: run `--cycle-map` on the iPhone, pan and pinch between Richmond Park and central London at z11–15 with Xcode's memory gauge and Instruments' Animation Hitches). `raster-dem` from PMTiles (no DEM until 1.4) |

What 3.2 has to carry over from the spike:
- **No camera calls before layout.** `setVisibleCoordinateBounds` or `setCenter(_:zoomLevel:)` on a
  zero-size view, or before `layoutSubviews`, lands at the wrong zoom (5.5 instead of 8.7 for the
  fixture routes). Wait for non-empty bounds, call `layoutIfNeeded()` (the core map's size only updates
  in `layoutSubviews`), then move the camera. The spike does it in `applyFrame`, from `updateUIView` and
  the style/map-loaded delegates.
- **Draw under the safe area, frame inside it.** A `UIViewRepresentable` is laid out inside the SwiftUI
  safe area, so it stopped at the panel. Wrap it in a `GeometryReader` that respects the safe area, pass
  `geometry.safeAreaInsets` in, put `.ignoresSafeArea()` on the representable, set
  `automaticallyAdjustsContentInset = false` and `setContentInset(_:animated:completionHandler:)` from
  the insets. A reader that itself ignores the safe area reads zero insets.
- **Glyph URLs are absolute.** Native won't resolve a relative `glyphs` URL: the spike writes
  `bundle://glyphs/{fontstack}/{range}.pbf` in the style, swaps `bundle://` for the resource bundle's
  `file://` URL at runtime and writes the result to Caches. Font stack names must equal the glyph
  directory names (`Montserrat-Regular`, not `Montserrat Regular`). A missing range logs
  `Failed to load glyph range 1024-1279 for font stack Montserrat-Regular` and drops those labels;
  nothing else breaks. Bundled: 0-255, 256-511, 512-767 (Latin and Latin Extended, Welsh ŵ ŷ),
  7680-7935 (ẁ ẃ ỳ), 8192-8447 and 8448-8703 (punctuation, symbols). The Montserrat OFL ships beside
  them.
- **Location.** `showsUserLocation = true` makes `MLNMapView` request permission itself; turn it on only
  once Ride On's priming sheet has it (the spike checks `CLLocationManager().authorizationStatus`). The
  Routes tab's own location prompt comes from `LiveLocationProvider`, and
  `xcrun simctl privacy … grant location` doesn't stop it on iOS 26: for unattended Simulator
  screenshots, accept it once from a UI test (tap "Allow While Using App" on the springboard).
- **Camera model.** `RoutesView`'s camera is `.userLocation(fallback: .automatic)` until a route is
  picked, so `camera.rect` is nil; the spike frames every drawn route instead. `CycleMap` needs its own
  camera type (a rect, a centre and zoom, or "fit these routes") rather than MapKit's
  `MapCameraPosition`.
- Zoom levels are GL JS's: cycle.travel zoom *n* is Native zoom *n* − 1, as in the prototype.
- Hide `logoView` and the compass; keep the attribution button until 3.5 replaces it.

**3.1 Dependency.** [maplibre-gl-native-distribution](https://github.com/maplibre/maplibre-gl-native-distribution)
is iOS only. The spike added it to `app/Packages/Features/Package.swift` (platforms iOS 26 + macOS 26)
for RoutesUI only, with `condition: .when(platforms: [.iOS])`; move it to SharedUI with the component,
and keep MapKit code paths under `#if os(macOS)` ([decision 2](#open-decisions)). Regenerate the
project (`cd app && xcodegen generate`) and update the module map in `CLAUDE.md`.
[maplibre/swiftui-dsl](https://github.com/maplibre/swiftui-dsl) is iOS-only and experimental: prefer
our own small `UIViewRepresentable`.

**3.2 Map component.** One wrapper in SharedUI (name it in DESIGN-SYSTEM.md §6 first, e.g. `CycleMap`)
taking: the style URL, a camera (framing rect or position), interaction on/off, and overlays (route
coordinates, tint, casing, start marker; other routes in white for the Routes map). Overlays are an
`MLNShapeSource` plus line and symbol layers inserted below the first label layer. Tap handling via
`visibleFeatures(at:)` on the overlay layers, replacing `MapReader`/`proxy.convert` hit-testing.

**3.3 Flag.** `--cycle-map` launch argument, read the way `--fixture-world` is
(`ProcessInfo.processInfo.arguments.contains(...)`, `FixtureWorld.swift:12`; `--reset-onboarding` in
`PreferencesStore.swift:112`). Later a hidden Preferences toggle if Dan wants to dogfood it.

**3.4 Replace surfaces, in this order:**

| Surface | Today (main) | Change |
|---|---|---|
| Routes tab map | `RoutesMap` in `app/Packages/Features/Sources/RoutesUI/RoutesMap.swift:31`: `MapReader` at :47, `Map(position:)` at :48, `.mapStyle(look.style)` at :80, tap at :81 with `proxy.convert` at :91; `MapLook` enum at :7 (satellite/hybrid/standard); `RouteCallout` :116, `MapControls` :157. Used at `RoutesView.swift:106` | Add a `cycle` `MapLook` behind the flag, then make it the default. The interactive surface where the cycle map matters most |
| Shortlist cards | `RouteMap(…, style: .card)` at `RoutesUI/ShortlistCard.swift:75` | Static image: `MLNMapSnapshotter`, cached per route + size + scale |
| Thumbnails | `RouteMap(…, style: .thumbnail)` at `RoutesUI/RouteRows.swift:202`, `RideUI/TrackRideSheet.swift:165`, `RideUI/RidesView.swift:382` | Same snapshots. Many per screen: never live map views in lists |
| Ride hero | `RouteMap(…, style: .hero, tint:)` at `SharedUI/RideHero.swift:40`; `RouteMap.swift`: `Map(initialPosition: .rect(framingRect), interactionModes: [])` at :56, `.mapStyle(.imagery)` at :75, `RouteOutline` shape at :93 | [Decision 3](#open-decisions): satellite or cycle map. If cycle map, a non-interactive live view or a snapshot; keep the zoom transition source |
| Wind on the Ride | `WindRouteMap` at `SharedUI/WindRouteMap.swift:45`, `.mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))` at :60; used at `RideUI/RideBreakdownCards.swift:79` | Keep MapKit, or a muted variant of the cycle style (fewer layers, no routes) so the wind colours stay readable |

Other `import MapKit` files: `RoutesView.swift` (camera types), `LiveETAProvider.swift` (directions,
stays), `RouteSnapshotService.swift` (MapKit snapshots, only used by tests; replace or leave).

**3.5 Attribution.** Replace "Apple Maps" + Legal with "© OpenStreetMap contributors" (linking
https://www.openstreetmap.org/copyright) and Protomaps, kept visible and ≥ 10 pt from custom content as
DESIGN-SYSTEM.md requires today. MapLibre's attribution button is an option; a SwiftUI row matching the
current hero layout is probably nicer. Snapshots need attribution too where they're shown large.

**3.6 macOS.** See [below](#macos).

**3.7 Fixture world.** `RideOnUITests` never touch the network. Options: a tiny bundled PMTiles
(`pmtiles extract` of a bbox around the fixture routes) with the real style, or a fixture style with a
background layer and the route overlay only. Assert the map and its attribution exist; don't
screenshot-diff in XCUITest.

Done when every surface above uses the cycle map on iOS behind the flag, tests are green
(`xcodebuild … -destination 'platform=iOS Simulator,name=iPhone 17' test`), and the flag is removed.

### WS4: Spec and docs (1–2 days)

**WS4a, before UI code:**
- DESIGN-SYSTEM.md
  - §2 Materials: the clear-glass rule assumes dark media ("the Routes map is satellite imagery, dark
    enough on its own"). Over a light cycle map, clear glass with white glyphs won't be legible: decide
    regular glass or a scrim for `MapControls` and the hero.
  - §2 attribution rule: rewrite for OpenStreetMap/Protomaps.
  - §3 Colour: "the only custom palette is `ConditionPalette`". Add the map style as a second,
    self-contained palette that lives in the style file, not in SwiftUI.
  - §4 Typography: "SF Pro, system text styles only". Add the map exception: Montserrat inside the map
    only, not Dynamic Type.
  - §6: add the map component; update #1 `RideHero` (`.mapStyle(.imagery)`), #12 `RoutesMap`, #16
    `WindRouteMap`.
  - §9: the Routes row says "Full-screen satellite `RoutesMap`".
- PLAN.md: a phase for the cycle map pointing here.

**WS4b, at the end:** `docs/redesign/README.md` status and screen notes, `CLAUDE.md` module map (new
dependency, `maps/` directory), `docs/api.md` (maps route), this doc's status.

## MapLibre Native capabilities

From research in October 2026; **re-check against the current release notes before relying on any
row.**

| Need | Status | Source |
|---|---|---|
| PMTiles (`pmtiles://`) on iOS | Supported since 6.10.0; fixes in 6.14.0 and 6.28.0. **Verified** in the WS3.0 spike on 6.31.0, over HTTPS and from a local file | [newsletter Jan 2025](https://maplibre.org/news/2025-02-03-maplibre-newsletter-january-2025/), [#3403](https://github.com/maplibre/maplibre-native/issues/3403), [#3404](https://github.com/maplibre/maplibre-native/issues/3404), [#4399](https://github.com/maplibre/maplibre-native/issues/4399) |
| `raster-dem` + hillshade from PMTiles | Unverified | Check in the WS3 spike |
| `font-faces` in the style | 6.18.0+ | Release notes |
| Glyph PBFs from the app bundle | **Verified** (WS3.0) with an absolute `file://` `glyphs` URL | |
| Style without `glyphs` | Not supported | [#165](https://github.com/maplibre/maplibre-native/issues/165) |
| Zoom-dependent `line-dasharray` (our dots) | Supported | Style spec |
| Data-driven `line-dasharray` (per feature) | Not supported; the style doesn't need it | [#744](https://github.com/maplibre/maplibre-native/issues/744) |
| `icon-text-fit` with stretchable images | Supported (inherited, Mapbox iOS 5.8.0); runtime `UIImage` cap insets map to stretch areas | Release notes |
| `symbol-sort-key`, `line-sort-key` | Supported (symbol from Mapbox iOS 4.11.0) | Release notes |
| `text-variable-anchor` + `text-radial-offset` | Supported (Mapbox iOS 4.10.0) | Release notes |
| Runtime images for missing icons | `MLNMapViewDelegate.mapView(_:didFailToLoadImage:)` returns a `UIImage` | API docs |
| Static images | `MLNMapSnapshotter` | API docs |
| SwiftUI | No official view; [swiftui-dsl](https://github.com/maplibre/swiftui-dsl) is iOS-only and experimental | |
| SPM | [maplibre-gl-native-distribution](https://github.com/maplibre/maplibre-gl-native-distribution), iOS only | |
| macOS | No native AppKit SDK; Mac Catalyst only | [discussion #3910](https://github.com/maplibre/maplibre-native/discussions/3910) |

## macOS

The app is native SwiftUI on macOS 26, not Catalyst, so MapLibre Native's iOS package doesn't build
for it. Options ([decision 2](#open-decisions)):

1. **MapKit on macOS** behind the same wrapper. Cheapest; the Mac doesn't get the cycle look.
2. **MapLibre GL JS in a `WKWebView`** with the same `style.json`, glyphs and sprite (GL JS reads them
   all; it's what the prototype runs). Same look everywhere; bridging camera, taps and overlays through
   JavaScript is the cost. Could also be the iOS implementation if the WS3 spike goes badly.
3. **Build MapLibre Native for macOS from source.** It has a macOS platform in-tree but no supported
   distribution. Most work, most risk.

Recommendation: 1 for the first release, 2 if Dan wants parity.

## Attribution and licensing

- **Map data:** © OpenStreetMap contributors, ODbL. Attribution must be visible on every map and
  snapshot shown at size. Ours and Protomaps' tiles are derived databases under ODbL.
- **Protomaps:** basemap tiles ODbL (from OSM); `@protomaps/basemaps` style code BSD-3-Clause.
- **Montserrat:** SIL OFL 1.1 (`prototype/fonts/OFL.txt`). Fine to bundle and convert to PBF.
- **Icons:** Maki and Temaki are CC0. cycle.travel's map-key SVGs are not ours to use.
- **Terrain:** depends on the DEM; OS Terrain 50 is OGL (attribution required), Copernicus has its own
  notice.
- **cycle.travel's design:** not licensed to us. See decision 1.

The repo is public, and `screenshots/` contains crops of cycle.travel's rendering for side-by-side
comparison. Fine for a design reference, but don't put them in the app or marketing.

## Risks

| Risk | Mitigation |
|---|---|
| Copying cycle.travel this closely without permission | Decision 1 before shipping; the style is ours to change if asked |
| MapLibre Native gaps vs GL JS (fonts, PMTiles bugs, text layout) | WS3.0 spike before committing; WKWebView fallback |
| macOS left behind | Decision 2; the wrapper hides the implementation |
| Light map breaks Liquid Glass legibility | WS4a design call before UI work |
| Performance and battery with live maps | Snapshots for cards and thumbnails; live views only on the hero and Routes map |
| App size | Measured in the spike: about 11 MB uncompressed (framework 7.8 MB, glyphs 3.5 MB); the sprite is still to come |
| OSM data gaps (broken relations, missing surface tags) | Not a style bug; fix upstream in OSM when worth it |
| Tile build breaks or R2 file goes missing | Dated keys, keep previous builds, style pinned in the app bundle |
| Overpass used beyond the prototype | Never: production builds from Geofabrik extracts |

## Open decisions

Dan's to make. So work could start, each has a default (recorded 18 October 2026, WS4a): it's what
is being built until Dan says otherwise. To change one, edit this table and DESIGN-SYSTEM.md (§3
dark mode, §6 `CycleMap`, `RideHero`, `WindRouteMap`).

| # | Decision | Status | Building with |
|---|---|---|---|
| 1 | Ask Richard Fairhurst (cycle.travel) before shipping a look this close? | **Open.** Recommended: yes, a short email explaining Ride On links to cycle.travel. Blocks release, not development | — |
| 2 | macOS: MapKit fallback, WKWebView + GL JS, or Catalyst/source build | Default: MapKit on macOS behind `CycleMap` for the first release; WKWebView + GL JS if Dan wants parity | MapKit on macOS |
| 3 | Ride hero: satellite, or the cycle map | Default: stays satellite. Revisit once the Routes map has shipped | Satellite |
| 4 | Coverage: GB only, or Europe (EuroVelo, Avenue Verte into France) | Default: Great Britain. Basemap bbox −8.7, 49.8 → 1.9, 60.9 (3.0 GB); overlay from Geofabrik's GB extract | GB |
| 5 | Small labels: Montserrat, or Open Sans like cycle.travel | **Decided** (Dan): Montserrat throughout | Montserrat |
| 6 | Dark mode: a dark variant, or the map stays light | Default: stays light in Dark Mode; a dark variant later | Light only |
| 7 | Waymarked Trails' route tiles as a stopgap | Default: no (their terms don't allow heavy app use); build our own route layer (WS1.2) | Our own |

## Verifying against cycle.travel

The method is in [`prototype/README.md`](prototype/README.md#comparing-against-cycletravel): Chrome
DevTools MCP, 1200×800 at DPR 2, cycle.travel's sidebar hidden, MapLibre zoom = ct zoom − 1,
`analysis/pair2.py` to pair them. Re-take all six views after any WS2 change and attach them to the PR.
On device, compare an iPhone screenshot with cycle.travel's mobile site at the same place and zoom.

Don't scrape, proxy or bulk-download cycle.travel's tiles or APIs. Screenshots of the public page are
fine for comparison.

## Comparison screenshots

cycle.travel left, prototype right; 4116×1600, DPR 2. Zooms are MapLibre (ct = +1).

| View | What to look at |
|---|---|
| [London, z9](screenshots/cmp-london-z9.jpg) (51.45, −0.15) | National routes and EuroVelo match. cycle.travel hides regional routes here; we show blue rcn everywhere and clusters in central London. cycle.travel has hillshade and a dense grey minor-road net; our motorways are dark slate lines |
| [London, z11](screenshots/cmp-london-z11.jpg) (51.48, −0.17) | cycle.travel shows a dense net of thin red cycleways and lanes; ours start at z12. Too many saturated blue London rcn dots and C badges vs its few thin lavender lines. It shows more minor streets |
| [Putney, z13](screenshots/cmp-putney-z13.jpg) (51.462, −0.215) | Badges (4, 20, C34, CS8, AV) and lcn teal match in place. We draw blue rcn across Roehampton and Southfields that cycle.travel doesn't. It has POI icons, bolder railways and a beige Thames foreshore |
| [Westminster, z14](screenshots/cmp-westminster-z14.jpg) (51.5005, −0.128) | Street labels, LONDON spacing, Charing Cross, Q and C3 dots match. We stack heavy dark red NCN 4 + AV dots along the Albert Embankment; we name extra landmarks; cycle.travel shows bike-parking and toilet icons and red-outlined pedestrian areas |
| [Richmond Park, z13](screenshots/cmp-richmond-park-z13.jpg) (51.4455, −0.2665) | NCN 4 on red-and-white paths and brown unpaved dashes match. Our lcn is heavier; C30 is lavender there, blue here; extra rcn around Roehampton; it has toilet, café and parking icons; our built-up fill looks pinker |
| [Surrey Hills, z12](screenshots/cmp-surrey-hills-z12.jpg) (51.245, −0.33) | NCN 22 matches. cycle.travel has hillshade and contours; draws rcn as thin lavender lines with small dots; shows POI icons and bold railways; doesn't label farms and hamlets. Our brown dashes are heavier |

## Links

- cycle.travel map: https://cycle.travel/map
- cycle.travel map key: https://cycle.travel/map/snippet_key
- Protomaps basemaps: https://github.com/protomaps/basemaps, docs https://docs.protomaps.com
- PMTiles CLI (`extract`): https://github.com/protomaps/go-pmtiles
- planetiler: https://github.com/onthegomap/planetiler
- tilemaker: https://github.com/systemed/tilemaker
- Geofabrik GB extract: https://download.geofabrik.de/europe/united-kingdom.html
- MapLibre Native: https://github.com/maplibre/maplibre-native
- MapLibre Native iOS SPM: https://github.com/maplibre/maplibre-gl-native-distribution
- MapLibre style spec: https://maplibre.org/maplibre-style-spec/
- font-maker: https://github.com/maplibre/font-maker
- spreet: https://github.com/flother/spreet
- Maki: https://github.com/mapbox/maki · Temaki: https://github.com/ideditor/temaki
- Mapterhorn: https://mapterhorn.com
- Montserrat: https://github.com/JulietaUla/Montserrat
- strava-stitch (basemap hosting reference): https://github.com/barclayd/strava-stitch
- OSM copyright: https://www.openstreetmap.org/copyright
