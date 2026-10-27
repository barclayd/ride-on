// The prototype's one interactive map (SPEC §5.3, §6.2): MapLibre on the cycle map, every fixture route
// in one GeoJSON source, and route state through setFeatureState, never a data rewrite. Needs
// cyclemap.js (the loader and line helpers) and routes.js, loaded first.
// RideOnLive.mount(el, { pad, onHover(keys, x, y), onSelect(keys), onScrub(t), onReady() }) resolves to
// { set(state), fit(key, pad, ms), project(key, t) }. state: { colors: { key: '#hex' }, sel, hover,
// wind: [[t|c|h|l, from, to], …] as fractions or null, scrub: fraction or null }.
(() => {
  const before = 'roads_labels_minor'
  // Paint from feature state: c is the route's own colour and on says it has one (shortlisted, not
  // paused), dim fades everything but the selected route, sel is the selected route.
  const st = (k, d) => ['coalesce', ['feature-state', k], d]
  const on = st('on', false)
  const width = ['case', on, 4, 2]
  const casing = ['case', on, 7, 0]
  const opacity = ['case', st('dim', false), 0.35, 1]
  const sel = st('sel', false)
  const round = { 'line-join': 'round', 'line-cap': 'round' }
  const box = (cs, b) => cs.reduce((b, c) => b.extend(c), b)

  // Helmet scripts load in any order, so the other two are read here, not at load.
  const mount = async (el, opts) => {
    const { load, decode, measure, pointAt, cut, WIND, UNSCORED } = window.RideOnMap
    const routes = window.RIDE_ON_ROUTES.map((r) => {
      const cs = decode(r.line)
      return { key: r.id.slice(0, 8), cs, cum: measure(cs) }
    })
    const byKey = Object.fromEntries(routes.map((r) => [r.key, r]))
    const color = ['to-color', st('c', UNSCORED)]
    const { ml, style } = await load()
    const inner = el.appendChild(document.createElement('div'))
    inner.style.cssText = 'width:100%;height:100%'
    const all = () => routes.reduce((b, r) => box(r.cs, b), new ml.LngLatBounds())
    const map = new ml.Map({
      container: inner,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: structuredClone(style),
      bounds: all(),
      fitBoundsOptions: { padding: opts.pad },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
      transformRequest: (url) => (url.includes('/sprite.') ? { url: url.replace('/sprite.', '/sprite@2x.') } : { url }),
    })
    map.touchZoomRotate.disableRotation()
    map.on('error', (e) => console.warn('[live]', e.error?.message || e))
    new ResizeObserver(() => map.resize()).observe(el)
    await new Promise((r) => map.once('load', r))

    map.addSource('routes', {
      type: 'geojson',
      promoteId: 'id',
      data: { type: 'FeatureCollection', features: routes.map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.cs }, properties: { id: r.key } })) },
    })
    // routes-hit is 22px and invisible, so thin lines are easy to hover and tap.
    map.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', layout: round, paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 } }, before)
    map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: round, paint: { 'line-color': '#fff', 'line-width': casing, 'line-opacity': opacity } }, before)
    map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: round, paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity } }, before)
    // The hovered and selected routes again, on top: +2px when hovered, 6px when selected.
    const none = ['in', ['get', 'id'], ['literal', []]]
    map.addLayer({ id: 'top-casing', type: 'line', source: 'routes', filter: none, layout: round, paint: { 'line-color': '#fff', 'line-width': ['case', sel, 9, on, ['+', casing, 2], 0] } }, before)
    map.addLayer({ id: 'top-line', type: 'line', source: 'routes', filter: none, layout: round, paint: { 'line-color': color, 'line-width': ['case', sel, 6, ['+', width, 2]] } }, before)
    const empty = { type: 'FeatureCollection', features: [] }
    map.addSource('wind', { type: 'geojson', data: empty })
    map.addLayer({ id: 'wind-casing', type: 'line', source: 'wind', layout: round, paint: { 'line-color': '#fff', 'line-width': 9 } }, before)
    map.addLayer({ id: 'wind', type: 'line', source: 'wind', layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'c'], 'line-width': 6 } }, before)
    map.addSource('marks', { type: 'geojson', data: empty })
    map.addLayer({ id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'c'], 'circle-stroke-color': ['get', 'sc'], 'circle-stroke-width': 3 } })

    let last = {}
    const keysAt = (p) => [...new Set(map.queryRenderedFeatures([[p.x - 1, p.y - 1], [p.x + 1, p.y + 1]], { layers: ['routes-hit'] }).map((f) => f.properties.id))]
    // The fraction of the way round the selected route nearest a screen point, for scrubbing from the map.
    const nearest = (key, p) => {
      const { cs, cum } = byKey[key]
      let best = Infinity, t = 0, a = map.project(cs[0])
      for (let i = 1; i < cs.length; i++) {
        const b = map.project(cs[i])
        const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy
        const k = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0
        const d = Math.hypot(a.x + k * dx - p.x, a.y + k * dy - p.y)
        if (d < best) [best, t] = [d, cum[i - 1] + k * (cum[i] - cum[i - 1])]
        a = b
      }
      return t
    }
    map.on('mousemove', (e) => {
      const keys = keysAt(e.point)
      map.getCanvas().style.cursor = keys.length ? 'pointer' : ''
      opts.onHover(keys, e.point.x, e.point.y)
      if (last.sel && keys.includes(last.sel)) opts.onScrub(nearest(last.sel, e.point))
    })
    map.getCanvas().addEventListener('mouseleave', () => opts.onHover([], 0, 0))
    map.on('click', (e) => {
      const keys = keysAt(e.point)
      if (keys.length) opts.onSelect(keys)
    })
    map.once('idle', () => opts.onReady?.())

    return {
      map,
      set(next) {
        const key = JSON.stringify(next)
        if (key === last.key) return
        const { colors, sel: chosen, hover, wind, scrub } = next
        for (const r of routes)
          map.setFeatureState({ source: 'routes', id: r.key }, { c: colors[r.key] || UNSCORED, on: !!colors[r.key], dim: !!chosen && chosen !== r.key, sel: chosen === r.key })
        const top = ['in', ['get', 'id'], ['literal', [hover, chosen].filter(Boolean)]]
        map.setFilter('top-casing', top)
        map.setFilter('top-line', top)
        const r = byKey[chosen]
        // Wind view (SPEC §6.8): the selected line redrawn stretch by stretch, and the start marker goes dark.
        // ponytail: no return offset where a road is ridden twice; add it when a fixture overlaps itself.
        map.getSource('wind').setData({ type: 'FeatureCollection', features: r && wind ? wind.map(([k, a, b]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: cut(r.cs, r.cum, a, b) }, properties: { c: WIND[k] } })) : [] })
        const marks = !r ? [] : [{ p: r.cs[0], r: 7, c: wind ? '#1c1c1e' : colors[chosen] || UNSCORED, sc: '#fff' }]
        if (r && scrub != null) marks.push({ p: pointAt(r.cs, r.cum, scrub), r: 8, c: '#fff', sc: '#1c1c1e' })
        map.getSource('marks').setData({ type: 'FeatureCollection', features: marks.map(({ p, ...props }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: props })) })
        last = { ...next, key }
      },
      fit(key, pad, duration = 700) {
        map.fitBounds(key ? box(byKey[key].cs, new ml.LngLatBounds()) : all(), { padding: pad, duration, maxZoom: 14 })
      },
      // Screen point a fraction of the way round a route (the guide's hover demo).
      project(key, t) {
        const { cs, cum } = byKey[key]
        return map.project(pointAt(cs, cum, t))
      },
    }
  }

  window.RideOnLive = { mount }
})()
