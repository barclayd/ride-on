// Colours sampled from Chrome screenshots aren't the page's colours: the capture converts to the display profile.
// Saturated colours move a lot, greys and pale tints barely move. shot() undoes that, turning a colour sampled off
// a cycle.travel screenshot into the sRGB value it actually draws: sRGB decode, this matrix, sRGB encode.
// The matrix was fitted from 80 swatches; the sRGB curves (WS2.2, replacing a fitted 1/1.96 power that lightened
// greys) round-trip a later four-swatch check to within 2/255. See docs/maps/cycle-travel-style.md, "Colour sampling".
const inverse = [
  [1.18213, -0.04889, -0.01206],
  [-0.16543, 1.04173, 0.01245],
  [-0.01793, 0.00739, 0.99856],
]

const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const encode = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)

export const shot = (hex: string): string => {
  const m = [1, 3, 5].map((i) => decode(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  return `#${[0, 1, 2]
    .map((j) => {
      const l = Math.min(
        1,
        Math.max(
          0,
          m.reduce((s, v, i) => s + v * (inverse[i]?.[j] ?? 0), 0),
        ),
      )
      return Math.round(encode(l) * 255)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}
