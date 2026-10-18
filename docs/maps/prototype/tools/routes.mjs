import { readFileSync, writeFileSync } from 'node:fs'
const [out, ...inputs] = process.argv.slice(2)
const rank = { icn: 4, ncn: 3, rcn: 2, lcn: 1 }
const ways = new Map()
for (const file of inputs) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (data.remark) console.error(file, data.remark)
  const rels = data.elements.filter(e => e.type === 'relation')
  const geom = new Map(data.elements.filter(e => e.type === 'way').map(w => [w.id, w]))
  for (const r of rels) {
    const net = r.tags.network
    const ref = r.tags.ref ?? ''
    // cycle.travel holds back London's TfL network (tagged rcn) until you zoom into the city,
    // and the unsigned parts of it (no C/Q number) plus local routes until street level.
    const london = /^GB:London/.test(r.tags.cycle_network ?? '')
    const minz = net === 'lcn' ? 13 : net === 'rcn' ? (london ? (ref ? 11 : 13) : 8.5) : 6
    for (const m of r.members) {
      if (m.type !== 'way') continue
      const w = geom.get(m.ref)
      if (!w?.geometry) continue
      let e = ways.get(w.id)
      if (!e) ways.set(w.id, e = { rank: 0, minz: 99, refs: new Set(), coords: w.geometry.map(p => [+p.lon.toFixed(5), +p.lat.toFixed(5)]), highway: w.tags?.highway ?? '' })
      e.rank = Math.max(e.rank, rank[net] ?? 0)
      e.minz = Math.min(e.minz, minz)
      if (ref && (net === 'ncn' || net === 'icn' || net === 'rcn')) e.refs.add(ref)
    }
  }
}
const names = ['', 'lcn', 'rcn', 'ncn', 'icn']

// MapLibre restarts a dash pattern at the start of every feature, so short OSM ways leave dots bunched at
// each join. Chain ways that share an endpoint (same network, zoom and shields) into long lines first.
const groups = new Map()
for (const e of ways.values()) {
  const props = { network: names[e.rank], rank: e.rank, minz: e.minz, ref: [...e.refs].sort().slice(0, 2).join(' ') }
  const key = JSON.stringify(props)
  if (!groups.has(key)) groups.set(key, { props, lines: [] })
  groups.get(key).lines.push(e.coords)
}
const pt = (c) => c.join(',')
const features = []
for (const { props, lines } of groups.values()) {
  const byEnd = new Map()
  lines.forEach((l, i) => { for (const c of [l[0], l.at(-1)]) (byEnd.get(pt(c)) ?? byEnd.set(pt(c), []).get(pt(c))).push(i) })
  const used = new Uint8Array(lines.length)
  const take = (c) => {
    const i = (byEnd.get(pt(c)) ?? []).find((j) => !used[j])
    if (i === undefined) return null
    used[i] = 1
    return pt(lines[i][0]) === pt(c) ? lines[i] : [...lines[i]].reverse()
  }
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let chain = [...lines[i]], next
    while ((next = take(chain.at(-1)))) chain.push(...next.slice(1))
    while ((next = take(chain[0]))) chain = [...next.reverse(), ...chain.slice(1)]
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: chain } })
  }
}
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
const counts = features.reduce((a, f) => (a[f.properties.network] = (a[f.properties.network] ?? 0) + 1, a), {})
console.log(features.length, counts)
