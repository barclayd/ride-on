// One chained line per signed route relation, for cycle.travel's repeater badges. routes.geojson merges
// relations per way (and their refs), so a way on NCN 4 + EV2 can't say which badge it repeats.
import { readFileSync, writeFileSync } from 'node:fs'
const [out, ...inputs] = process.argv.slice(2)
// cycle.travel: EuroVelo/icn in a starred navy square, national in red, regional (London C/Q/CS) in blue.
const order = { icn: 1, ncn: 2, rcn: 3 }
const pt = (c) => c.join(',')
const chain = (lines) => {
  const byEnd = new Map()
  lines.forEach((l, i) => { for (const c of [l[0], l.at(-1)]) (byEnd.get(pt(c)) ?? byEnd.set(pt(c), []).get(pt(c))).push(i) })
  const used = new Uint8Array(lines.length)
  const take = (c) => {
    const i = (byEnd.get(pt(c)) ?? []).find((j) => !used[j])
    if (i === undefined) return null
    used[i] = 1
    return pt(lines[i][0]) === pt(c) ? lines[i] : [...lines[i]].reverse()
  }
  const chains = []
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let c = [...lines[i]], next
    while ((next = take(c.at(-1)))) c.push(...next.slice(1))
    while ((next = take(c[0]))) c = [...next.reverse(), ...c.slice(1)]
    chains.push(c)
  }
  return chains
}
const routes = new Map()
for (const file of inputs) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const geom = new Map(data.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]))
  for (const r of data.elements) {
    if (r.type !== 'relation') continue
    const net = r.tags.network
    const ref = (r.tags.ref ?? '').trim()
    // Badges only carry short signed numbers: no "(16)", "22 (Proposed)", named trails or bare "C".
    if (!order[net] || !/^[A-Z]{0,2}\d{0,3}$/.test(ref) || ref === 'C' || ref === '') continue
    const key = `${net}|${ref}`
    let e = routes.get(key)
    if (!e) routes.set(key, (e = { net, ref, ways: new Map() }))
    for (const m of r.members) {
      const w = m.type === 'way' && geom.get(m.ref)
      if (w?.geometry) e.ways.set(w.id, w.geometry.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]))
    }
  }
}
const features = []
for (const { net, ref, ways } of routes.values()) {
  const eu = net === 'icn'
  const props = { badge: eu ? 'eu' : net === 'ncn' ? 'red' : 'blue', label: eu ? ref.replace(/^EV/, '') : ref, order: order[net], ev: /^EV/.test(ref) }
  for (const coordinates of chain([...ways.values()])) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates } })
}
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(routes.size, 'routes,', features.length, 'lines:', [...routes.keys()].join(' '))
