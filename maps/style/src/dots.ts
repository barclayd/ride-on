// cycle.travel's cycle route dots. MapLibre draws a dotted line as round-capped dashes of zero length, and slices or
// bends every dot that straddles a vertex of the line (many do at our z9–11). So each network's dots are icons placed
// along the route instead: one image per zoom, drawn at that zoom's size and colours, `symbol-spacing` apart. Sizes,
// spacings and colours are measured off cycle.travel's screenshots: docs/maps/cycle-travel-style.md, "Cycle routes".

export const networks = ['lcn', 'rcn', 'ncn', 'icn'] as const
export type Network = (typeof networks)[number]

/** One zoom's dots on one network, in CSS pixels. */
interface Dot {
  /** Diameter. */
  size: number
  /** Centre to centre, along the route. */
  spacing: number
  /** The outer disc and its opacity. */
  fill: string
  opacity: number
  /** EuroVelo's opaque centre, as a colour and a fraction of the diameter. */
  centre?: [string, number]
}

/** The network's dots at an integer zoom. */
type Spec = (zoom: number) => Dot

// Zoom/value stops, interpolated as the style's line widths are: exponential, base 1.5.
const at = (stops: number[], zoom: number) => {
  for (let i = 2; i < stops.length; i += 2) {
    const [z0 = 0, v0 = 0, z1 = 0, v1 = 0] = stops.slice(i - 2, i + 2)
    if (zoom <= z0) return v0
    if (zoom <= z1) return v0 + ((1.5 ** (zoom - z0) - 1) / (1.5 ** (z1 - z0) - 1)) * (v1 - v0)
  }
  return stops[stops.length - 1] ?? 0
}

// National and regional dots are translucent, as cycle.travel's are: ~5px across at our z9 and 6.5–7px from z10 up,
// centres 11.5px apart at z9 and ~20px from z11, so the gap (in diameters) opens up as you zoom in. Regional dots are
// smaller at z10 and lighter until z11. Local ones are smaller teal dots, closer together, from cycle.travel's z14
// (our 13).
const translucent =
  (fill: string, sizes: number[], gap: (zoom: number) => number, opacity: (zoom: number) => number): Spec =>
  (zoom) => {
    const size = at(sizes, zoom)
    return { size, spacing: size * gap(zoom), fill, opacity: opacity(zoom) }
  }
const sizes = [6, 3.5, 8, 4.5, 9, 5, 10, 6.5, 12, 7, 14, 7, 18, 8.5]
const gap = (zoom: number) => (zoom < 11 ? 2.3 : 2.9)

// EuroVelo dots are bigger and opaque: 6px at our z9 and 8px from z10, centres 10, 17 and 19.5px apart at z9, z10
// and z11. The ring is slate at z9 and lavender from z10, around a red centre 58% of the dot at z9 and half from z10
// that pales as you zoom in. The colours were solved against swatches captured alongside the comparison shots (WS2.5
// lines), and draw to within 1/255 of cycle.travel's capture.
const euroVelo: Spec = (zoom) => {
  const size = at([6, 3.5, 8, 4.5, 9, 6, 10, 8, 14, 8, 18, 9], zoom)
  const spacing = size * (zoom < 10 ? 1.7 : zoom < 11 ? 2.125 : 2.45)
  const centre = ['#f76b68', '#f7837f', '#fb8d8e', '#f59691'][Math.min(Math.max(zoom - 9, 0), 3)] ?? ''
  return {
    size,
    spacing,
    fill: zoom < 10 ? '#6a808c' : '#8295c1',
    opacity: 1,
    centre: [centre, zoom < 10 ? 0.58 : 0.5],
  }
}

const specs: Record<Network, { minzoom: number; spec: Spec }> = {
  lcn: {
    minzoom: 13,
    spec: translucent(
      '#008b8b',
      [13, 4.75, 18, 6],
      () => 2.1,
      () => 0.53,
    ),
  },
  rcn: {
    minzoom: 10,
    spec: translucent('#0000ff', sizes.with(7, 5), gap, (zoom) => (zoom < 11 ? 0.26 : 0.33)),
  },
  ncn: { minzoom: 6, spec: translucent('#ff0000', sizes, gap, (zoom) => (zoom < 10 ? 0.59 : zoom < 11 ? 0.55 : 0.5)) },
  icn: { minzoom: 6, spec: euroVelo },
}

/** The highest zoom with its own dots: the step expressions hold its values beyond. */
const maxzoom = 18

/** A dot image: its sprite name, side in CSS px and SVG markup (viewBox `0 0 side side`). */
export interface DotImage {
  name: string
  side: number
  svg: string
}

const svg = (dot: Dot, side: number) => {
  const disc = (fill: string, d: number, opacity = 1) =>
    `<circle cx="${side / 2}" cy="${side / 2}" r="${d / 2}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`
  return disc(dot.fill, dot.size, dot.opacity) + (dot.centre ? disc(dot.centre[0], dot.size * dot.centre[1]) : '')
}

/**
 * Each network's dots from its first zoom up: the images (one per distinct dot, named after the first zoom that uses
 * it) and the zooms where the image and spacing change, for `step` expressions.
 */
export const dots = Object.fromEntries(
  networks.map((network) => {
    const { minzoom, spec } = specs[network]
    const images: DotImage[] = []
    const steps: { zoom: number; image: string; spacing: number }[] = []
    for (let zoom = minzoom; zoom <= maxzoom; zoom++) {
      // Quarter pixels: anything finer is invisible, and nearby zooms then share an image.
      const dot = spec(zoom)
      const size = Math.round(dot.size * 4) / 4
      const spacing = Math.round(dot.spacing * 2) / 2
      const side = Math.ceil(size + 1)
      const markup = svg({ ...dot, size }, side)
      const image = images.find((existing) => existing.svg === markup && existing.side === side) ?? {
        name: `route-${network}-${zoom}`,
        side,
        svg: markup,
      }
      if (!images.includes(image)) images.push(image)
      const last = steps[steps.length - 1]
      if (!last || last.image !== image.name || last.spacing !== spacing)
        steps.push({ zoom, image: image.name, spacing })
    }
    return [network, { images, steps }]
  }),
) as Record<Network, { images: DotImage[]; steps: { zoom: number; image: string; spacing: number }[] }>
