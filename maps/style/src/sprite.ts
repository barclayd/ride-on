// The style's images, drawn as SVG and rasterised with resvg into one sprite sheet: cycle.travel's repeater
// badges and its POI icons. Badge red and blue are shot() of its badges in a Chrome screenshot, checked against a
// new one; EuroVelo is by eye. See docs/maps/cycle-travel-style.md, "Repeater badges" and "POI icons".
import { Resvg } from '@resvg/resvg-js'
import { type Glyph, maki } from './maki.ts'

interface Icon {
  /** Width and height, in CSS pixels. */
  size: number
  /** SVG markup in CSS pixels (a viewBox of `0 0 size size`), given one device pixel's size. */
  draw: (px: number) => string
  /** A band of CSS pixels that `icon-text-fit` stretches, the same on both axes. */
  stretch?: [number, number]
}

// Round a CSS length to whole device pixels, at least one, so thin edges stay sharp.
const snap = (length: number, px: number) => Math.max(1, Math.round(length / px)) * px

// Twelve five-pointed stars in a ring, as on the EuroVelo sign.
const stars = (size: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI
    const cx = size / 2 + size * 0.37 * Math.sin(a)
    const cy = size / 2 - size * 0.37 * Math.cos(a)
    const points = Array.from({ length: 10 }, (_, k) => {
      const b = (k / 10) * 2 * Math.PI
      const d = size * 0.05 * (k % 2 ? 0.45 : 1)
      return `${(cx + d * Math.sin(b)).toFixed(3)},${(cy - d * Math.cos(b)).toFixed(3)}`
    })
    return `<polygon points="${points.join(' ')}" fill="#f9ee59"/>`
  }).join('')

// POI colours from cycle.travel's map key (/map/snippet_key), drawn as they are. Viewpoints aren't in the key, so
// that brown, like the cream halo, is shot() of a Chrome screenshot.
const poi = {
  food: '#cc8d7b',
  water: '#008b8b',
  bike: '#938ec4',
  parking: '#64bde1',
  camping: '#378b36',
  view: '#7a4433',
  halo: '#fdfdf4',
}
// cycle.travel rings every icon in 1.25px of cream. MapLibre can only halo SDF icons, so it's drawn in.
const halo = 1.25

// A Maki glyph, `length` CSS px along its longer side, centred in a square with room for the halo.
const bare = (glyph: Glyph, length: number, colour: string): Icon => {
  const [x, y, w, h] = glyph.box
  const scale = length / Math.max(w, h)
  const size = Math.ceil(length + 2 * halo)
  const at = `translate(${(size - w * scale) / 2 - x * scale} ${(size - h * scale) / 2 - y * scale}) scale(${scale})`
  const ring = `stroke="${poi.halo}" stroke-width="${(2 * halo) / scale}" stroke-linejoin="round"`
  return {
    size,
    draw: () =>
      `<g transform="${at}"><path d="${glyph.outline ?? glyph.d}" fill="${poi.halo}" ${ring}/><path d="${glyph.d}" fill="${colour}"/></g>`,
  }
}

// A white glyph `length` CSS px along its longer side, on a rounded square `side` CSS px across.
const boxed = (glyph: Glyph, side: number, length: number, colour: string): Icon => {
  const [x, y, w, h] = glyph.box
  const scale = length / Math.max(w, h)
  const size = side + 2 * halo
  const at = `translate(${(size - w * scale) / 2 - x * scale} ${(size - h * scale) / 2 - y * scale}) scale(${scale})`
  const r = side * 0.15
  return {
    size,
    draw: () =>
      [
        `<rect width="${size}" height="${size}" rx="${r + halo}" fill="${poi.halo}"/>`,
        `<rect x="${halo}" y="${halo}" width="${side}" height="${side}" rx="${r}" fill="${colour}"/>`,
        `<path transform="${at}" d="${glyph.d}" fill="#ffffff"/>`,
      ].join(''),
  }
}

// Our own water drop, on Maki's grid: a point at the top, round at the bottom.
const drop: Glyph = {
  d: 'M7.5 1C9 4 11.5 6.6 11.5 9.5a4 4 0 0 1-8 0C3.5 6.6 6 4 7.5 1Z',
  box: [3.5, 1, 8, 12.5],
}

