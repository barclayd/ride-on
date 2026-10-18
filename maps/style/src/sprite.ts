// The style's images, drawn as SVG and rasterised with resvg into one sprite sheet: cycle.travel's repeater
// badges. Red and blue are shot() of its badges in a Chrome screenshot, checked against a new one; EuroVelo is by
// eye. See docs/maps/cycle-travel-style.md, "Repeater badges".
import { Resvg } from '@resvg/resvg-js'

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
