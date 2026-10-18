# Cycling overlay

A [planetiler](https://github.com/onthegomap/planetiler) profile that builds Ride On's cycling overlay:
the cycle routes, route badges, cycle paths, cycle lanes and POIs that the cycle map draws over the
Protomaps basemap. One PMTiles file, z0–14, from an OpenStreetMap extract. The plan is
[`docs/maps/README.md`](../../docs/maps/README.md) (WS1.2); why each rule is what it is is in the
[style spec](../../docs/maps/cycle-travel-style.md).

| File | What |
|---|---|
| `src/main/java/cc/rideon/maps/CyclingProfile.java` | The profile: every rule below |
| `src/test/java/cc/rideon/maps/CyclingProfileTest.java` | Unit tests per rule, plus an end-to-end build of planetiler's Monaco extract |
| `build.sh` | Tests, then builds a PMTiles file, in Docker |
| `pom.xml` | planetiler-core 0.10.2, Java 21 |

## Layers

Zooms are MapLibre zooms (cycle.travel's zoom − 1). Lines are merged per tile, so a route's dots don't
restart at every OSM way join.

### `routes`

Every way on a `route=bicycle` relation with `network` `icn`, `ncn`, `rcn` or `lcn`, except relations tagged
`state=proposed` or `construction`: cycle.travel doesn't draw London's planned Quietways and Cycleways.

| Attribute | |
|---|---|
| `network` | The highest network the way is on: `icn` > `ncn` > `rcn` > `lcn`. Only EuroVelo (`ref` starting `EV`, or `cycle_network=EuroVelo`) counts as `icn`; other `icn` routes, like the Avenue Verte, count as `ncn`, as cycle.travel dots them |
| `rank` | That network as a number: 4 icn, 3 ncn, 2 rcn, 1 lcn |
| `minz` | The lowest zoom any of the way's routes shows from: icn and ncn 6, rcn 10, lcn 13. London's TfL routes (`cycle_network=GB:London…`, tagged rcn) 12 with a ref, 13 without |

Zooms: from `floor(minz)` to 14. The style filters on `minz` for the half zoom.

### `route_badges`

One line per way and signed route, for the repeater badges along it.

| Attribute | |
|---|---|
| `badge` | `red` (ncn), `blue` (rcn, including London's C, Q and CS) or `eu` (icn) |
| `label` | The ref, without a leading `EV` for EuroVelo |
| `ev` | `true` when the ref started with `EV` |

Only refs of up to two capital letters and three digits (`4`, `C34`, `CS8`, `EV2`), never lcn, a bare
`C` or named trails. A route split into several relations with the same network and ref gives one line.
Zooms 11–14, or 12–14 for London's, which show with their dots.

### `paths`

| Attribute | |
|---|---|
| `class` | `p` paved and rideable (red and white), `u` unpaved and rideable (brown dashes), `foot` any other footpath (green dashes) |
| `bridge` | `true` on bridges |

Rideable: `highway=cycleway` or `bridleway`, or a path, footway, pedestrian way or track with
`bicycle=yes/designated/permissive`, unless `bicycle=no` or `access=private/no`. With no `surface`, a
`tracktype` other than `grade1` means unpaved; otherwise cycleways, pedestrian ways and paths or footways
with `bicycle=yes/designated` count as paved, bridleways, tracks and `bicycle=permissive` paths and
footways as unpaved. `foot` is every other footway, path, steps or track, except pavements, crossings and private
ways; bridleways with `bicycle=no/dismount` are `foot` too. No tunnels or areas.

Zooms: `p` and `u` 11–14 (cycle.travel draws them from its z12), `foot` 14.

### `cycle_lanes`

Painted lanes on roads, from `cycleway:left`, `cycleway:right`, then `cycleway:both`, then `cycleway`:
`lane` or `opposite_lane` is a lane, `share_busway` or `opposite_share_busway` a shared bus lane.

| Attribute | |
|---|---|
| `side` | `left`, `right` or `both` |
| `bus` | `true` when neither side is a plain cycle lane |

Zooms 12–14. Not styled yet (plan WS1.3).

### `low_roads`

The roads and railways cycle.travel draws at zooms our basemap tiles don't carry them at: lanes and streets
(`highway=unclassified`, `residential` or `living_street`, not private) below the basemap's z12, and main
lines (`railway=rail` without `service` or an industrial, military or test `usage`) below its z11. Route dots
need the lanes under them. No tunnels or areas.

| Attribute | |
|---|---|
| `kind` | `minor` or `rail` |
| `kind_detail` | Minor roads only: the `highway` value, as in the basemap's `roads`. The style draws unclassified lanes much bolder than streets, as cycle.travel does |

Zooms: `minor` 10–11 (at cycle.travel's z10, our 9, only tertiary roads show, and the basemap has those), `rail` 8–10. Every way is kept however short: lanes are split at every junction.

### `pois`

Points, or a point inside the area for mapped buildings and car parks.

| `kind` | From | Zooms |
|---|---|---|
| `station` | Named `railway=station`, not Underground, tram, light rail or heritage | 10–14 |
| `peak` | Named `natural=peak` or `hill` nodes; `ele` in whole metres | 12–14 |
| `landmark` | Named `tourism` = attraction, museum, zoo, aquarium, theme_park, or `historic` = castle, palace, unless also an `amenity`, `place`, `highway`, `leisure` or `shop` (churches, theatres, squares, parks). `icon`: `castle` (castles and palaces), `museum` or `attraction`. Areas also get `area` (m², rounded) and `structure` (`true` for a building or bridge) | 13–14 |
| `cafe`, `pub`, `toilets`, `drinking_water`, `bicycle_parking`, `parking` | `amenity=*` | 14 |
| `bicycle_shop` | `shop=bicycle` | 14 |
| `camp_site`, `viewpoint` | `tourism=*` | 14 |

A POI tagged for more than one icon takes the first that matches, in the order above: a café that is also
a bike shop is a `cafe`. `name` when tagged. Private POIs are skipped. Car parks aren't styled; the rest are.

The kinds the style draws as icons (every new kind but `parking`) also carry how crowded they are, which
the style thins them by:

| Attribute | |
|---|---|
| `crowd_500m` | Other icons within 500 m |
| `crowd_1km` | Other icons within 1 km |

`postProcessTileFeatures` counts them. Icons are buffered 256 px into the tiles around (1 km at z14 as
far north as 66°), so the count includes neighbours over the tile's edge; those copies are then dropped,
leaving the usual 4 px point buffer.

Stations at z10–11 carry `crowd_5km`, the other stations within 5 km, which the style thins them by
there. They're buffered 160 px at those zooms (5 km at z11 as far north as 61°), counted the same way,
then dropped back to 4 px; from z12 they carry no count.

## Build

Needs Docker with at least 8 GB of memory (Docker Desktop → Settings → Resources); no local Java. From
the repo root:

```
curl -L --create-dirs -O --output-dir maps/tiles/data \
  https://download.geofabrik.de/europe/united-kingdom-latest.osm.pbf
maps/tiles/build.sh maps/tiles/data/united-kingdom-latest.osm.pbf maps/tiles/data/cycling-gb-YYYYMMDD.pmtiles
```

`build.sh` runs the tests, then planetiler, in `maven:3.9-eclipse-temurin-21`. Maven's cache is
`~/.m2` (or `$M2_CACHE`). Extra arguments go to planetiler (e.g. `--bounds=-0.6,51.2,0.3,51.7` for a
quick London-only build). `data/` and `target/` are gitignored.

Name the file `cycling-gb-<YYYYMMDD>.pmtiles` with the extract's date: Geofabrik's page shows it, and
planetiler records it in the file's metadata (`pmtiles show <file>`, `planetiler:osm:osmosisreplicationtime`). Keys on R2 are immutable, so a new extract is a new
name.

The 17 October 2026 UK extract (2.3 GB) builds in 1 min 42 s on an M4 Max to 126 MB: 152,850 tiles, the
largest 215 KB (167 KB gzipped), central London at z10, nearly all `low_roads`. Before `low_roads` it was
104 MB with a largest tile of 47 KB. Planetiler skips two POIs whose multipolygons are broken in OSM.
Builds are reproducible: the same extract and profile give the same bytes, so a published key can be
checked by rebuilding it.

## Test

`build.sh` runs them first. On their own:

```
docker run --rm -v "$PWD/maps/tiles":/src -v ~/.m2:/root/.m2 -w /src \
  maven:3.9-eclipse-temurin-21 mvn -B -q test
```

142 tests; they run in under 2 seconds once Maven has its cache. Add a case to the matching table in
`CyclingProfileTest` when a rule changes.

## Publish

`maps/hosting/publish.sh <file>` uploads to the `ride-on-maps` R2 bucket, served from
`https://maps.ride-on.cc/<file>`; it needs the `r2` AWS CLI profile ([`maps/README.md`](../README.md#publishing-a-file)).
Then bump `archives.cycling` in `maps/style/src/style.ts` and rebuild the style.

## Links

- Plan: [`docs/maps/README.md`](../../docs/maps/README.md)
- Style spec: [`docs/maps/cycle-travel-style.md`](../../docs/maps/cycle-travel-style.md)
- Prototype that reads the overlay: [`docs/maps/prototype/`](../../docs/maps/prototype/README.md)
- planetiler: https://github.com/onthegomap/planetiler
- Geofabrik UK extract: https://download.geofabrik.de/europe/united-kingdom.html
- PMTiles: https://github.com/protomaps/PMTiles
