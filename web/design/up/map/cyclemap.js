// Ride On's cycle map for the design files: MapLibre 6 on the app's bundled style (pinned on
// jsDelivr), the tiles on maps.ride-on.cc and the fixture routes in ./routes.js.
// Markup: <div data-map="home|paused|detail|empty" data-selected="6b8b1863" data-pad="72 40 140 416"></div>
// (pad is top right bottom left, the visible map inside the glass), then RideOnMap.mountAll().
// Detail extras: data-scrub="31" (km, the profile's dot), data-wind="c:0-5,h:5-19" (km stretches:
// t tailwind, c crosswind, h headwind, l light). Home: data-hover="c93c3293@0.3" thickens that line and
// sets --hx/--hy on the frame to the pixel that far round it, for the glance card. data-scores="4e5ad57f:70"
// overrides scores (a preference change re-ranking). Empty: no routes, the GB overview.
(() => {
  const SHA = '9c92c15dee9d71654b5479ea54c9e20dec21d82d'
  const ASSETS = `https://cdn.jsdelivr.net/gh/barclayd/ride-on@${SHA}/app/Packages/Features/Sources/SharedUI/CycleMap`
  const ML = 'https://unpkg.com/maplibre-gl@6.11.2/dist'
  // Map lines keep the light band colours in Dark Mode while the map stays light (SPEC §6.6).
  const BAND = { great: '#248a3d', good: '#6b8a00', fair: '#b26a00', notrec: '#76767b' }
  const UNSCORED = '#8e8e93'
  const WIND = { t: '#248a3d', c: '#e8a100', h: '#c93400', l: '#8e8e93' }
  // The Sat 24 Oct scenario (SPEC §13): shortlist scores. No score = library or doesn't fit.
  const SCORES = { '6b8b1863': 84, '4e5ad57f': 79, c93c3293: 76, '1eaf3c4f': 71, b070c882: 68, '9e2b57c8': 66, c5b155ac: 63, e8d1896c: 61, c8377ae3: 57, fdbf61dc: 52, bcb8871c: 44 }
  const GB = [[-8.2, 49.9], [1.8, 58.7]]
  const band = (s) => (s >= 75 ? 'great' : s >= 60 ? 'good' : s >= 50 ? 'fair' : 'notrec')

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

  // Fraction of the way round at each vertex (equirectangular: plenty at this size), then a point or a
  // stretch by fraction.
  const measure = (cs) => {
    const cum = [0]
    for (let i = 1; i < cs.length; i++) {
      const [x0, y0] = cs[i - 1], [x1, y1] = cs[i]
      cum.push(cum[i - 1] + Math.hypot((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0))
    }
    return cum.map((d) => d / cum.at(-1))
  }
  const pointAt = (cs, cum, t) => {
    const i = Math.max(1, cum.findIndex((d) => d >= t))
    const k = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return [cs[i - 1][0] + k * (cs[i][0] - cs[i - 1][0]), cs[i - 1][1] + k * (cs[i][1] - cs[i - 1][1])]
  }
  const cut = (cs, cum, a, b) => [pointAt(cs, cum, a), ...cs.filter((_, i) => cum[i] > a && cum[i] < b), pointAt(cs, cum, b)]
  const routeKm = (key) => window.RIDE_ON_ROUTES.find((r) => r.id.startsWith(key)).km

  let lib
  const load = () => (lib ??= (async () => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${ML}/maplibre-gl.css`
    document.head.append(css)
    if (!window.pmtiles)
      await new Promise((res, rej) => {
        const s = document.createElement('script')
        s.src = 'https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js'
        s.onload = res
        s.onerror = rej
        document.head.append(s)
      })
    const ml = await import(`${ML}/maplibre-gl.mjs`)
    // A same-origin module wrapper, so the worker can come from unpkg.
    ml.setWorkerUrl(URL.createObjectURL(new Blob([`import '${ML}/maplibre-gl-worker.mjs'`], { type: 'text/javascript' })))
    ml.addProtocol('pmtiles', new pmtiles.Protocol().tile)
    const style = await (await fetch(`${ASSETS}/style.json`)).json()
    style.sprite = `${ASSETS}/sprite`
    style.glyphs = `${ASSETS}/glyphs/{fontstack}/{range}.pbf`
    // The basemap is a GB extract: past its edge the land-coloured background would read as land, so
    // paint it sea. The earth layer still draws the land inside. ponytail: belongs in maps/style once agreed.
    style.layers.find((l) => l.type === 'background').paint['background-color'] = style.layers.find((l) => l.id === 'water').paint['fill-color']
    return { ml, style }
  })())

  const routeFeatures = (state, selected, hover, scores) =>
    (state === 'empty' ? [] : window.RIDE_ON_ROUTES).map((r) => {
      const key = r.id.slice(0, 8)
      const score = state === 'paused' ? undefined : scores[key]
      const scored = score !== undefined
      const sel = key === selected
      const hov = key === hover
      const w = sel ? 6 : !scored ? 2 : band(score) === 'notrec' ? 2.5 : hov ? 6 : 4
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: decode(r.line) },
        properties: {
          id: key,
          c: scored ? BAND[band(score)] : UNSCORED,
          w,
          cw: scored ? w + (band(score) === 'notrec' ? 2 : 3) : 0,
          o: selected && !sel ? 0.35 : 1,
          z: sel ? 1000 : hov ? 999 : scored ? score : 0,
        },
      }
    })

  const mount = async (el) => {
    if (el.dataset.mounted) return
    el.dataset.mounted = 'loading'
    const { ml, style } = await load()
    const state = el.dataset.map
    const selected = el.dataset.selected
    const [top, right, bottom, left] = (el.dataset.pad || '0 0 0 0').split(' ').map(Number)
    const [hover, hoverAt] = (el.dataset.hover || '').split('@')
    const scores = { ...SCORES, ...Object.fromEntries((el.dataset.scores || '').split(',').filter(Boolean).map((s) => s.split(':')).map(([k, v]) => [k, +v])) }
    const features = routeFeatures(state, selected, hover, scores)
    const coordsOf = (key) => features.find((f) => f.properties.id === key)?.geometry.coordinates
    const fit = features.filter((f) => (selected ? f.properties.id === selected : true))
    const bounds = state === 'empty' ? new ml.LngLatBounds(...GB) : new ml.LngLatBounds()
    for (const f of fit) for (const c of f.geometry.coordinates) bounds.extend(c)

    // MapLibre forces position: relative on its container, so it gets an inner box and el keeps its own layout.
    const box = el.appendChild(document.createElement('div'))
    box.style.cssText = 'width:100%;height:100%'
    const map = new ml.Map({
      container: box,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: structuredClone(style),
      bounds,
      fitBoundsOptions: { padding: { top, right, bottom, left } },
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      transformRequest: (url) =>
        url.startsWith(`${ASSETS}/sprite.`) ? { url: url.replace('/sprite.', '/sprite@2x.') } : { url },
    })
    el._map = map
    map.on('load', () => {
      const before = 'roads_labels_minor'
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } })
      const line = { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'z'] }
      map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: ['>', ['get', 'cw'], 0], layout: line, paint: { 'line-color': '#fff', 'line-width': ['get', 'cw'], 'line-opacity': ['get', 'o'] } }, before)
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: line, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'] } }, before)
      if (selected) {
        const f = features.find((x) => x.properties.id === selected)
        const cs = f.geometry.coordinates
        const cum = measure(cs)
        const km = routeKm(selected)
        // Wind view (SPEC §6.8): the selected line redrawn stretch by stretch over its band colour.
        // ponytail: no return offset where a road is ridden twice; add it when a fixture overlaps itself.
        if (el.dataset.wind) {
          const stretches = el.dataset.wind.split(',').map((s) => s.split(/[:-]/))
          map.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: stretches.map(([k, a, b]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: cut(cs, cum, a / km, b / km) }, properties: { c: WIND[k] } })) } })
          map.addLayer({ id: 'wind-casing', type: 'line', source: 'wind', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } }, before)
          map.addLayer({ id: 'wind', type: 'line', source: 'wind', layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'c'], 'line-width': 6 } }, before)
        }
        map.addSource('start', { type: 'geojson', data: { type: 'Point', coordinates: cs[0] } })
        map.addLayer({ id: 'start', type: 'circle', source: 'start', paint: { 'circle-radius': 7, 'circle-color': el.dataset.wind ? '#1c1c1e' : f.properties.c, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
        if (el.dataset.scrub) {
          map.addSource('scrub', { type: 'geojson', data: { type: 'Point', coordinates: pointAt(cs, cum, el.dataset.scrub / km) } })
          map.addLayer({ id: 'scrub', type: 'circle', source: 'scrub', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-color': '#1c1c1e', 'circle-stroke-width': 3 } })
        }
      }
      if (hover) {
        const cs = coordsOf(hover)
        const [x, y] = Object.values(map.project(pointAt(cs, measure(cs), +hoverAt)))
        el.parentElement.style.setProperty('--hx', `${x}px`)
        el.parentElement.style.setProperty('--hy', `${y}px`)
      }
      map.once('idle', () => (el.dataset.mounted = 'idle'))
    })
    map.on('error', (e) => console.warn('[cyclemap]', e.error?.message || e))
  }

  window.RideOnMap = {
    mountAll: (root = document) => Promise.all([...root.querySelectorAll('[data-map]')].map(mount)),
    // Shared with the prototype's live map (live.js).
    load, decode, measure, pointAt, cut, band, BAND, WIND, UNSCORED,
  }
})()
