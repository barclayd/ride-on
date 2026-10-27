// Resamples the fixtures' per-point elevation to 121 points by distance, for the prototype's profile.
// Usage: node gen/elev.js data/fixtures.js up/map/elev.js
const fs = require('fs')
global.window = {}
require(require('path').resolve(process.argv[2]))
const F = window.RIDE_ON_FIXTURES
const decode = (s) => {
  let i = 0, lat = 0, lon = 0
  const out = []
  while (i < s.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, r = 0
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5 } while (b >= 32)
      const d = r & 1 ? ~(r >> 1) : r >> 1
      if (k === 0) lat += d; else lon += d
    }
    out.push([lon / 1e6, lat / 1e6])
  }
  return out
}
const N = 120
const out = {}
for (const [rid, g] of Object.entries(F.geometry)) {
  const cs = decode(g.geometry.data)
  const el = F.elevation[rid]
  if (cs.length !== el.length) throw new Error(`${rid}: ${cs.length} points, ${el.length} heights`)
  const cum = [0]
  for (let i = 1; i < cs.length; i++) {
    const [x0, y0] = cs[i - 1], [x1, y1] = cs[i]
    cum.push(cum[i - 1] + Math.hypot((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0))
  }
  const at = (t) => {
    const d = t * cum.at(-1)
    const i = Math.max(1, cum.findIndex((c) => c >= d))
    const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return el[i - 1] + k * (el[i] - el[i - 1])
  }
  const e = Array.from({ length: N + 1 }, (_, i) => Math.round(at(i / N)))
  // Climb with 3 m hysteresis, on the full-resolution heights.
  let climb = 0, low = el[0]
  for (const h of el) { if (h < low) low = h; else if (h - low >= 3) { climb += h - low; low = h } }
  out[rid.slice(0, 8)] = { e, climb: Math.round(climb) }
}
fs.writeFileSync(process.argv[3], `// Elevation for the prototype's profile: ${N + 1} heights (m) per route, evenly spaced by distance, and the climb.\nwindow.RIDE_ON_ELEV = ${JSON.stringify(out)}\n`)
console.log(Object.entries(out).map(([k, v]) => `${k}:${v.climb}`).join(' '))
