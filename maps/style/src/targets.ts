import type { Target } from './style.ts'

/** The app's copy of the style, glyphs and sprite: RoutesUI's `CycleMap` resources. */
export const appResources = new URL('../../../app/Packages/Features/Sources/RoutesUI/CycleMap/', import.meta.url)

/** Where the app reads the style's files from. */
export const native: Target = {
  // MapLibre Native won't resolve relative glyph URLs: the app swaps `bundle://` for the resource bundle's
  // file URL when it loads the style (CycleMapSpike.swift).
  glyphs: 'bundle://glyphs/{fontstack}/{range}.pbf',
  sprite: 'bundle://sprite',
  tiles: 'https://maps.ride-on.cc',
}

/**
 * The browser prototype (docs/maps/prototype), served from `origin`, with the app's glyphs from `/glyphs/` and its
 * sprite from `/sprite`. Tiles come from R2 unless `tiles` says otherwise (e.g. `http://localhost:8787/data` for
 * local builds).
 */
export const web = (origin: string, tiles = native.tiles): Target => ({
  glyphs: `${origin}/glyphs/{fontstack}/{range}.pbf`,
  sprite: `${origin}/sprite`,
  tiles,
})
