# Cycle map style

Builds the cycle map's MapLibre style: Protomaps' `light` basemap recoloured to cycle.travel, plus the
cycling overlay from [`maps/tiles/`](../tiles/README.md), set in Montserrat. The plan is
[`docs/maps/README.md`](../../docs/maps/README.md) (WS2); why each rule is what it is is in the
[style spec](../../docs/maps/cycle-travel-style.md).

| File | What |
|---|---|
| `src/style.ts` | The style: every layer and rule. **Start here** |
| `src/targets.ts` | Where its URLs point: `native` (the app) and `web` (the prototype) |
| `src/shot.ts` | `shot(hex)`: undoes Chrome's screenshot colour shift on sampled colours (style spec, "Colour sampling") |
| `src/cli.ts` | Writes a style to disk |
| `scripts/glyphs.sh` | Builds the Montserrat glyph PBFs into the app |
| `test/style.test.ts` | Validation, glyph coverage, archive URLs, and a check that the app's style is up to date |

Bun 1.4, TypeScript (tsgo), Biome, as in `worker/`.

## Outputs

| Target | Command | Writes | Glyphs | Tiles |
|---|---|---|---|---|
| `native` | `bun run build` | `app/Packages/Features/Sources/RoutesUI/CycleMap/style.json` | `bundle://glyphs/…`, rewritten to the resource bundle by the app at load | `https://maps.ride-on.cc` |
| `web` | `bun src/cli.ts web <out> <origin> [<tiles>]` | The prototype's `style.json` (`bun run style` there) | `<origin>/glyphs/…` | `https://maps.ride-on.cc`, or `<tiles>` |

Both read the archives named in `archives` in `src/style.ts`: dated keys, never overwritten. After
publishing a new build (`maps/hosting/publish.sh`), bump the date there and run `bun run build`.

The app's style is committed and reviewed in PRs; CI fails if it doesn't match `src/style.ts`, so run
`bun run build` after every change. Format: `format(style, 1)` from the style spec package, so each
layer property is on its own line.

## Glyphs

MapLibre Native needs a `glyphs` URL even when the style declares fonts, so labels come from SDF glyph
PBFs, bundled with the app (`RoutesUI/CycleMap/glyphs/`, 2.9 MB) and served to the prototype by its
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
