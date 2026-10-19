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

**Only on the same display, though.** The transform depends on the display the tab's window is on, and
`shot()` was fitted on a P3 one (`matchMedia('(color-gamut: p3)').matches` is true). A tab on an sRGB
display captures greys about 11/255 darker (`#ababab` → `#a1a1a1`, `#9a9a9a` → `#8f8f8f`) and shifts
colours too (`#c0c8ae` → `#b9c1a4`, `#f3ca94` → `#f2c482`). In WS2.5 (batch D) the prototype's tab sat
on the other display from cycle.travel's for an afternoon, so ours looked darker than it was. Before
comparing, check `color-gamut: p3` gives the same answer in both tabs, or capture both in one tab;
only sample new colours where it's true, or `shot()` won't undo them.

So, since WS2.2:

- **Map-key colours are drawn as they are.** The key's values (`#73bded`, `#dd4c18`…) are what
  cycle.travel draws, not screenshot samples. Our cycleway now captures as `#cd562d`, the same as theirs.
- **Screenshot samples go through `shot()`** (`maps/style/src/shot.ts`), which undoes the capture: sRGB
  decode → a fitted 3×3 matrix → sRGB encode. It round-trips the four swatches above to within 2/255,
  except the cycleway's blue channel (gamut clipping); `maps/style/test/shot.test.ts` checks that. It
  turns the sampled unpaved brown `#834a21` into `#8b451e`, next to the key's gravel `#8b4513`.

The fit before WS2.2 used a 1/1.96 power instead of the sRGB curves, which lightened greys
(`#808080` → `#8b8b8b`), and it ran key colours through `shot()` too (our cycleway drew `#f14506`).
The WS1.2 screenshots were taken with that.

Check a colour you change against a new screenshot, not the model: draw ours, screenshot both pages at
the same view, and compare the pixels where both draw that feature.

