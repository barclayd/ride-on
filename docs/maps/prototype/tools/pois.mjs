// Stations and hills from Overpass -> GeoJSON points. Protomaps thins both out below z14, cycle.travel doesn't.
import { readFileSync, writeFileSync } from 'node:fs'
const [input, out] = process.argv.slice(2)
const data = JSON.parse(readFileSync(input, 'utf8'))
// cycle.travel marks rail stations only: no Underground-only, tram or heritage stops.
const notRail = new Set(['subway', 'light_rail', 'miniature', 'monorail', 'funicular', 'tram'])
const features = []
for (const e of data.elements) {
  const t = e.tags ?? {}
  const at = e.type === 'node' ? [e.lon, e.lat] : e.center && [e.center.lon, e.center.lat]
  if (!at || !t.name) continue
  let kind = null
  if (t.railway === 'station' && !notRail.has(t.station) && t.usage !== 'tourism' && !t['railway:preserved'] && t.disused !== 'yes') kind = 'station'
  if (t.natural === 'peak' || t.natural === 'hill') kind = 'peak'
  if (kind) features.push({ type: 'Feature', properties: { kind, name: t.name }, geometry: { type: 'Point', coordinates: at.map((v) => +v.toFixed(5)) } })
}
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(features.length, features.reduce((a, f) => (a[f.properties.kind] = (a[f.properties.kind] ?? 0) + 1, a), {}))
