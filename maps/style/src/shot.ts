// Colours sampled from Chrome screenshots aren't the page's colours: the capture converts to the display profile.
// Fitted from 80 swatches (mean error 0.25/255): linear-light sRGB × matrix, then a 1/1.96 power curve.
// shot() undoes that, turning a colour sampled off a cycle.travel screenshot into the sRGB value it actually draws.
// Known issue: a later check (four swatches drawn on both pages, 18 Oct 2026) found greys and pale tints come back
// from the capture unchanged, but shot() lightens them (#808080 -> #8b8b8b). Swapping the 1.96 power for the sRGB
// curve fixes that. See docs/maps/cycle-travel-style.md, "Colour sampling" (WS2.2).
const inverse = [
  [1.18213, -0.04889, -0.01206],
  [-0.16543, 1.04173, 0.01245],
  [-0.01793, 0.00739, 0.99856],
]

export const shot = (hex: string): string => {
  const m = [1, 3, 5].map((i) => (Number.parseInt(hex.slice(i, i + 2), 16) / 255) ** 1.96)
  return `#${[0, 1, 2]
    .map((j) => {
      const l = Math.min(
        1,
        Math.max(
          0,
          m.reduce((s, v, i) => s + v * (inverse[i]?.[j] ?? 0), 0),
        ),
      )
      const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
      return Math.round(v * 255)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}
