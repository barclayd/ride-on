# Cycle map style

Builds the cycle map's MapLibre style: Protomaps' `light` basemap recoloured to cycle.travel, plus the
cycling overlay from [`maps/tiles/`](../tiles/README.md), set in Montserrat. The plan is
[`docs/maps/README.md`](../../docs/maps/README.md) (WS2); why each rule is what it is is in the
[style spec](../../docs/maps/cycle-travel-style.md).

| File | What |
|---|---|
| `src/style.ts` | The style: every layer and rule. **Start here** |
| `src/targets.ts` | Where its URLs point: `native` (the app) and `web` (the prototype) |
| `src/dots.ts` | Each cycle network's route dots: size, spacing and colours per zoom, as dot images and `step` stops |
| `src/sprite.ts` | The badge, POI and route-dot images, drawn as SVG and rasterised with resvg into the sprite sheet |
| `src/shot.ts` | `shot(hex)`: undoes Chrome's screenshot colour shift on sampled colours (style spec, "Colour sampling") |
| `src/cli.ts` | Writes a style to disk |
| `scripts/glyphs.sh` | Builds the Montserrat glyph PBFs into the app |
| `test/style.test.ts` | Validation, glyph coverage, archive URLs, sprite coverage, and a check that the app's style and sprite are up to date |

Bun 1.4, TypeScript (tsgo), Biome, as in `api/`.

## Outputs

| Target | Command | Writes | Glyphs and sprite | Tiles |
|---|---|---|---|---|
| `native` | `bun run build` | `style.json`, `sprite@2x.json` and `sprite@2x.png` in `apple/Packages/Features/Sources/SharedUI/CycleMap/` | `bundle://glyphs/…`, `bundle://sprite`, rewritten to the resource bundle by the app at load | `https://maps.ride-on.cc` |
| `web` | `bun src/cli.ts web <out> <origin> [<tiles>]` | The prototype's `style.json` (`bun run style` there) | `<origin>/glyphs/…`, `<origin>/sprite` | `https://maps.ride-on.cc`, or `<tiles>` |

Both read the archives named in `archives` in `src/style.ts`: dated keys, never overwritten. After
publishing a new build (`maps/hosting/publish.sh`), bump the date there and run `bun run build`.

The app's style and sprite are committed and reviewed in PRs; CI fails if they don't match `src/`, so run
`bun run build` after every change. Format: `format(style, 1)` from the style spec package, so each
layer property is on its own line.

## Glyphs

MapLibre Native needs a `glyphs` URL even when the style declares fonts, so labels come from SDF glyph
PBFs, bundled with the app (`SharedUI/CycleMap/glyphs/`, 2.9 MB) and served to the prototype by its
`serve.ts`. `scripts/glyphs.sh` builds them:

- Montserrat's static TTFs from [JulietaUla/Montserrat](https://github.com/JulietaUla/Montserrat) at a
  pinned commit, checked against SHA-256s in the script, plus its `OFL.txt` (SIL OFL 1.1).
- [`build_pbf_glyphs`](https://github.com/stadiamaps/sdf_font_tools) (`cargo install build_pbf_glyphs`)
  makes one directory per face, named after the TTF: `Montserrat-SemiBold`. Those names are the font
  stacks in `text-font`.
- Faces: the ones in `faces` in `src/style.ts`. Ranges: Latin, Latin-1, Latin Extended-A and -B, Latin
  Extended Additional (Welsh ŵ ŷ ẁ ẃ ỳ), punctuation and letterlike symbols. MapLibre drops a label it
  has no glyphs for.

Run it after changing the faces or ranges (`bun run glyphs`). The tests fail if a font stack has no glyphs
or a glyph directory goes unused. The output is deterministic, so an unchanged run leaves git clean.

## Sprite

One sheet, `sprite@2x`, drawn at 3×: MapLibre Native only ever asks for `<sprite>@2x`, even on a 3×
iPhone, and would scale a 2× sheet up. Each image's `pixelRatio` is 3, which MapLibre Native and GL JS
both honour, scaling down on 2× screens. The prototype's server answers `/sprite.*` with the same files.

The badges are 8 px squares (EuroVelo 16.5) with a stretch band of `[2, 6]` both ways, so
`icon-text-fit: both` grows them round the number; `icon-text-fit-padding` sets the margins, so they need
no `content` box. Red and blue are `shot()` of cycle.travel's badges, checked against a new screenshot
(style spec, "Repeater badges"). The POI icons (`poi-*`) and landmark icons (`landmark-castle`, `-museum`,
`-attraction`) are [Maki](https://github.com/mapbox/maki) glyphs (CC0, `src/maki.ts`: castle, museum, star);
`station` is cycle.travel's orange station dot, for the thinned stations at z10–11 (the circles take over
from z12). resvg runs without system fonts, so the PNG is the same on any machine
to within a level of anti-aliasing, which is all the test allows.

## Check

```
bun install
bun run check    # tsgo, Biome, bun test
```

CI runs the same on PRs touching `maps/style/`, the app's `CycleMap/` resources or the workflow
(`.github/workflows/maps-style.yml`).

## Links

- Plan: [`docs/maps/README.md`](../../docs/maps/README.md)
- Style spec: [`docs/maps/cycle-travel-style.md`](../../docs/maps/cycle-travel-style.md)
- Prototype: [`docs/maps/prototype/`](../../docs/maps/prototype/README.md)
- MapLibre style spec: https://maplibre.org/maplibre-style-spec/
- `@protomaps/basemaps`: https://github.com/protomaps/basemaps
- Montserrat: https://github.com/JulietaUla/Montserrat
- `build_pbf_glyphs`: https://github.com/stadiamaps/sdf_font_tools
