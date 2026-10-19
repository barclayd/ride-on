import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { format, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { decode } from 'fast-png'
import { buildSprite, formatIndex } from '../src/sprite.ts'
import { archives, buildStyle, faces } from '../src/style.ts'
import { appResources, native, web } from '../src/targets.ts'

const glyphs = new URL('glyphs/', appResources)
const ranges = ['0-255', '256-511', '512-767', '7680-7935', '8192-8447', '8448-8703']
const targets = { native: buildStyle(native), web: buildStyle(web('http://localhost:8787')) }

// Font stacks in a `text-font` value: `["literal", [...]]`, or a bare array of names inside an expression.
const stacks = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  if (value[0] === 'literal' && Array.isArray(value[1])) return value[1]
  if (value.every((name) => typeof name === 'string' && /^[A-Z]/.test(name))) return value
  return value.flatMap(stacks)
}
const used = new Set(
  targets.native.layers.flatMap((layer) => (layer.type === 'symbol' ? stacks(layer.layout?.['text-font']) : [])),
)

describe.each(Object.entries(targets))('%s style', (_, style) => {
  test('is valid', () => {
    expect(validateStyleMin(style).map((error) => error.message)).toEqual([])
  })

  // Without a text-font MapLibre asks for its default stack, which has no glyphs.
  test('every label sets its font', () => {
    const missing = style.layers.filter(
      (layer) => layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined && !layer.layout['text-font'],
    )
    expect(missing.map((layer) => layer.id)).toEqual([])
  })

  test('reads the dated GB archives', () => {
    for (const [name, source] of Object.entries(style.sources)) {
      expect(source.type).toBe(name === 'terrain' ? 'raster-dem' : 'vector')
      expect('url' in source && source.url).toMatch(
        /^pmtiles:\/\/https:\/\/maps\.ride-on\.cc\/[a-z]+-gb-\d{8}\.pmtiles$/,
      )
    }
    expect(Object.keys(style.sources).sort()).toEqual(Object.keys(archives).sort())
  })
})

describe('glyphs', () => {
  test('every font stack has every range', () => {
    expect(used.size).toBeGreaterThan(0)
    for (const stack of used) {
      expect(readdirSync(new URL(`${stack}/`, glyphs)).sort()).toEqual(ranges.map((range) => `${range}.pbf`).sort())
    }
  })

  test('every glyph directory is a face the style uses', () => {
    const directories = readdirSync(glyphs, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    expect(directories.map((entry) => entry.name).sort()).toEqual([...used].sort())
    expect([...used].sort()).toEqual(faces.map((face) => `Montserrat-${face}`).sort())
  })
})

test('the app style is up to date (bun run build)', async () => {
  const committed = await Bun.file(new URL('style.json', appResources)).text()
  expect(committed).toBe(`${format(targets.native, 1)}\n`)
})

describe('sprite', () => {
  const sprite = buildSprite()

  test('has every image the style uses', () => {
    // A plain name, each output of a match on a feature property (the last is its fallback, ''), or of a zoom step.
    const names = (image: unknown): string[] =>
      !Array.isArray(image)
        ? [String(image)]
        : image[0] === 'match'
          ? image.slice(3, -1).filter((_, i) => i % 2 === 0)
          : image[0] === 'step'
            ? image.slice(2).filter((_, i) => i % 2 === 0)
            : [String(image)]
    const images = targets.native.layers.flatMap((layer) =>
      layer.type === 'symbol' && layer.layout?.['icon-image'] !== undefined ? names(layer.layout['icon-image']) : [],
    )
    expect(images.length).toBeGreaterThan(0)
    expect(images.filter((image) => !(image in sprite.index))).toEqual([])
  })

  test('the app sprite is up to date (bun run build)', async () => {
    expect(await Bun.file(new URL('sprite@2x.json', appResources)).text()).toBe(formatIndex(sprite.index))
    // resvg's anti-aliasing may differ by a level between CPUs, so compare pixels, not bytes.
    const committed = decode(await Bun.file(new URL('sprite@2x.png', appResources)).bytes())
    const fresh = decode(sprite.png)
    expect([committed.width, committed.height]).toEqual([fresh.width, fresh.height])
    const worst = Math.max(...Array.from(fresh.data, (value, i) => Math.abs(value - (committed.data[i] ?? 0))))
    expect(worst).toBeLessThanOrEqual(2)
  })
})