export const icons: Record<string, Icon> = {
  // National: flat brick red, barely rounded. Stretched around the number by icon-text-fit.
  'badge-red': {
    size: 8,
    stretch: [2, 6],
    draw: () => '<rect width="8" height="8" rx="0.6" fill="#e65a5d"/>',
  },
  // Regional and London: sky blue inside a 1 px border of two rings, darker going out, lighter along the top.
  'badge-blue': {
    size: 8,
    stretch: [2, 6],
    draw: (px) => {
      const outer = snap(0.5, px)
      const border = snap(1, px)
      return [
        '<rect width="8" height="8" rx="0.6" fill="#1c9cc7"/>',
        `<rect x="${outer}" width="${8 - 2 * outer}" height="${outer}" fill="#6fc4db"/>`,
        `<rect x="${outer}" y="${outer}" width="${8 - 2 * outer}" height="${8 - 2 * outer}" fill="#24a6d2"/>`,
        `<rect x="${outer}" y="${outer}" width="${8 - 2 * outer}" height="${border - outer}" fill="#38abce"/>`,
        `<rect x="${border}" y="${border}" width="${8 - 2 * border}" height="${8 - 2 * border}" fill="#26abe1"/>`,
      ].join('')
    },
  },
  // EuroVelo: a navy square ringed with twelve yellow stars; the route number sits in the middle as text.
  'badge-eu': {
    size: 16.5,
    draw: () => `<rect width="16.5" height="16.5" rx="0.6" fill="#0061a2"/>${stars(16.5)}`,
  },
  // POIs, sized as cycle.travel draws them at its z15 (our 14): bare glyphs for food, toilets, camping and views;
  // white glyphs on rounded squares for water and bikes. Maki's glyphs, not cycle.travel's (docs/maps/README.md).
  'poi-cafe': bare(maki.cafe, 11, poi.food),
  'poi-pub': bare(maki.beer, 12.5, poi.food),
  'poi-toilets': bare(maki.toilet, 11.5, poi.water),
  'poi-drinking-water': boxed(drop, 11, 7.5, poi.water),
  'poi-bicycle-parking': boxed(maki.parking, 9, 6.5, poi.parking),
  'poi-bicycle-shop': boxed(maki.bicycle, 12, 9.5, poi.bike),
  'poi-camp-site': bare(maki.campsite, 12, poi.camping),
  'poi-viewpoint': bare(maki.viewpoint, 12, poi.view),
}

/**
 * MapLibre Native only ever asks for `<sprite>@2x`, even on a 3× iPhone (src/mln/storage/resource.cpp), and
 * would scale a 2× sheet up. So the `@2x` sheet is drawn at 3× and says so in each image's `pixelRatio`, which
 * MapLibre (Native and GL JS) honours, scaling it down on 2× screens.
 */
export const spriteRatio = 3

export interface SpriteImage {
  x: number
  y: number
  width: number
  height: number
  pixelRatio: number
  stretchX?: [number, number][]
  stretchY?: [number, number][]
}

/** The sheet as a PNG and its index, every icon in one row, 2 px apart. */
export const buildSprite = (ratio = spriteRatio) => {
  const px = 1 / ratio
  const index: Record<string, SpriteImage> = {}
  const parts: string[] = []
  let x = 0
  for (const [id, icon] of Object.entries(icons)) {
    const size = Math.round(icon.size * ratio)
    parts.push(
      `<svg x="${x}" y="0" width="${size}" height="${size}" viewBox="0 0 ${icon.size} ${icon.size}">${icon.draw(px)}</svg>`,
    )
    const band = icon.stretch && [icon.stretch.map((v) => Math.round(v * ratio)) as [number, number]]
    index[id] = {
      x,
      y: 0,
      width: size,
      height: size,
      pixelRatio: ratio,
      ...(band && { stretchX: band, stretchY: band }),
    }
    x += size + 2
  }
  const height = Math.max(...Object.values(index).map((image) => image.height))
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${x - 2}" height="${height}">${parts.join('')}</svg>`
  const png = new Resvg(sheet, { font: { loadSystemFonts: false } }).render().asPng()
  return { index, png }
}

/** The index as committed: one image per line, so a change shows as one line in a diff. */
export const formatIndex = (index: Record<string, SpriteImage>) =>
  `{\n${Object.entries(index)
    .map(([id, image]) => `  ${JSON.stringify(id)}: ${JSON.stringify(image)}`)
    .join(',\n')}\n}\n`
