# cycle.travel map style: reference

What cycle.travel's map looks like, measured off its tiles, and how the style builder
([`maps/style/src/style.ts`](../../maps/style/src/style.ts), the prototype's builder since WS2.1)
reproduces each part. This is the spec for WS2 in the
[plan](README.md): when the production style disagrees with this doc, check a fresh cycle.travel
screenshot, then fix whichever is wrong.

Everything here was measured in October 2026 from cycle.travel's own `@2x` raster tiles
(`raster-eu.cycle.travel/topoclassical_eu@2x/{z}/{x}/{y}.png`) as drawn in Chrome, plus its map key at
https://cycle.travel/map/snippet_key. cycle.travel is Richard Fairhurst's work; see the plan's open
decisions before shipping anything this close to it.

## Conventions

- **Zooms are MapLibre zooms** unless marked "ct". cycle.travel is Leaflet with 256 px tiles; MapLibre
  uses 512 px tiles, so **ct zoom *n* = MapLibre zoom *n − 1***. ct z15 (street level) is our 14.
- **Sizes are CSS pixels** (MapLibre style units). Screenshots are at device pixel ratio 2, so a
  measurement of 14 device px in a screenshot is 7 in the style.
- **Colours** are sRGB hex. Read the next section before sampling any new ones.

## Colour sampling

Chrome's screenshots aren't the colours the page drew: the capture converts to the display's colour
profile. Saturated colours move a lot, greys and pale tints barely move.

| Drawn on the page | Captured (both pages, 18 Oct 2026) |
|---|---|
| `#dd4c18` (cycleway, from the key) | `#cd562d` |
| `#c0c8ae` (trunk, from the key) | `#c1c8b0` |
| `#eef2e1` (land) | `#eff2e2` |
| `#808080` | `#808080` |

That check drew the same four swatches (DOM divs, plus a WebGL canvas for the first) on top of
cycle.travel and the prototype and screenshotted both: **the two pages capture identically**, so
side-by-side comparisons are fair even though neither shows true colours.

`shot()` (`maps/style/src/shot.ts`) tries to undo the capture: `shot(sampled)` → the colour the page drew. It was
fitted earlier from 80 swatches as "power 1.96 → matrix → sRGB curve". Two problems found since:

1. **It lightens greys and pale tints.** `shot('#808080')` is `#8b8b8b`, but `#808080` captures as
   itself. Using the sRGB curve on both sides (sRGB decode → the same matrix → sRGB encode) round-trips
   all four swatches to within 2/255, except the cycleway blue channel (gamut clipping). The corrected
   inverse turns the sampled unpaved brown `#834a21` into `#8b451e`, next to the key's gravel colour
   `#8b4513`, which suggests it's right.
2. **It was applied to map-key colours too.** The key's values (`#73bded`, `#dd4c18`…) are what
   cycle.travel draws, not screenshot samples. Running them through `shot()` over-saturates them: our
   cycleway draws `#f14506` where cycle.travel draws `#dd4c18`.

The prototype still has both problems, on purpose: the committed screenshots were taken with it.
**WS2 fixes them**: use key values as they are, and run only screenshot samples through the corrected
inverse. The table below gives both values. Re-check any colour you change with a new swatch test
rather than trusting a model.

Route dots, badges and other runtime-drawn colours were tuned by eye against screenshots and never went
through `shot()`.

## cycle.travel's map key

From https://cycle.travel/map/snippet_key. These are the values its renderer uses.

| Feature | Line |
|---|---|
| National route (ncn) | `#FF0000`, width 5, dash `[0.1, 9]`, round caps: a row of dots |
| Regional route (rcn) | `#0000FF`, same dots |
| Local route (lcn) | `#008B8B`, same dots |
| Cycleway | `#DD4C18` casing with a white centre |
| Gravel cycleway | `#8B4513`, dash `[6, 3]` |
| Unpaved cycleway | `#8B4513`, dash `[1, 3, 2, 3]` |
| Cycle lane | `#AE2DE3` (purple), dash `[1, 3]` |
| Footpath | `#99BB2E`, dotted |
| Motorway | `#73BDED`, `#444` casing |
| Trunk | `#C0C8AE` |
| Primary | `#F7BDA7` |
| Secondary | `#FDD5A5` |
| Tertiary | `#FFF5D0` |
| Unclassified | white, `#444` casing |

The key also shows POI icons (bike shop, café, pub, campsite, toilets, water, parking, station…) as SVGs
under `cycle.travel/site_images/map_key/*.svg`. Those are cycle.travel's artwork: don't copy them. Use
Maki/Temaki (CC0) or draw our own.

## Palette

"Production" is the value WS2 should start from: the key value for key colours, the corrected inverse
for sampled ones. "Prototype draws" is what `style.ts` uses today.

| Name | Source | cycle.travel value | Prototype draws | Production |
|---|---|---|---|---|
| land (background, earth) | sampled | `#eef2e1` | `#f0f4e5` | `#edf2e1` |
| urban, below z11 | sampled | `#dde0d0` | `#e1e4d6` | `#dde0d0` |
| urban, z11–13 | sampled | `#e5e9d8` | `#e8ecdd` | `#e4e9d8` |
| urban, z13 up | sampled | `#e8e4e4` | `#ece7e7` | `#e9e4e4` |
| park | sampled | `#d8e7cf` | `#dbebd5` | `#d5e8cf` |
| wood | sampled | `#d2e3c6` | `#d5e7cd` | `#cfe4c6` |
| scrub, grass, pitches | sampled | `#e2ecd6` | `#e4efdb` | `#e0ecd6` |
| water | sampled | `#aecad0` | `#b1d2d6` | `#a8cbd0` |
| building | sampled | `#d9d2cf` | `#dfd7d5` | `#dad2cf` |
| railway | sampled | `#9a9a99` | `#a4a4a3` | `#9a9a99` |
| minor road casing | sampled | `#a3a3a3` | `#adadad` | `#a3a3a3` |
| major road casing, z10 | sampled | `#b8aea8` | `#c2b6b1` | `#baada8` |
| major road casing, z14 | sampled | `#7a7a7a` | `#858585` | `#7a7a7a` |
| minor road, z11 (white from z13) | sampled | `#b9b9b9` | `#c1c1c1` | `#b9b9b9` |
| motorway | key | `#73bded` | `#69c8f0` | `#73bded` |
| trunk | key | `#c0c8ae` | `#c6cfb7` | `#c0c8ae` |
| primary | key | `#f7bda7` | `#ffc2af` | `#f7bda7` |
| secondary | key | `#fdd5a5` | `#ffd8ae` | `#fdd5a5` |
| tertiary | key | `#fff5d0` | `#fff6d6` | `#fff5d0` |
| cycleway casing | key | `#dd4c18` | `#f14506` | `#dd4c18` |
| footpath | key | `#99bb2e` | `#9ec436` | `#99bb2e` |
| unpaved path | sampled | `#834a21` | `#964f22` | `#8b4513` (key gravel) |
| text | sampled | `#222222` | `#262626` | `#222222` |
| subtext | sampled | `#4a4a4a` | `#545454` | `#4a4a4a` |
| town label | sampled | `#242423` | `#282827` | `#242423` |
| village label | sampled | `#333333` | `#3a3a3a` | `#333333` |
| macrohood label | sampled | `#373836` | `#3f403e` | `#373836` |
| neighbourhood label | sampled | `#686966` | `#737471` | `#686966` |
| street label | sampled | `#343434` | `#3b3b3b` | `#343434` |
| river label | sampled | `#65707a` | `#6e7c85` | `#63717a` |
| road number | sampled | `#686766` | `#737271` | `#686766` |
| landmark label | sampled | `#bb806d` | `#cb8877` | `#c47c6c` |
| park label | sampled | `#3c6633` | `#39733b` | `#316734` |
| locality label | sampled | `#686867` | `#737372` | `#686867` |
| peak label | sampled | `#754634` | `#874c3a` | `#7b4333` |
| station dot and label | sampled | `#cd562d` | `#e1562e` | `#db4927` (probably the key's `#dd4c18`) |
| route dots | key | ncn `#ff0000`, rcn `#0000ff`, lcn `#008b8b` | same, with opacity | same |
| EuroVelo ring | by eye | – | `#00559d` | `#00559d` |

Unsampled Protomaps flavour slots (hospital, school, industrial, beach…) are set by eye in
`style.ts`'s `flavour` object.

## Land and land use

- Background and earth: land colour.
- Built-up land use (`residential`, `commercial`, `retail`, `railway`, `industrial`): one fill that steps
  with zoom, grey-green → paler green at z11 → pinkish grey at z13 (layer `ct_urban`).
- Grass-like land use (`recreation_ground`, `pitch`, `grass`, `meadow`, `village_green`, `garden`,
  `dog_park`, `playground`): scrub colour (`ct_greens`).
- Parks, woods, scrub: Protomaps' own `landuse_*` layers with cycle.travel's colours.
- Protomaps' `landcover` layer is dropped: cycle.travel has no low-zoom land cover.
- **Missing:** hillshade and contours. cycle.travel shades hills at every zoom we compared and draws
  contours from about z12. Plan WS1.

## Roads

| | Rule |
|---|---|
| Fill colour | By `kind_detail`: trunk, primary, secondary, tertiary from the key; everything else in the major layer gets tertiary |
| Major width | Exponential 1.6: z7 0.4, z9 1, z10 2.2/1.6/1, z12 3.2/2.6/2, z15 6/5/4, z18 16/14/12 (trunk+primary / secondary / tertiary) |
| Major casing | Width 0 at z9 → 0.5 at z9.5 → 0.8 at z12 → 1.2 at z16; colour `#b8aea8` at z10 → `#7a7a7a` at z14 |
| Minor width | Exponential 1.6: z10 0.3, z12 0.7, z13 1.3, z15 2.5, z18 11 |
| Minor colour | Grey (`#b9b9b9`) at z11 → white at z13, so the minor network reads as thin grey lines when zoomed out, as on cycle.travel |
| Minor casing | From z12.5 (0 → 0.6 at z13 → 1 at z16) |
| Motorway | Key blue with `#444` casing |

The dots of a cycle route sit on whatever road or path carries it: **the line between the dots is the
road or path underneath**, not part of the route style. So every road and path a route uses has to be
visible from the zoom its dots appear. That's why minor roads start at z10 here and why cycle paths need
their own layer (next section).

**Gaps:** cycle.travel shows more minor streets than we do at z11–13 (Protomaps thins them). Its
railways are bolder (grey with white dashes at street level); ours are faint. Its motorways are thin
and pale when zoomed out; ours are dark slate lines at z9.

## Cycle paths and footpaths

Protomaps' `roads` layer has no `surface` or `bicycle` tags, so it can't tell a paved cycleway from a
gravel one, or see that a pedestrian path is open to bikes. The cycling overlay's `paths` layer
(`pathClass` in [`CyclingProfile.java`](../../maps/tiles/src/main/java/cc/rideon/maps/CyclingProfile.java))
classifies every path itself. cycle.travel's rule, worked out against its Richmond Park tiles
(`analysis/ct-classify.py`):

| OSM | Class | Drawn as |
|---|---|---|
| `bridleway` with `bicycle=no` or `dismount` | `foot` | Footpath (green dots) |
| `bicycle=no`, `access=private` or `access=no` | – | Not a cycle path |
| `cycleway`, `bridleway`, or `path`/`footway`/`pedestrian`/`track` with `bicycle=yes`/`designated`/`permissive` | `p` or `u` | Cycle path |
| … with a paved `surface` (asphalt, paved, concrete*, paving_stones, sett, chipseal, metal, wood, bricks) | `p` | Red casing, white centre |
| … with any other `surface` | `u` | Brown dashes |
| … with no `surface`: `cycleway` and urban path types | `p` | Red and white |
| … with no `surface`: `bridleway`; `track` unless `tracktype=grade1` | `u` | Brown dashes |
| Any other `footway`, `path`, `steps` or `track`, except pavements and crossings (`footway=sidewalk`/`crossing`) and `access=private`/`no` | `foot` | Footpath (green dots) |

Tunnels and `area=yes` are skipped. Lines with the same class are merged end to end in each tile so
dashes don't restart at every OSM way join. A way is in exactly one class, so the brown dashes no longer
need a knockout over a basemap footpath, which the prototype used to draw as a pale strip in parks.

| Layer | Rule |
|---|---|
| `ct_cycleways_casing` | `p`, from z12, round caps and joins, exponential 1.5 width: z12 2.2, z15 4.5, z18 10 |
| `ct_cycleways` | `p`, white, z12 0.9, z15 2.2, z18 6 |
| `ct_unpaved` | `u`, from z12, dash `[5.5, 2.5]`, width z12 0.95, z15 1.1, z18 2. Measured: ~1 px wide, ~5 px dashes every ~8 px at ct z13–15 |
| `ct_footpaths` | `foot`, from z14, dash `[1.7, 4.4]`, width z14 1.2, z18 2.4. Measured: ~1.2 px wide, 2 px dashes every 7.3 px at ct z15 |

**Gaps:**
- **Cycle lanes** (purple, `cycleway=lane`/`cycleway:left|right|both=lane` on roads) aren't drawn yet.
  The overlay has them (`cycle_lanes`); WS2 styles them.
- cycle.travel shows paths from ct z12 (our 11) in London as thin red lines; ours start at z12.
- cycle.travel also outlines some pedestrian areas and cycle-permitted squares in red at street level.

## Cycle routes (dots)

Source: OSM route relations with `route=bicycle`, by `network` (`icn`, `ncn`, `rcn`, `lcn`). Each way
takes the highest network of any relation it's in, and the lowest visibility zoom (the overlay's
`routes` layer). Ways with the same network and zoom are merged into long lines in each tile, because
MapLibre restarts a dash pattern at the start of every feature, which bunches dots at joins.

**When each network appears** (`minz` on the feature, `['>=', ['zoom'], ['get', 'minz']]` in the style):

| Network | From |
|---|---|
| `icn`, `ncn` | z6 |
| `rcn` outside London | z8.5 |
| London `rcn` (`cycle_network` starts `GB:London`) with a `ref` (C, Q, CS numbers) | z11 |
| London `rcn` without a `ref` | z13 |
| `lcn` | z13 |

**Dots:** one `ct_routes` line layer, round caps and joins, `line-sort-key` by rank (lcn 1 < rcn 2 <
ncn 3 < icn 4).

| | Value |
|---|---|
| Colour | ncn and icn red, rcn blue, lcn teal (key) |
| Opacity | 0.62; rcn 0.45 below z11 |
| Width (= dot diameter) | Exponential 1.5: z6 3.5, z8 5, z10 6.5, z12 7, z14 7, z18 8.5. Measured: dots stay ~6.5–7.5 px across from ct z11 up |
| Dash array | `[0, 2.3]` below z11, `[0, 2.6]` z11–13, `[0, 2.9]` from z13, so dot centres are 15–20 px apart and the gap opens as you zoom in |

A zero-length dash with round caps draws a dot; the gap is in multiples of the line width.

**EuroVelo:** `ct_routes_eurovelo_ring` under the dots for `icn` ways: `#00559d` at 0.85 opacity, widths
×1.4, gaps ÷1.4, so each red dot sits in a navy ring.

**Gaps:**
- **London is too busy.** cycle.travel shows London's regional network as a few thin lavender dotted
  lines (C57, C34, C30…) and hides most of it until street level. We draw saturated blue dots across
  whole boroughs (Roehampton, Southfields, Westminster) and blue clusters in central London even at z9.
  Work out cycle.travel's rule (likely signed or `state`-tagged routes only, drawn as thin dashes rather
  than dots) before tuning opacity.
