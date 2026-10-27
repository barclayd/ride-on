// Slim the fixture geometry for the design files: Douglas-Peucker at TOL metres, polyline6 again.
global.window = {}; require('../data/fixtures.js')
const f = window.RIDE_ON_FIXTURES, TOL = +process.argv[2] || 12
const dec = (s) => { let i = 0, lat = 0, lon = 0, o = []; while (i < s.length) { for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5 } while (b >= 32); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (k == 0) lat += d; else lon += d } o.push([lon / 1e6, lat / 1e6]) } return o }
const encNum = (n) => { n = n < 0 ? ~(n << 1) : n << 1; let s = ''; while (n >= 32) { s += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5 } return s + String.fromCharCode(n + 63) }
const enc = (pts) => { let pl = 0, pn = 0, s = ''; for (const [lon, lat] of pts) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); s += encNum(la - pl) + encNum(lo - pn); pl = la; pn = lo } return s }
const xy = ([lon, lat]) => [lon * 111320 * Math.cos(51.4 * Math.PI / 180), lat * 110540]
const segD = (p, a, b) => { const [px, py] = xy(p), [ax, ay] = xy(a), [bx, by] = xy(b); const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy) }
const dp = (pts) => { const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); let m = 0, mi = -1; for (let i = a + 1; i < b; i++) { const d = segD(pts[i], pts[a], pts[b]); if (d > m) { m = d; mi = i } } if (m > TOL) { keep[mi] = 1; st.push([a, mi], [mi, b]) } } return pts.filter((_, i) => keep[i]) }
let n = 0; const out = {}
for (const r of f.routes.routes) { const p = dp(dec(f.geometry[r.id].geometry.data)); n += p.length; out[r.id] = enc(p) }
const names = Object.fromEntries(f.routes.routes.map((r) => [r.id, r.name]))
const js = `// Ride On Web design fixtures: the 15 saved routes (real GB loops from Kingston), polyline6 like GET /routes/{id}/geometry.\nwindow.RIDE_ON_ROUTES = ${JSON.stringify(f.routes.routes.map((r) => ({ id: r.id, name: r.name, km: +(r.distanceM / 1000).toFixed(1), line: out[r.id] })), null, 0).replace(/\},\{/g, '},\n{')}\n`
require('fs').writeFileSync('up/map/routes.js', js)
console.log({ points: n, bytes: js.length })