Route dot sizes and spacings and the EuroVelo badge were tuned by eye against screenshots and never went
through `shot()`. The red and blue badges are `shot()` of cycle.travel's, then checked against a new
screenshot (WS2.4, [repeater badges](#repeater-badges)).

**`shot()` drifts between sessions.** In the WS2.5 lines session the same Chrome captured 3–12/255
darker than `shot()` predicts, so a colour fitted with it drew visibly off. The EuroVelo dot's colours
were solved instead against swatches captured alongside the comparison shots: draw a grid of candidate
colours on our page, screenshot it in the same session as cycle.travel, and pick the candidate that
captures as cycle.travel does. They land within 1/255. Do that for any colour that has to match closely,
and refit `shot()` before relying on it again.

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

"cycle.travel value" is the key's value for key colours and what its pixels capture as for sampled
ones. "Draws" is what `style.ts` draws: the key value as it is, or `shot()` of the sample.

| Name | Source | cycle.travel value | Draws |
|---|---|---|---|
| land (background, earth) | sampled | `#eef2e1` | `#edf2e1` |
| urban, below z11 | sampled | `#dde0d0` | `#dde0d0` |
| urban, z11–13 | sampled | `#e5e9d8` | `#e4e9d8` |
| urban, z13 up | sampled | `#e8e4e4` | `#e9e4e4` |
| park (re-sampled in WS2.5) | sampled | `#eaf2d9` | `#e9f2d9` |
| wood (WS2.5) | sampled | `#d5e4c9` | `#d2e5c9` |
| golf course (WS2.5) | sampled | `#e2efd7` | `#e0efd7` |
| cemetery (WS2.5) | sampled | `#d7ded3` | `#d6ded3` |
| pitch (WS2.5) | sampled | `#deedd3` | `#dbeed3` |
| pedestrian area (WS2.5) | sampled | `#fcfbf5` | `#fcfbf5` |
| water | sampled | `#b3c9cf` (re-sampled in WS2.2) | `#aecacf` |
| building edge (WS2.5; the fill is urban) | sampled | `#d2cbc8` | `#d3cbc8` |
| military edge (WS2.5) | sampled | `#e44c43` | `#f4373e` |
| military band (WS2.5) | solved | `#ebc5b6` over land | `#f01914` at 22% |
| railway (white dashed core, `ct_rail_core`) | sampled | `#9a9a99` | `#9a9a99` |
| railway and tertiary road, z9 (WS2.5) | sampled | `#ababab` | `#ababab` |
| primary, z9 (WS2.5) | sampled | `#f1d0c0` | `#f7cebf` |
| secondary, z9 (WS2.5) | sampled | `#f3ca94` | `#fac793` |
| unclassified lane and tertiary road, z10 (WS2.5) | sampled | `#9a9a9a` | `#9a9a9a` |
| lane and tertiary casing (WS2.5) | key | `#444444` | `#444444` |
| minor road casing | sampled | `#a3a3a3` | `#a3a3a3` |
| major road casing, z9–10 | sampled | `#b8aea8` | `#baada8` |
| major road casing, z11 (WS2.5, rural; solved on an sRGB display) | solved from ours | `#37`–`#4f` grey device pixel | `#2e2e2e` |
| major road casing, z12 up (WS2.5) | sampled | `#060606` | `#060606` |
| minor road, z10–11 | sampled | `#b9b9b9` | `#b9b9b9` |
| residential street, z12 (WS2.5) | as lanes at z10 | `#8f8f8e` on an sRGB display, as our `#9a9a9a` | `#9a9a9a` |
| residential street, z13 (WS2.5; white from z14) | solved from ours | `#a0a0a0` on an sRGB display | `#a9a9a9` |
| motorway (WS2.5: the map draws far paler than the key) | sampled, then matched in a same-session capture | `#bad1e3` | `#bed9e7` |
| trunk (WS2.5: the map draws far paler than the key, at every zoom) | solved from ours | `#d3d8c5` on an sRGB display, where the key's `#c0c8ae` captures `#b9c1a4` | `#d9decd` |
| primary | key | `#f7bda7` | `#f7bda7` |
| secondary | key | `#fdd5a5` | `#fdd5a5` |
| tertiary | key | `#fff5d0` | `#fff5d0` |
| cycleway casing | key | `#dd4c18` | `#dd4c18` |
| footpath | key | `#99bb2e` | `#99bb2e` |
| unpaved path | key (gravel) | `#8b4513`; samples `#834a21` | `#8b4513` |
| text | sampled | `#222222` | `#222222` |
| subtext | sampled | `#4a4a4a` | `#4a4a4a` |
| town label | sampled | `#242423` | `#242423` |
| village label | sampled | `#333333` | `#333333` |
| macrohood label | sampled | `#373836` | `#373836` |
| neighbourhood label | sampled | `#686966` | `#686966` |
| street label | sampled | `#343434` | `#343434` |
| river label | sampled | `#65707a` | `#63717a` |
| road number | sampled | `#686766` | `#686766` |
| landmark label | sampled | `#bb806d` | `#c47c6c` |
| park label | sampled | `#3c6633` | `#316734` |
| locality label | sampled | `#686867` | `#686867` |
| peak label | sampled | `#754634` | `#7b4333` |
| station dot and label | key (cycleway) | `#dd4c18`: its dot captures exactly as the key's swatch | `#dd4c18` |
| route dots | key | ncn `#ff0000`, rcn `#0000ff`, lcn `#008b8b` | same, with opacity |
| EuroVelo ring (WS2.5) | solved against swatches | slate at z9, lavender from z10 | `#6a808c` (z9), `#8295c1` (z10 up), opaque |
| EuroVelo centre, z9 / z10 / z11 / z12 up (WS2.5) | solved against swatches | red, paling as you zoom in | `#f76b68` / `#f7837f` / `#fb8d8e` / `#f59691`, opaque |

The military band is solved rather than sampled: the page blends drawn colours, so the band's red is
worked out from `shot()` of its capture and of the land under it, and drawn as it is. The EuroVelo dots
are solved against same-session swatches (above).

Unsampled Protomaps flavour slots (beach, aerodrome, pier…) are set by eye in `style.ts`'s `flavour`
object.

## Land and land use

- Background and earth: land colour.
- Built-up land use (`residential`, `commercial`, `retail`, `railway`, `industrial`): one fill that steps
  with zoom, grey-green → paler green at z11 → pinkish grey at z13 (layer `ct_urban`).
- Buildings: the same built-up fill, opaque, with a faint `#d3cbc8` edge, so blocks read as one. (The
  `#e3e2d9` fill that used to cover 16% of our Westminster view was Protomaps' half-opaque buildings over
  land.)
- Grass-like land use (`recreation_ground`, `grass`, `meadow`, `village_green`, `garden`, `dog_park`,
  `playground`, `allotments`): land colour over the built-up fill (`ct_greens`). cycle.travel shows them
  as bare land, even inside residential areas.
- Pitches: their own green (`ct_pitches`), above parks so they show inside them.
- Parks, woods, golf courses, cemeteries, nature reserves: Protomaps' `landuse_park` layer, filtered to
  those kinds, with cycle.travel's colours. Scrub, grass and grassland aren't filled.
- Pedestrian areas: cream.
- Military land (`military`, `naval_base`, `airfield`) from z13: not filled, but a 1px red edge with a
  7px pale red band just inside (`ct_military_band`, `ct_military`). The band is a line with a positive
  `line-offset`, which falls inside polygons because vector tiles wind outer rings clockwise; its joins
  are mitred, since round joins overlap at every vertex and show darker.
- Schools, hospitals and industrial land have no fill of their own: Protomaps' `landuse_school`,
  `landuse_hospital`, `landuse_industrial` and `landuse_urban_green` layers are dropped.
- Protomaps' `landcover` layer is dropped: cycle.travel has no low-zoom land cover.
- **Missing:** hillshade and contours. cycle.travel shades hills at every zoom we compared and draws
  contours from about z12. Plan WS1.

## Roads

| | Rule |
|---|---|
| Fill colour | By `kind_detail`: primary, secondary, tertiary from the key, trunk far paler (`#d9decd`); everything else in the major layer gets tertiary. At z9 cycle.travel draws A roads paler and B roads deeper than its key, and tertiary roads as grey lines (`#ababab`, then `#9a9a9a` at z10); they take the key's cream from z11 |
| Major width | Exponential 1.6, `majorStops` [A/B, tertiary]: z7 0.4, z9 1/0.9, z10 2.5/0.9, z11 2.6/2.3, z12 3.9/2.9, z13 4/3.75, z16 4/4, z18 9/8. cycle.travel draws trunk, A and B roads at one width, a constant 4 px from its z13 to z17 (our 12–16), with tertiary roads closing in on it |
| Major casing | A/B: a 0.5 px hairline from z9.5 (1 px from z18), faint `#b8aea8` until z10, dark grey `#2e2e2e` at z11, near-black `#060606` from z12 (cycle.travel's casings are mid-grey at its z11, dark grey at z12, black from z13; its low-zoom London tiles keep mid-grey ones at z12). Tertiary: the lanes' `#444444` casing, from z10 |
| Minor width | Exponential 1.6, `minorStops` [unclassified lane, street]: z10 0.9/0.3, z11 2.3/0.45, z12 2.9/1.1, z13 3.75/1.15, z15 5/2.5, z18 12/11. None at z9: cycle.travel's z10 shows only tertiary roads |
| Minor colour | Lanes: grey `#9a9a9a` at z10, white from z11, as cycle.travel's key draws them. Streets: a solid grey line, light `#b9b9b9` until z11, dark `#9a9a9a` at z12, `#a9a9a9` at z13, white from z14, as cycle.travel's z12–15 |
| Minor casing | Lanes: `#444444`, 0.5 px from z11 → 0.6 at z13 → 1 at z16. Streets: from z13 (0 → 0.73 at z14 → 1 at z16), `#a3a3a3` |
| Low zooms | The basemap tiles carry minor roads from z12 and railways from z11, so the overlay's `low_roads` fills in below (`ct_low_minor`, `ct_low_minor_casing` z10–11; `ct_low_rail`, `ct_low_rail_core` z8–10), painted the same way |
| Motorway | Pale blue (`#bed9e7`: far paler than the key's swatch). Exponential 1.6: z6 0.6, z9 1.6, z11 3, z12 4.8, z15 7, z18 15 |
| Motorway casing | Width 0 at z7 → 0.5 at z9 → 0.6 from z11; colour faint grey `#9aa0a4` at z9 → black at z11 → `#151719` from z12 |
| Railway | `kind=rail` only, and not tunnels (`is_tunnel`), so most of the Underground isn't drawn, as on cycle.travel. Solid grey (Protomaps draws faint dashes): `#ababab` at z9, `#9a9a99` from z10; exponential 1.6, z6 0.4, z9 2.5, z10 2.9, z12 3.5, z14 3.5, z18 8. Sidings, yards, crossovers and spurs (any `service`) are half as wide |
| Railway core (`ct_rail_core`) | White dashes along the middle of main lines (no `service`) from z9: width z9 1, z12 2.25, z14 2.25, z18 6; dash `[5.5, 5.5]` below z11, `[4, 4]` from z11 |

The dots of a cycle route sit on whatever road or path carries it: **the line between the dots is the
road or path underneath**, not part of the route style. So every road and path a route uses has to be
visible from the zoom its dots appear. That's why lanes start at z10 here and why cycle paths need
their own layer (next section).

**Gaps:**
- cycle.travel shows more minor streets than we do at z11–13 (Protomaps thins them).
- Station throats (Waterloo, Victoria) read heavier than cycle.travel's at z14: every platform track is
  drawn, half-width but still dense. Not addressed in WS2.5.
- cycle.travel's hillshade greys its low zooms (the Downs at z9) where ours is flat land colour, so its
  map reads darker even where the roads match. Hillshade is WS1.4.

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
| … with no `surface` but a `tracktype`: `grade1` | `p` | Red and white |
| … with no `surface` but a `tracktype`: any other grade | `u` | Brown dashes |
| … with neither: `cycleway`, `pedestrian`, and `path`/`footway` with `bicycle=yes`/`designated` | `p` | Red and white |
| … with neither: `bridleway`, `track`, and `path`/`footway` with `bicycle=permissive` | `u` | Brown dashes. Measured over Colchester at ct z13: 97–100% of untagged permissive paths draw brown, in woods, fields, parks and towns alike; untagged `bicycle=yes` ones mostly red |
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

**Cycle lanes** (WS1.3): the overlay's `cycle_lanes`, painted lanes and shared bus lanes on roads
(`cycleway`, `cycleway:left|right|both` = `lane` or `share_busway`).

| Layer | Rule |
|---|---|
| `ct_cycle_lanes` | From z14, `#AE2DE3`, width 2, dash `[0, 3]`, round caps: 2 px dots every 6 px at every zoom. Measured at ct z15–17 (Hills Rd, Bateman St, Kennington Park Rd); none at ct z14. One row along the middle of the road whichever side the lane is, bus lanes included, under the route dots |

**Gaps:**
- cycle.travel shows paths from ct z12 (our 11) in London as thin red lines; ours start at z12.
- cycle.travel also outlines some pedestrian areas and cycle-permitted squares in red at street level.

## Cycle routes (dots)

Source: OSM route relations with `route=bicycle`, by `network` (`icn`, `ncn`, `rcn`, `lcn`). Each way
takes the highest network of any relation it's in, and the lowest visibility zoom (the overlay's
`routes` layer), so dots of two networks never share a line. Only EuroVelo counts as `icn` (a `ref`
starting `EV` or `cycle_network=EuroVelo`): other international routes, like the Avenue Verte, rank and
dot as `ncn`, as on cycle.travel. Ways with the same network and zoom are merged into long lines in each
tile, because symbol placement restarts at the start of every feature, which bunches dots at joins.

**When each network appears** (`minz` on the feature, `['>=', ['zoom'], ['get', 'minz']]` in the style):

| Network | From |
|---|---|
| `icn`, `ncn` | z6 |
| `rcn` outside London | z10 (cycle.travel's z11) |
| London `rcn` (`cycle_network` starts `GB:London`) with a `ref` (C, Q, CS numbers) | z11 |
| London `rcn` without a `ref` | z13 |
| `lcn` | z13 |

Ferry crossings are left out, as on cycle.travel: EuroVelo 2 would otherwise dot its way across the
North Sea from Harwich.

**Dots are icons, not dashes** (`maps/style/src/dots.ts`). MapLibre draws a dotted line as round-capped
zero-length dashes, and slices or bends every dot that straddles a vertex of the line, which many do at
z9–11; and a two-layer EuroVelo dot (ring plus centre) can't keep its centre on its ring. So each network
is one `symbol` layer that places a dot image along the route:

- `symbol-placement: line`, `icon-allow-overlap` and `icon-ignore-placement`, rotation and pitch
  alignment `viewport` (a round dot looks the same either way).
- One image per zoom from the network's first zoom to z18, drawn at that zoom's size and colours and
  rounded to a quarter pixel (zooms that round the same share an image, named `route-<network>-<zoom>`).
  `icon-image` and `symbol-spacing` are `step` expressions on the zoom.
- The images are in the sprite (`src/sprite.ts`), like the badges.

Layers, bottom to top: `ct_routes_lcn`, `ct_routes_rcn`, `ct_routes` (ncn), `ct_routes_eurovelo`.

| Network | Dot | Diameter (exponential 1.5) | Centre to centre | Opacity |
|---|---|---|---|---|
| `ncn` | Red `#ff0000` (key) | z6 3.5, z8 4.5, z9 5, z10 6.5, z12 7, z14 7, z18 8.5 | 2.3 diameters below z11, 2.9 from z11 (11.5 px at z9, ~20 px from z11) | 0.59 below z10, 0.55 at z10, 0.5 from z11 |
| `rcn` | Blue `#0000ff` (key) | As ncn, but z10 5 | As ncn | 0.26 below z11, 0.33 from z11 |
| `lcn` | Teal `#008b8b` (key) | z13 4.75, z18 6 | 2.1 diameters | 0.53 |
| `icn` (EuroVelo) | Opaque ring with an opaque red centre: ring `#6a808c` at z9, `#8295c1` from z10; centre 58% of the dot at z9, half from z10, `#f76b68` / `#f7837f` / `#fb8d8e` / `#f59691` at z9 / z10 / z11 / z12 up | z6 3.5, z8 4.5, z9 6, z10 8, z14 8, z18 9 | 10 px at z9, 17 px at z10, 19.5 px from z11 | 1 |

National and regional dots are translucent on cycle.travel, so the road underneath shows through; the
EuroVelo ones aren't. Every size, spacing and opacity was measured against cycle.travel's screenshots at
our z9–14 (its z10–15).

**Trade-offs of symbol dots:**
- Layout properties take the tile's integer zoom, and symbols keep their screen size while the map
  scales. Between integer zooms the dots stay the same size but spread apart, up to 2× just before the
  next zoom's tiles load.
- Placement starts again in each tile, so the dot rhythm jumps at tile edges.
- Dots fade in as new tiles load, like labels, instead of appearing with the line.

**Gaps:**
- **London is too busy.** cycle.travel shows London's regional network as a few thin lavender dotted
  lines (C57, C34, C30…) and hides most of it until street level. We draw saturated blue dots across
  whole boroughs (Roehampton, Southfields, Westminster) and blue clusters in central London even at z9.
  Work out cycle.travel's rule (likely signed or `state`-tagged routes only, drawn as thin dashes rather
  than dots) before tuning opacity. At street level (our z13–14) its London regional dots are also
  smaller and closer together than elsewhere.
- Some relations are incomplete in OSM (part of NCN 4's western spur in Richmond Park is missing): not
  a style bug.

## Repeater badges

Route numbers repeated along the line, upright, from z11. Source: the overlay's `route_badges`, one
merged line per badge, because the routes layer merges relations per way and loses which number to
repeat. Only short signed refs (`^[A-Z]{0,2}\d{0,3}$`, not empty, not a bare `C`) get badges.

| Badge | Networks | Look |
|---|---|---|
| Red | `ncn`, and non-EuroVelo `icn` (e.g. Avenue Verte, "AV") from z12 | Flat `#e65a5d`, corner radius 0.6 |
| Blue | `rcn` (London C, Q, CS) | `#26abe1` inside a 1 px border of two half-pixel rings: outer `#1c9cc7`, inner `#24a6d2`; along the top `#6fc4db` then `#38abce` |
| EuroVelo | `icn` with an `EV` ref, z11–12 only | `#0061a2` square, twelve `#f9ee59` stars in a ring, number in the middle |

| Property | Value |
|---|---|
| Placement | `symbol-placement: line`, `symbol-spacing` 160 (EuroVelo 220), `text-max-angle` 180 |
| Orientation | Text and icon `rotation-alignment` and `pitch-alignment` viewport; `text-keep-upright` false |
| Text | Montserrat Bold 8.5 (EuroVelo 7.5), letter spacing 0.04, white |
| Box | `icon-text-fit: both`, padding `[1, 4.5, 0.5, 4.5]`; the image is 8 × DPR square, stretchable in `[2, 6] × DPR` both ways. Gives ~11.5 px tall and 15/20/25 px wide for 1/2/3 characters, as measured |
| Padding | Text and icon padding 2 |
| Priority | Layer order rcn < ncn < non-EV icn < EuroVelo (later wins). **No `symbol-sort-key`**: with line placement it sometimes drops the box and draws the number alone |

The images are in the sprite (`maps/style/src/sprite.ts`, WS2.4), which the app and the prototype both
load. Red and blue started as `shot()` of cycle.travel's badges at Putney z13, then the blue fill was
nudged after a new screenshot. They capture as:

| Badge | cycle.travel | Ours |
|---|---|---|
| Red fill | `#d76560`–`#da655e` | `#d66361` |
| Blue fill | `#52a8dc` | `#54a9dc` |
| Blue border, left and bottom (out → in) | `#4799c7`, `#4ea3d2` | `#4b9bc3`, `#4e9fc8` |
| Blue border, top (out → in) | `#81c1db`, `#58a8ce` | `#84c2d8`, `#58a9d1` |

Close-up, cycle.travel left of each pair: [`screenshots/badges-putney-z13.png`](screenshots/badges-putney-z13.png).
Before WS2.4 the prototype drew them at runtime (`#e96768` red; blue `#37b3dd` inside a `#2fa5cf` rim),
which captured lighter: red `#d96f6c`, blue `#5eb1d9`.

## Typography

cycle.travel's tiles look like Montserrat for place names and Open Sans for small labels. **Dan chose
Montserrat throughout**, so every label here is Montserrat (SIL OFL 1.1, glyph PBFs in the app's
`SharedUI/CycleMap/glyphs/`). Weights in use: Regular, Medium, SemiBold, Bold, Italic, Medium Italic.

The map is the only place Montserrat appears in the app. DESIGN-SYSTEM.md §4 says "SF Pro, system text
styles only", so it needs a map exception (plan WS4). Map labels don't follow Dynamic Type; MapLibre has
no equivalent.

## Labels

**Places** (Protomaps `places_locality`):

| | Rule |
|---|---|
| Font | Capital (`population_rank` ≥ 10, so London and Greenwich): Medium, black. Town or city: Bold, `#242423`. Village: Medium, `#333333`. Below z12 a town of under 16,000 people (Protomaps' `population`; 10,000 is its placeholder for unknown) is drawn as a village, as cycle.travel does below its z13: Teddington, Sydenham, Barking, Sidcup, Orpington, Clacton-on-Sea. Dorking (17,098) and Harwich (17,840) stay bold |
| Size | z6: capital 13, else 10. z10: capital 17; towns of 100,000 or more 16.5; major towns (`min_zoom` ≤ 9 and 16,000 or more) 14; towns under 5,000 10; other towns 12; villages 10. z11: capital 16.75, 100,000+ 16.5, major 14.25, under 5,000 10, other towns 12.75, villages 10. z14: capital 16, else 15. Measured at 3× on the phone captures (WS2.6): villages about 12 at z12 (Ramsey, Great Oakley, Westhumble, Pixham); big towns 0.94–1.05× cycle.travel's width (Croydon, Ilford, Ealing, Wembley, Ipswich, Colchester); small towns within 3% (Teddington, Sydenham, Sidcup, Brightlingsea, Manningtree) |
| Case | Mixed case below z12; from z12 towns and cities in capitals |
| Letter spacing | 0 below z12; towns 0.08 from z12; the capital 0.55 from z14 ("L O N D O N") |
| Halo | White, width 2, blur 0.5 |
| Collision | `text-padding` 3 (Protomaps' wider padding knocks out neighbours and badges) |
| Exclusions | OSM `place=locality` moves to its own layer (below); "City of Westminster" is dropped because cycle.travel only shows the Westminster neighbourhood; farms and isolated dwellings are never named, as on cycle.travel |
| Hamlets | From z13 (cycle.travel's z14): Regular 10, wrapped at 5 ems, the village colour; from z15 like a village |
| Layers | Below z12 villages and hamlets are a copy, `places_villages`, placed after the thinned stations (Stations at z10–11, below), and `places_locality` keeps towns and cities |

**Neighbourhoods** (`places_subplace`): Medium, mixed case, no letter spacing, size 11 at z11 → 14 at z16,
`#373836` for macrohoods and suburbs and `#686966` for the rest, halo 1.5, padding 3. Suburbs (OSM
`place=suburb`: Putney, Greenstead) jump in size at cycle.travel's z14: 10.75 at z12 and 14 at z13, where
the rest are 11.6 and 12.2 (WS2.6; Putney and Greenstead within 3% of cycle.travel's width).

**Streets** (`roads_labels_*`): from z14 only, Regular 12, `#343434`, halo 1.5. "Street" → "St" and
"Road" → "Rd" at the end of the name; Lane, Way, Place, Hill… stay whole (`abbreviate` in
`style.ts`).

**Road numbers** (`ct_road_refs`): A/B roads (motorway, trunk, primary, secondary with a `ref`) from
z10, Italic 9 → 10.5 at z14, `#686766`, along the line every 350 px, padding 20.

**Water:** rivers from z12, Italic, letter spacing 0.25, `#65707a`, no halo. Lakes the same font and
colour.

**Points** (from z14 unless given, white halo 1.5, max width 7 ems, line height 1.1, padding 4). Later layers win
collisions:

| Layer | What | Font | Colour |
|---|---|---|---|
| `ct_landmarks` | The overlay's `landmark` POIs (tourism attractions, museums, zoos, aquariums, theme parks, castles, palaces; never churches, which cycle.travel leaves unnamed), each under a castle, museum or star icon, from z13 (rule below) | SemiBold 9.5 (z13) → 11 (z14) | `#bb806d` |
| `ct_localities` | OSM `place=locality` (park gates, river reaches) | Medium 11 | `#686867` |
| `ct_parks` | `park`, `garden`, `nature_reserve`, `wood`, `forest`, `golf_course` | Medium Italic 11.5 | `#3c6633` |

`ct_localities` and `ct_parks` only show where Protomaps' `min_zoom` ≤ zoom − 1: cycle.travel names far
fewer than Protomaps carries, roughly one zoom later.

**Landmarks.** Until its z16 (our 15) cycle.travel marks only big buildings and bridges, never museums:
Buckingham Palace, the Palace of Westminster, the Royal Mews, Westminster and London Bridges, but not the
British Museum, Horse Guards or Horse Guards Parade. From its z16, every landmark. So the overlay gives each
landmark an `icon` (`castle` for castles and palaces, `museum`, else `attraction`), its `area` in m² and
whether it's a `structure` (a building or bridge), and `ct_landmarks` shows:

- **z13–14:** structures that aren't museums, of at least 6000 m² (`bigLandmark`, about Westminster Bridge).
- **z15+:** every landmark.

The biggest place first (`symbol-sort-key`), and the label gives way before the icon does
(`text-optional`). Icons are Maki `castle`, `museum` and `star` (sprite `landmark-*`).

This is an approximation. **Gaps:** it misses the London Eye (not a building) and adds St James's Palace
and Burlington House; the Westminster neighbourhood label and The Mound's peak label crowd out one or two
landmarks cycle.travel shows.
cycle.travel draws POI icons (cafés, pubs, toilets, bike parking, bike shops, campsites, water, parking,
viewpoints, zoo animals at WWT Barnes); we draw none.

## Stations and peaks

From the overlay's `pois` layer (`kind` `station` or `peak`), because Protomaps thins both out below
tile z14.

- **Stations:** `railway=station` with a name, excluding `station` = subway, light_rail, miniature,
  monorail, funicular, tram, plus heritage (`usage=tourism`, `railway:preserved`) and disused.
  `ct_stations`: circle from z12, `#dd4c18` (the key's cycleway orange, captured as `#cd562d`), radius
  2.2 (z10) → 2.6 (z14), black stroke 0.9.
  `ct_stations_label` from z14: SemiBold 11, same colour, `text-variable-anchor` top, bottom,
  bottom-right, bottom-left, top-right, top-left with radial offset 0.6 (so Charing Cross slides beside
  LONDON).
  `ct_stations_thinned` at z10–11: the same dot as a sprite image (`station`, the same 2.2 fill radius
  and stroke outside it), for a subset.
- **Stations at z10–11.** At its z11–12 cycle.travel shows nearly every station in Surrey and rural
  Essex, a few at London's edge (Hampton Court, Ewell East, Banstead, Hayes, Feltham) and none further
  in. A town's name beats its station (Clacton, Walton, Felixstowe, Ipswich), but a station beats a
  village's name: Mistley, Wrabness and Westerfield get the dot and no name. Counting the other stations
  within 5 km:

  | Where | Others within 5 km |
  |---|---|
  | Rural Essex | 0–3 |
  | Surrey towns (Guildford, Woking, Dorking, Reigate, Crawley) | 2–6 |
  | London's edge, shown by cycle.travel | 8–16 |
  | London's edge, hidden (Surbiton, Thames Ditton, Kingston, Sutton) | 8–19 |
  | Inner London | 20+ |

  So the overlay counts them at z10–11 (`crowd_5km`, across tile edges) and `ct_stations_thinned` shows
  those with at most 11 (`crowdedStation`). It's placed after towns' names and before villages'
  (`places_villages`) and everything else, with collision, so a town's name or a neighbouring station
  wins, as on cycle.travel. This is an approximation: at London's edge it keeps about two thirds of what
  cycle.travel shows and hides about three quarters of what it hides; around Harwich (z10) it shows 11
  where cycle.travel shows about 15, because Manningtree, Wivenhoe and Woodbridge are towns in OSM and
  their bold names cover their stations, where cycle.travel names them like villages.
- **Peaks:** `natural=peak` or `hill` with a name. `ct_peaks` from z12, Medium Italic 11, `#754634`.

## POI icons

`ct_pois`, a symbol layer on the overlay's `pois`, from z14 (cycle.travel's z15). Icons are sprite images
drawn by `maps/style/src/sprite.ts` with [Maki](https://github.com/mapbox/maki) 8.2.0 glyphs (CC0,
`maps/style/src/maki.ts`); the water drop is ours. Never cycle.travel's SVGs: only its colours are taken.

| Kind | Sprite | Drawn as | Colour |
|---|---|---|---|
| `cafe` | `poi-cafe` | Maki `cafe`, 11 px | food `#cc8d7b` |
| `pub` | `poi-pub` | Maki `beer`, 12.5 px | food `#cc8d7b` |
| `toilets` | `poi-toilets` | Maki `toilet`, 11.5 px | water `#008b8b` |
| `drinking_water` | `poi-drinking-water` | White drop 7.5 px on an 11 px rounded square | water `#008b8b` |
| `bicycle_parking` | `poi-bicycle-parking` | White Maki `parking` 6.5 px on a 9 px square | parking `#64bde1` |
| `bicycle_shop` | `poi-bicycle-shop` | White Maki `bicycle` 9.5 px on a 12 px square | bike `#938ec4` |
| `camp_site` | `poi-camp-site` | Maki `campsite`, 12 px | camping `#378b36` |
| `viewpoint` | `poi-viewpoint` | Maki `viewpoint`, 12 px | `#7a4433` (not in the key; captured) |

Sizes are along the glyph's longer side, as cycle.travel draws them at its z15; they don't scale with
zoom. Colours are the key's (`/map/snippet_key`), drawn as they are. Every icon has a 1.25 px cream
(`#fdfdf4`) halo drawn into the image, since MapLibre only halos SDF icons. Car parks (`parking`) are
in the overlay but not drawn: cycle.travel doesn't mark them.

`icon-allow-overlap` is on, as cycle.travel lets icons overlap each other and the badges; labels still
keep clear of them. Where they overlap, `symbol-sort-key` puts water on top, then toilets, bike shop,
café, campsite, viewpoint, pub, bike parking.

### Thinning

cycle.travel doesn't show every POI. What it shows, compared view by view (ct zoom = ours + 1):

| View | ct z15 (our 14) | ct z16 (our 15) | ct z17 |
|---|---|---|---|
| Villages, country parks (Shere, Box Hill) | Everything | — | — |
| Small town (Dorking) | Centre hidden; bike shops, a campsite, a P at the edge | Everything, every café, overlapping | — |
| Putney | Only the bike shop and rental | Pubs, Ps, water, convenience, rental; no cafés | — |
| Westminster, Victoria | Only park and river items (St James's Café, Tattershall Castle) | Pubs, Ps, water; no cafés | No cafés |

Bike shops show at every zoom. Counting all eight icon kinds around those POIs:

| Where | Other icons within 500 m | Within 1 km |
|---|---|---|
| Shere | ≤ 6 | ≤ 7 |
| Box Hill | ≤ 8 | ≤ 18 |
| Dorking cafés | 24–47 | 53–61 |
| Dorking's edge P | 0 | 41 |
| Putney cafés | 29 (10th percentile) | ≥ 103 |
| Westminster | ~82 (10th percentile) | ≥ 384 |
| St James's Café | 65 | — |

So the overlay counts each icon's neighbours (`crowd_500m`, `crowd_1km`, across tile edges; see
`maps/tiles/README.md`) and the style filters on them:

- **z14:** an icon shows when it has at most 10 others within 500 m (`quiet`), or is a bike shop.
- **z15+:** every icon shows, except cafés with more than 80 others within 1 km (`cityCafes`).

This is an approximation of a rule we can't see. Checked against the five views, it matches what shows
and what doesn't, except for the gaps below.

## Layer order

Bottom to top, as `style.ts` splices them into Protomaps' `light` layers:

1. Protomaps background, earth, water, land use… with `ct_urban` and `ct_greens` inserted just before
   `landuse_park`, `ct_pitches` just after it, and `ct_military_band`, `ct_military` just after
   `buildings`.
2. Protomaps roads, with `ct_footpaths`, `ct_unpaved`, `ct_cycleways_casing`, `ct_cycleways` just
   before `roads_rail`, and `ct_rail_core` just after it.
3. `ct_routes_lcn`, `ct_routes_rcn`, `ct_routes`, `ct_routes_eurovelo`, `ct_stations` just before
   `roads_labels_minor`, so route dots sit above every line and below every label.
4. `ct_road_refs` just after `roads_labels_major`.
5. `ct_landmarks`, `ct_localities`, `ct_parks`, `ct_peaks`, `ct_stations_label`, `ct_pois`, the four
   badge layers, `places_villages` (z10–11) and `ct_stations_thinned`, just before `places_subplace`.
6. Protomaps place labels on top.

## Protomaps changes

The basemap is `@protomaps/basemaps` 5.7.2's `layers('basemap', flavour, { lang: 'en' })` with the
`light` flavour recoloured. Changes on top:

- **Dropped layers:** `pois` (replaced by the `ct_*` point labels), `roads_shields`, `roads_oneway`,
  `address_label`, `landcover`.
- **No Protomaps sprite:** every `icon-*` layout property is removed. The style's sprite is ours
  (`maps/style/src/sprite.ts`): the badges and the POI icons.
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

From the ten comparisons in `screenshots/`. Tick them off in WS2.

- [ ] Hillshade and contours (needs a DEM, WS1)
- [x] POI icons: café, pub, toilets, water, bike parking, bike shop, campsite, viewpoint (WS2.4b; no car
  parks, as on cycle.travel)
- [ ] POI kinds we don't draw: restaurant, convenience shop, museum, attraction, bike rental, hostel,
  fuel
- [ ] Café and other POI name labels (cycle.travel labels some cafés, e.g. Shere's Dabbling Duck)
- [ ] POI thinning misses London's park and river POIs at z14 (St James's Café: 65 others within 500 m);
  the rule is an approximation
- [ ] Icons at one spot stack (Box Hill's café, toilets, water and Ps); cycle.travel spreads them out
- [ ] More bike parking in London than cycle.travel shows (Putney at our z15)
- [x] Purple cycle lanes on roads (WS1.3: `ct_cycle_lanes` from z14, bus lanes too)
- [x] London rcn: far fewer lines (WS2.5: TfL routes from z12 with a C/Q/CS number, z13 without, and no
  proposed or under-construction routes)
- [x] lcn dots lighter (WS2.5: also smaller and closer together, in their own layer)
- [x] NCN + EuroVelo overlap drawn as one line, not stacked dots (WS2.5: one network per way, and the
  Avenue Verte dots as national)
- [x] Route dots round at every zoom, with cycle.travel's sizes and spacing (WS2.5: symbol dots)
- [x] Paths from z11 in London (WS2.5: paved and unpaved paths from z11, thinner below z13)
- [ ] More minor streets at z12–13 (WS2.5 covers z10–11 from the overlay's `low_roads`; the basemap still thins z12–13).
  The streets it has are now the solid grey lines cycle.travel draws until its z15
- [x] Railways and minor roads below z11 (WS2.5: the overlay's `low_roads`)
- [x] Trunk roads far paler than the key (WS2.5)
- [x] A/B roads a constant 4 px from z12 with a near-black hairline casing, dark grey at z11; lanes and tertiary roads as
  cycle.travel's key draws them, grey below z11; only tertiary roads at z9 (WS2.5)
- [ ] Station throats lighter at z14 (Waterloo, Victoria)
- [x] Untagged permissive paths and graded tracks as brown dashes (WS2.5 batch D: `bicycle=permissive`
  paths and footways with no `surface`, and `tracktype` grade2–5, are unpaved; Colchester's Middlewick and
  High Woods)
- [ ] Bare `highway=footway` + `bicycle=yes` stubs across fields draw red where cycle.travel draws nothing
  (Surrey Hills near White Hill and Dunley Hill, OSM ways 525650801, 525650803, 525650805). It may leave
  out ways that don't join its routable network
- [ ] EuroVelo badges: cycle.travel badges EuroVelo beside a shared national route (Colchester z12: a
  EuroVelo 2 badge beside the 51 shield, where we show only the 51) and from our z10
- [ ] AV badges along the Albert Embankment at z14 that cycle.travel doesn't draw
- [ ] TfL Q routes as thin lavender lines at z11 (ours start at z12)
- [ ] Village names: cycle.travel names more at z10 (Whatfield, Lindsey, Flowton) and Wrabness and
  Bradfield at z11
- [x] Town names bolder than cycle.travel's (WS2.6: small towns drawn as villages below z12, sizes by
  population)
- [ ] Harwich is Medium on cycle.travel at our z10 but bold at z9 and z11; ours stays bold. Dovercourt
  (Protomaps' 10,000 placeholder) is 1.12× ours there
- [ ] Label choice in London at z9: cycle.travel names Hampstead, Chiswick, Barnes, Lewisham, Beckenham and
  Surbiton where we name Camden Town, Eltham and Bromley
- [ ] Quarters at z11 (Lot's Village, Nine Elms, Myatt's Fields): cycle.travel shows none there
- [ ] Peaks without an elevation (Spankers Hill in Richmond Park): cycle.travel names them, we don't
- [ ] TfL badges at z14 in the phone window: cycle.travel badges only the Q route by Westminster where we
  add C3 and C56, and leaves out the Westminster label we draw
- [x] Bolder railways; paler, thinner motorways when zoomed out (WS2.5)
- [x] Railways: no tunnels (the Underground), thin sidings and yards with no white core (WS2.5)
- [x] EuroVelo dots: opaque slate/lavender ring, red centre (WS2.5)
- [x] Ferry crossings left out of routes; regional routes from cycle.travel's z11 (WS2.5)
- [x] Brown unpaved dashes slightly lighter (WS2.2: the key's `#8b4513` captures as cycle.travel's `#834a21`)
- [x] Landmark selection: drop the extras (WS2.5: big buildings and bridges until z15; an approximation)
- [x] No farm or hamlet labels in rural areas at z12 (WS2.5: farms never, hamlets from z13)
- [x] Station subset at z10–11 (WS2.5: by stations within 5 km; an approximation)
- [ ] Knockout shade inside parks
- [x] Pedestrian areas outlined in red at street level: these were military land (Horse Guards, Wellington
  Barracks), now outlined (WS2.5)
- [x] Colours: stop running key values through `shot()`; fix the curve (above). WS2.2
- [x] Park fill lighter: Richmond Park captures as `#eaf2d9` on cycle.travel, against our park `#d8e7cf`
  (WS2.5, with wood, golf, cemetery, pitch and pedestrian re-sampled too)
- [x] Buildings at z14: 72% of the pixels we fill as building in the Westminster view are plain urban
  (`#e8e4e4`) on cycle.travel (WS2.5: buildings take the urban fill)
- [x] Scrub and grass: cycle.travel shows land colour where we fill them (WS2.5)
- [x] Find what draws the `#e3e2d9` fill that covers 16% of our Westminster view (WS2.5: Protomaps'
  half-opaque buildings over land)
- [ ] Built-up land with no land-use polygon in Protomaps' tiles: 20% of the land we leave bare in Richmond
  and 41% in Westminster is built-up on cycle.travel. Not yet traced: Protomaps may drop small `landuse`
  polygons, or cycle.travel may fill from other tags. WS1 data
- [x] Re-check every size at 3× on an iPhone (WS2.6, iPhone 17 Simulator: route dots 21 px across against
  cycle.travel's 22, badges 45 px wide against 43; MapLibre Native draws labels as GL JS does, within a
  pixel or two; village, small-town and suburb labels retuned)