- Our lcn teal is heavier than cycle.travel's.
- Where NCN 4 and the Avenue Verte (EV) overlap along the Albert Embankment, we draw heavy dark red
  stacked dots; cycle.travel draws one clean red line.
- Some relations are incomplete in OSM (part of NCN 4's western spur in Richmond Park is missing): not
  a style bug.

## Repeater badges

Route numbers repeated along the line, upright, from z11. Source: the overlay's `route_badges`, one
merged line per badge, because the routes layer merges relations per way and loses which number to
repeat. Only short signed refs (`^[A-Z]{0,2}\d{0,3}$`, not empty, not a bare `C`) get badges.

| Badge | Networks | Look |
|---|---|---|
| Red | `ncn`, and non-EuroVelo `icn` (e.g. Avenue Verte, "AV") from z12 | Flat `#e96768`, corner radius 0.6 × DPR |
| Blue | `rcn` (London C, Q, CS) | `#2fa5cf` with a 1 px rim: inner `#37b3dd`, top edge `#7acce3`, bottom edge `#29a4cb` |
| EuroVelo | `icn` with an `EV` ref, z11–12 only | `#0061a2` square, twelve `#f9ee59` stars in a ring, number in the middle |

| Property | Value |
|---|---|
| Placement | `symbol-placement: line`, `symbol-spacing` 160 (EuroVelo 220), `text-max-angle` 180 |
| Orientation | Text and icon `rotation-alignment` and `pitch-alignment` viewport; `text-keep-upright` false |
| Text | Montserrat Bold 8.5 (EuroVelo 7.5), letter spacing 0.04, white |
| Box | `icon-text-fit: both`, padding `[1, 4.5, 0.5, 4.5]`; the image is 8 × DPR square, stretchable in `[2, 6] × DPR` both ways. Gives ~11.5 px tall and 15/20/25 px wide for 1/2/3 characters, as measured |
| Padding | Text and icon padding 2 |
| Priority | Layer order rcn < ncn < non-EV icn < EuroVelo (later wins). **No `symbol-sort-key`**: with line placement it sometimes drops the box and draws the number alone |

The prototype draws the badge images at runtime (`styleimagemissing` in `index.html`). Native needs a
sprite sheet or `mapView(_:didFailToLoadImage:)` (WS2).

## Typography

cycle.travel's tiles look like Montserrat for place names and Open Sans for small labels. **Dan chose
Montserrat throughout**, so every label here is Montserrat (SIL OFL 1.1, glyph PBFs in the app's
`RoutesUI/CycleMap/glyphs/`). Weights in use: Regular, Medium, SemiBold, Bold, Italic, Medium Italic.

The map is the only place Montserrat appears in the app. DESIGN-SYSTEM.md §4 says "SF Pro, system text
styles only", so it needs a map exception (plan WS4). Map labels don't follow Dynamic Type; MapLibre has
no equivalent.

## Labels

**Places** (Protomaps `places_locality`):

| | Rule |
|---|---|
| Font | Capital (`population_rank` ≥ 10): Medium, black. Town or city: Bold, `#242423`. Village: Medium, `#333333` |
| Size | z6: capital 13, else 10. z10: capital 17, `min_zoom` ≤ 9 14, else 12. z14: capital 16, else 15 |
| Case | Mixed case below z12; from z12 towns and cities in capitals |
| Letter spacing | 0 below z12; towns 0.08 from z12; the capital 0.55 from z14 ("L O N D O N") |
| Halo | White, width 2, blur 0.5 |
| Collision | `text-padding` 3 (Protomaps' wider padding knocks out neighbours and badges) |
| Exclusions | OSM `place=locality` moves to its own layer (below); "City of Westminster" is dropped because cycle.travel only shows the Westminster neighbourhood |

**Neighbourhoods** (`places_subplace`): Medium, mixed case, no letter spacing, size 11 at z11 → 14 at z16,
`#373836` for macrohoods and `#686966` for the rest, halo 1.5, padding 3.

**Streets** (`roads_labels_*`): from z14 only, Regular 12, `#343434`, halo 1.5. "Street" → "St" and
"Road" → "Rd" at the end of the name; Lane, Way, Place, Hill… stay whole (`abbreviate` in
`style.ts`).

**Road numbers** (`ct_road_refs`): A/B roads (motorway, trunk, primary, secondary with a `ref`) from
z10, Italic 9 → 10.5 at z14, `#686766`, along the line every 350 px, padding 20.

**Water:** rivers from z12, Italic, letter spacing 0.25, `#65707a`, no halo. Lakes the same font and
colour.

**Points** (all from z14, white halo 1.5, max width 7 ems, line height 1.1, padding 4). Later layers win
collisions:

| Layer | What | Font | Colour |
|---|---|---|---|
| `ct_landmarks` | Protomaps POIs `attraction`, `museum`, `castle`, `palace`, `zoo`, `aquarium`, `theme_park` with no `kind_detail` (that excludes churches, whose `kind_detail` is the religion; cycle.travel leaves them unnamed) | SemiBold 11 | `#bb806d` |
| `ct_localities` | OSM `place=locality` (park gates, river reaches) | Medium 11 | `#686867` |
| `ct_parks` | `park`, `garden`, `nature_reserve`, `wood`, `forest`, `golf_course` | Medium Italic 11.5 | `#3c6633` |

POI labels only show where Protomaps' `min_zoom` ≤ zoom − 1: cycle.travel names far fewer than Protomaps
carries, roughly one zoom later.

**Gaps:** we still name a few landmarks cycle.travel doesn't (Horse Guards, 10 Downing Street,
Cleopatra's Needle, Victoria Memorial). We label farms and hamlets in the Surrey Hills that it omits.
cycle.travel draws POI icons (cafés, pubs, toilets, bike parking, bike shops, campsites, water, parking,
viewpoints, zoo animals at WWT Barnes); we draw none.

## Stations and peaks

From the overlay's `pois` layer (`kind` `station` or `peak`), because Protomaps thins both out below
tile z14.

- **Stations:** `railway=station` with a name, excluding `station` = subway, light_rail, miniature,
  monorail, funicular, tram, plus heritage (`usage=tourism`, `railway:preserved`) and disused.
  `ct_stations`: circle from z12, `#cd562d`, radius 2.2 (z10) → 2.6 (z14), black stroke 0.9.
  `ct_stations_label` from z14: SemiBold 11, same colour, `text-variable-anchor` top, bottom,
  bottom-right, bottom-left, top-right, top-left with radial offset 0.6 (so Charing Cross slides beside
  LONDON).
  **Gap:** cycle.travel shows a handful of station dots at ct z11–12 with no rule we could find; ours
  start at z12 with every station.
- **Peaks:** `natural=peak` or `hill` with a name. `ct_peaks` from z12, Medium Italic 11, `#754634`.

## Layer order

Bottom to top, as `style.ts` splices them into Protomaps' `light` layers:

1. Protomaps background, earth, water, land use… with `ct_urban` and `ct_greens` inserted just before
   `landuse_park`.
2. Protomaps roads, with `ct_footpaths`, `ct_unpaved`, `ct_cycleways_casing`, `ct_cycleways` just
   before `roads_rail`.
3. `ct_routes_eurovelo_ring`, `ct_routes`, `ct_stations` just before `roads_labels_minor`, so route dots
   sit above every line and below every label.
4. `ct_road_refs` just after `roads_labels_major`.
5. `ct_landmarks`, `ct_localities`, `ct_parks`, `ct_peaks`, `ct_stations_label`, then the four badge
   layers, just before `places_subplace`.
6. Protomaps place labels on top.

## Protomaps changes

The basemap is `@protomaps/basemaps` 5.7.2's `layers('basemap', flavour, { lang: 'en' })` with the
`light` flavour recoloured. Changes on top:

- **Dropped layers:** `pois` (replaced by the `ct_*` point labels), `roads_shields`, `roads_oneway`,
  `address_label`, `landcover`.
- **No sprite:** every `icon-*` layout property is removed, so the style needs no sprite until WS2 adds
  badges and POI icons.
- `roads_other` is limited to `kind=other` (no piers): the `ct_*` path layers draw paths.
- Font names in the flavour are `Montserrat-Regular` / `Montserrat-SemiBold` / `Montserrat-Italic`.
- The basemap is z0–15; MapLibre overzooms it past 15.
- Protomaps ships hills only from tile z14 and stations thinned out below z14, hence our own POI layer.
- Protomaps has no `surface`, `bicycle`, `cycleway=*` or route relation data, hence our own path and
  route layers.

## Fonts in the style

Glyph PBFs, in the app and the prototype alike (WS2.3). MapLibre Native supports `font-faces` from 6.18.0
but **can't omit `glyphs`** (maplibre-native#165), so the prototype's woff2 `font-faces` went.
`maps/style/scripts/glyphs.sh` builds one directory per face, named after the TTF (`Montserrat-Medium`),
and every `text-font` stack is one of those names. Ranges: Latin, Latin-1, Latin Extended-A and -B,
Latin Extended Additional (Welsh), punctuation and letterlike symbols. A label with a character outside
them is dropped. The tests check every stack has its glyphs and every glyph directory is used.

## Known gaps

From the six comparisons in `screenshots/`. Tick them off in WS2.

- [ ] Hillshade and contours (needs a DEM, WS1)
- [ ] POI icons: café, pub, toilets, water, bike parking, bike shop, campsite, parking, viewpoint (WS1 data, WS2 icons)
- [ ] Purple cycle lanes on roads (WS1 data)
- [ ] London rcn: far fewer lines, thinner and lavender; work out cycle.travel's rule
- [ ] lcn dots lighter
- [ ] NCN + EuroVelo overlap drawn as one line, not stacked dots
- [ ] Paths from z11 in London (thin red)
- [ ] More minor streets at z11–13
- [ ] Bolder railways; paler, thinner motorways when zoomed out
- [ ] Brown unpaved dashes slightly lighter
- [ ] Landmark selection: drop the extras
- [ ] No farm or hamlet labels in rural areas at z12
- [ ] Station subset at z10–11
- [ ] Knockout shade inside parks
- [ ] Pedestrian areas outlined in red at street level
- [ ] Colours: stop running key values through `shot()`; fix the curve (above)
- [ ] Re-check every size at 3× on an iPhone (all tuning was at 2× in Chrome)
