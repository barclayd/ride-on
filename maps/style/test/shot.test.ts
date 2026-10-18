import { expect, test } from 'bun:test'
import { shot } from '../src/shot.ts'

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

// The swatch check in docs/maps/cycle-travel-style.md: drawn on both pages, then sampled off a Chrome screenshot.
test.each([
  ['trunk', '#c0c8ae', '#c1c8b0'],
  ['land', '#eef2e1', '#eff2e2'],
  ['grey', '#808080', '#808080'],
])('shot() turns the captured %s swatch back into what was drawn', (_, drawn, captured) => {
  const error = channels(shot(captured)).map((c, i) => Math.abs(c - (channels(drawn)[i] ?? 0)))
  expect(Math.max(...error)).toBeLessThanOrEqual(2)
})

// Saturated orange: red and green come back, blue is lost to gamut clipping in the capture.
test('shot() recovers the cycleway swatch except its blue', () => {
  const [r, g] = channels(shot('#cd562d'))
  expect(Math.abs((r ?? 0) - 0xdd)).toBeLessThanOrEqual(3)
  expect(Math.abs((g ?? 0) - 0x4c)).toBeLessThanOrEqual(3)
})
