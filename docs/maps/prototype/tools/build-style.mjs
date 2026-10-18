// Builds a cycle.travel-flavoured MapLibre style over the Protomaps basemap.
import { writeFileSync } from 'node:fs'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { shot } from './shot.mjs'

const [out, origin] = process.argv.slice(2)

// Colours sampled from cycle.travel screenshots and its map key (/map/snippet_key). Route colours are tuned by
// opacity against screenshots, so they stay as they are; everything sampled goes through shot().
// Known issue (see ../cycle-travel-style.md, "Colour sampling"): the map-key values (motorway…footpath) are already
// what cycle.travel draws, so shot() double-corrects them, and shot() itself lightens greys. Fix in WS2, not here:
// the comparison screenshots were taken with the style as it is.
const ct = {
  ...Object.fromEntries(Object.entries({
    land: '#eef2e1', urban: '#dde0d0', urbanMid: '#e5e9d8', urbanHigh: '#e8e4e4', park: '#d8e7cf', wood: '#d2e3c6', scrub: '#e2ecd6',
    water: '#aecad0', building: '#d9d2cf', rail: '#9a9a99', casing: '#a3a3a3',
    motorway: '#73bded', trunk: '#c0c8ae', primary: '#f7bda7', secondary: '#fdd5a5', tertiary: '#fff5d0', minor: '#ffffff',
    cycleway: '#dd4c18', footpath: '#99bb2e', text: '#222222', subtext: '#4a4a4a', halo: '#ffffff',
  }).map(([k, v]) => [k, shot(v)])),
  ncn: '#ff0000', rcn: '#0000ff', lcn: '#008b8b', eurovelo: '#00559d',
}

const flavour = {
  ...namedFlavor('light'),
  background: ct.land, earth: ct.land,
  park_a: ct.park, park_b: ct.park, wood_a: ct.wood, wood_b: ct.wood, scrub_a: ct.scrub, scrub_b: ct.scrub,
  hospital: '#ebdedb', school: '#ebe6d6', industrial: '#e3dfdc', pedestrian: '#eeeeea', zoo: ct.park,
  military: '#e3dfdc', aerodrome: '#e0e2da', beach: '#f2ecd2', sand: '#f2ecd2', glacier: '#ffffff',
  water: ct.water, buildings: ct.building, pier: '#e6e6e6',
  minor_a: ct.minor, minor_b: ct.minor, minor_service: ct.minor, other: ct.minor,
  minor_casing: ct.casing, minor_service_casing: '#a8a8a8',
  major: ct.secondary, link: ct.secondary, highway: ct.motorway,
  major_casing_early: ct.casing, major_casing_late: '#6e6e6e', link_casing: '#6e6e6e',
  highway_casing_early: '#444444', highway_casing_late: '#444444',
  bridges_major: ct.secondary, bridges_highway: ct.motorway, bridges_link: ct.secondary, bridges_minor: ct.minor, bridges_other: ct.minor,
  bridges_major_casing: '#555555', bridges_highway_casing: '#444444', bridges_link_casing: '#555555', bridges_minor_casing: '#777777', bridges_other_casing: '#777777',
  tunnel_major: '#f3e5da', tunnel_highway: '#c4dff2', tunnel_link: '#f3e5da', tunnel_minor: '#f4f4f4', tunnel_other: '#f4f4f4',
  railway: ct.rail, boundaries: '#a493b0',
  city_label: ct.text, city_label_halo: ct.halo, subplace_label: ct.subtext, subplace_label_halo: ct.halo,
  state_label: '#666666', state_label_halo: ct.halo, country_label: '#666666',
  roads_label_major: ct.subtext, roads_label_major_halo: ct.halo, roads_label_minor: '#555555', roads_label_minor_halo: ct.halo,
  ocean_label: '#5d8a94', address_label: '#777777', address_label_halo: ct.halo,
  regular: 'Montserrat Regular', bold: 'Montserrat SemiBold', italic: 'Montserrat Italic',
}

// A layer of Ride On's cycling overlay (maps/tiles): routes, route_badges, paths, cycle_lanes, pois.
const cycling = (layer) => ({ source: 'cycling', 'source-layer': layer })

// Road fill by OSM class, from cycle.travel's key.
const roadColour = ['match', ['get', 'kind_detail'], 'trunk', ct.trunk, 'primary', ct.primary, 'secondary', ct.secondary, 'tertiary', ct.tertiary, ct.tertiary]
const montserrat = (w) => ['literal', [`Montserrat ${w}`]]
const kd = ['get', 'kind_detail']
const byClass = (big, mid, small) => ['match', kd, ['trunk', 'primary'], big, 'secondary', mid, small]
// cycle.travel keeps A/B roads readable as colour well before the minor network appears.
const majorWidth = ['interpolate', ['exponential', 1.6], ['zoom'], 7, 0.4, 9, 1, 10, byClass(2.2, 1.6, 1), 12, byClass(3.2, 2.6, 2), 15, byClass(6, 5, 4), 18, byClass(16, 14, 12)]
const majorCasing = ['interpolate', ['linear'], ['zoom'], 9, 0, 9.5, 0.5, 12, 0.8, 16, 1.2]
const casingColour = ['interpolate', ['linear'], ['zoom'], 10, shot('#b8aea8'), 14, shot('#7a7a7a')]
const minorWidth = ['interpolate', ['exponential', 1.6], ['zoom'], 10, 0.3, 12, 0.7, 13, 1.3, 15, 2.5, 18, 11]

// Name-ending shortening as cycle.travel does it: only Street and Road; Lane, Way, Place, Hill… stay whole.
const abbreviate = (name) => ['let', 'n', name, ['let', 'l', ['length', ['var', 'n']],
  ['case',
    ['all', ['>', ['var', 'l'], 7], ['==', ['slice', ['var', 'n'], ['-', ['var', 'l'], 7]], ' Street']], ['concat', ['slice', ['var', 'n'], 0, ['-', ['var', 'l'], 7]], ' St'],
    ['all', ['>', ['var', 'l'], 5], ['==', ['slice', ['var', 'n'], ['-', ['var', 'l'], 5]], ' Road']], ['concat', ['slice', ['var', 'n'], 0, ['-', ['var', 'l'], 5]], ' Rd'],
    ['var', 'n']]]]

const dropped = new Set(['pois', 'roads_shields', 'roads_oneway', 'address_label', 'landcover'])
const base = layers('basemap', flavour, { lang: 'en' })
  .filter((l) => !dropped.has(l.id))
  .map((l) => {
    if (l.layout) for (const k of Object.keys(l.layout)) if (k.startsWith('icon-')) delete l.layout[k]
    if (['roads_major', 'roads_bridges_major', 'roads_tunnels_major'].includes(l.id)) Object.assign(l.paint, { 'line-color': roadColour, 'line-width': majorWidth })
    if (['roads_major_casing_early', 'roads_major_casing_late', 'roads_bridges_major_casing', 'roads_tunnels_major_casing'].includes(l.id))
      Object.assign(l.paint, { 'line-gap-width': majorWidth, 'line-width': majorCasing, 'line-color': casingColour })
    if (l.id === 'roads_minor') Object.assign(l.paint, { 'line-width': minorWidth, 'line-color': ['interpolate', ['linear'], ['zoom'], 11, shot('#b9b9b9'), 13, '#ffffff'] })
    if (l.id === 'roads_minor_casing') Object.assign(l.paint, { 'line-gap-width': minorWidth, 'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 0.6, 16, 1] })
    // cycle.travel draws paths itself (cycleways red/white, footpaths green dashes), so the plain path layer only keeps "other".
    if (l.id === 'roads_other') l.filter = ['all', ['!', ['has', 'is_tunnel']], ['!', ['has', 'is_bridge']], ['==', ['get', 'kind'], 'other'], ['!=', ['get', 'kind_detail'], 'pier']]
    if (l.id === 'places_locality') {
      // OSM place=locality (park gates, river reaches) gets its own small grey layer at street level (ct_localities).
      // cycle.travel has no City of Westminster label; the Westminster quarter (places_subplace) covers it.
      l.filter = ['all', ['==', ['get', 'kind'], 'locality'], ['!=', ['get', 'kind_detail'], 'locality'], ['!=', ['get', 'name'], 'City of Westminster']]
      const capital = ['>=', ['get', 'population_rank'], 10]
      const isTown = ['match', ['get', 'kind_detail'], ['town', 'city'], true, false]
      l.layout['text-font'] = ['case', capital, montserrat('Medium'), isTown, montserrat('Bold'), montserrat('Medium')]
      l.paint['text-color'] = ['case', capital, '#000000', isTown, shot('#242423'), shot('#333333')]
      l.layout['text-size'] = ['interpolate', ['linear'], ['zoom'],
        6, ['case', ['>=', ['get', 'population_rank'], 10], 13, 10],
        10, ['case', ['>=', ['get', 'population_rank'], 10], 17, ['<=', ['get', 'min_zoom'], 9], 14, 12],
        14, ['case', ['>=', ['get', 'population_rank'], 10], 16, 15]]
      const town = ['match', ['get', 'kind_detail'], ['town', 'city'], true, false]
      // cycle.travel: mixed case to its z12 (our 11), then towns in letter-spaced capitals; LONDON spreads wide at street level.
      l.layout['text-transform'] = ['step', ['zoom'], 'none', 12, ['case', town, 'uppercase', 'none']]
      l.layout['text-letter-spacing'] = ['step', ['zoom'], 0, 12, ['case', town, 0.08, 0], 14, ['case', capital, 0.55, town, 0.08, 0]]
      // cycle.travel packs place names tightly; Protomaps' wide padding knocks out neighbours and route badges.
      l.layout['text-padding'] = 3
      l.paint['text-halo-width'] = 2
      l.paint['text-halo-blur'] = 0.5
    }
    if (l.id === 'places_subplace') {
      l.layout['text-transform'] = 'none'
      l.layout['text-letter-spacing'] = 0
      l.layout['text-font'] = montserrat('Medium')
      l.layout['text-padding'] = 3
      l.layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14]
      l.paint['text-color'] = ['match', ['get', 'kind'], 'macrohood', shot('#373836'), shot('#686966')]
      l.paint['text-halo-width'] = 1.5
    }
    if (l.id === 'places_region' || l.id === 'places_country') l.layout['text-font'] = montserrat('Medium')
    // Street names only from cycle.travel's z15 (our 14), dark grey, with its Street→St / Road→Rd shortening.
    if (l.id.startsWith('roads_labels')) {
      l.minzoom = 14
      Object.assign(l.layout, { 'text-size': 12, 'text-font': montserrat('Regular'), 'text-field': abbreviate(['coalesce', ['get', 'name:en'], ['get', 'name'], '']) })
      Object.assign(l.paint, { 'text-color': shot('#343434'), 'text-halo-width': 1.5 })
    }
    // Rivers: slate italic, widely spaced, no halo, from cycle.travel's z13 (our 12).
    if (l.id === 'water_waterway_label') {
      l.minzoom = 12
      Object.assign(l.layout, { 'text-font': montserrat('Italic'), 'text-letter-spacing': 0.25 })
      Object.assign(l.paint, { 'text-color': shot('#65707a'), 'text-halo-width': 0 })
    }
    if (l.id === 'water_label_lakes') {
      l.layout['text-font'] = montserrat('Italic')
      Object.assign(l.paint, { 'text-color': shot('#65707a'), 'text-halo-width': 0 })
    }
    return l
  })

const width = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops]
// A/B road numbers: small grey italics from cycle.travel's z11 (our 10).
const roadRefs = { id: 'ct_road_refs', type: 'symbol', source: 'basemap', 'source-layer': 'roads', minzoom: 10,
  filter: ['all', ['has', 'ref'], ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]], ['in', kd, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]]],
  layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': ['get', 'ref'], 'text-font': montserrat('Italic'),
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 10.5], 'text-padding': 20 },
  paint: { 'text-color': shot('#686766'), 'text-halo-color': '#ffffff', 'text-halo-width': 1 } }

// Point labels cycle.travel adds at street level (its z15, our 14), coloured by what they are.
// cycle.travel names far fewer of these than Protomaps carries: roughly a zoom later than Protomaps' own min_zoom.
const poiKind = (kinds) => ['all', ['in', ['get', 'kind'], ['literal', kinds]], ['<=', ['get', 'min_zoom'], ['-', ['zoom'], 1]]]
const pointLabel = (size, font, maxWidth = 7) => ({ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': montserrat(font), 'text-size': size, 'text-max-width': maxWidth, 'text-line-height': 1.1, 'text-padding': 4 })
const halo = (colour) => ({ 'text-color': colour, 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 })
const labels = [
  // Later entries win collisions: landmarks give way to localities, localities to parks (St James's Park beats Pelican Rock).
  // Churches and abbeys (Protomaps sets kind_detail to the religion) stay unnamed, as on cycle.travel.
  { id: 'ct_landmarks', type: 'symbol', source: 'basemap', 'source-layer': 'pois', minzoom: 14,
    filter: ['all', poiKind(['attraction', 'museum', 'castle', 'palace', 'zoo', 'aquarium', 'theme_park']), ['!', ['has', 'kind_detail']]],
    layout: { ...pointLabel(11, 'SemiBold'), 'symbol-sort-key': ['get', 'min_zoom'] }, paint: halo(shot('#bb806d')) },
  { id: 'ct_localities', type: 'symbol', source: 'basemap', 'source-layer': 'places', minzoom: 14,
    filter: ['all', ['==', ['get', 'kind'], 'locality'], ['==', ['get', 'kind_detail'], 'locality']],
    layout: pointLabel(11, 'Medium'), paint: halo(shot('#686867')) },
  { id: 'ct_parks', type: 'symbol', source: 'basemap', 'source-layer': 'pois', minzoom: 14,
    filter: poiKind(['park', 'garden', 'nature_reserve', 'wood', 'forest', 'golf_course']),
    layout: { ...pointLabel(11.5, 'Medium Italic'), 'symbol-sort-key': ['get', 'min_zoom'] }, paint: halo(shot('#3c6633')) },
  // Protomaps only ships hills from tile z14, so these come from the cycling overlay (natural=peak|hill).
  { id: 'ct_peaks', type: 'symbol', ...cycling('pois'), minzoom: 12, filter: ['==', ['get', 'kind'], 'peak'],
    layout: pointLabel(11, 'Medium Italic', 6), paint: halo(shot('#754634')) },
  // Above or below the dot, sliding to a corner when that's taken (Charing Cross beside LONDON).
  { id: 'ct_stations_label', type: 'symbol', ...cycling('pois'), minzoom: 14, filter: ['==', ['get', 'kind'], 'station'],
    layout: { ...pointLabel(11, 'SemiBold', 8), 'text-variable-anchor': ['top', 'bottom', 'bottom-right', 'bottom-left', 'top-right', 'top-left'], 'text-radial-offset': 0.6 }, paint: halo(shot('#cd562d')) },
]
// National Rail stations as cycle.travel's orange dot. At its z11–12 it shows only a handful (no rule we can copy),
// so ours start with the full set at its z13 (our 12).
const stations = { id: 'ct_stations', type: 'circle', ...cycling('pois'), minzoom: 12, filter: ['==', ['get', 'kind'], 'station'],
  paint: { 'circle-color': shot('#cd562d'), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 2.6], 'circle-stroke-color': '#000000', 'circle-stroke-width': 0.9 } }
// Paths come from the cycling overlay (maps/tiles), which keeps the surface and bicycle tags the basemap drops:
// class is 'p' (paved, red and white), 'u' (unpaved, brown dashes) or 'foot' (other footpaths, green dashes).
const pathClass = (c) => ['==', ['get', 'class'], c]
// ~1.2px wide, 2px dashes every 7.3px at cycle.travel's z15.
const footpathPaint = { 'line-color': ct.footpath, 'line-width': width([14, 1.2, 18, 2.4]), 'line-dasharray': [1.7, 4.4] }
const paths = [
  { id: 'ct_footpaths', type: 'line', ...cycling('paths'), minzoom: 14, filter: pathClass('foot'), paint: footpathPaint },
  // Measured off cycle.travel @2x screenshots: ~1px wide, dashes ~5px long every ~8px at its z13–15.
  { id: 'ct_unpaved', type: 'line', ...cycling('paths'), minzoom: 12, filter: pathClass('u'),
    paint: { 'line-color': shot('#834a21'), 'line-width': width([12, 0.95, 15, 1.1, 18, 2]), 'line-dasharray': [5.5, 2.5] } },
  { id: 'ct_cycleways_casing', type: 'line', ...cycling('paths'), minzoom: 12, filter: pathClass('p'),
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ct.cycleway, 'line-width': width([12, 2.2, 15, 4.5, 18, 10]) } },
  { id: 'ct_cycleways', type: 'line', ...cycling('paths'), minzoom: 12, filter: pathClass('p'),
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': width([12, 0.9, 15, 2.2, 18, 6]) } },
]

// Cycle network relations (the overlay's routes layer), drawn as cycle.travel's dotted lines: [colour, 5px, dash 0.1/9, round cap].
const net = ['get', 'network']
const minzoomFor = ['get', 'minz']
const visible = ['>=', ['zoom'], minzoomFor]
// Measured off cycle.travel @2x screenshots: dots stay ~6.5–7.5px across from z10 up, centres 15–20px apart,
// so the gap (in line widths) opens up as you zoom in.
const dotStops = [6, 3.5, 8, 5, 10, 6.5, 12, 7, 14, 7, 18, 8.5]
const dotWidth = width(dotStops)
const dotGap = (scale = 1) => ['step', ['zoom'], ['literal', [0, 2.3 / scale]], 11, ['literal', [0, 2.6 / scale]], 13, ['literal', [0, 2.9 / scale]]]
const routes = [
  { id: 'ct_routes_eurovelo_ring', type: 'line', ...cycling('routes'), filter: ['all', ['==', net, 'icn'], visible],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ct.eurovelo, 'line-opacity': 0.85, 'line-width': width(dotStops.map((v, i) => (i % 2 ? v * 1.4 : v))), 'line-dasharray': dotGap(1.4) } },
  { id: 'ct_routes', type: 'line', ...cycling('routes'), filter: visible,
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'rank'] },
    paint: { 'line-color': ['match', net, 'icn', ct.ncn, 'ncn', ct.ncn, 'rcn', ct.rcn, ct.lcn], 'line-opacity': ['step', ['zoom'], ['match', net, 'rcn', 0.45, 0.62], 11, 0.62], 'line-width': dotWidth, 'line-dasharray': dotGap() } },
]

// cycle.travel's repeater badges: upright, every ~160px along the route, from its z12 (our 11). Red for national,
// blue for regional/London; boxes are 11.5px tall and 15/20/25px wide for 1/2/3 characters.
// EuroVelo shows as a starred navy square only at our z11; from z12 the Avenue Verte turns red and EVs drop out.
const badge = ['get', 'badge']
// No symbol-sort-key: with line placement it drops the box from some badges (MapLibre draws the number alone),
// so priority comes from layer order instead.
const badgeLayout = (extra) => ({ 'symbol-placement': 'line', 'symbol-spacing': 160, 'text-max-angle': 180,
  'text-field': ['get', 'label'], 'text-font': montserrat('Bold'), 'text-size': 8.5, 'text-letter-spacing': 0.04,
  'text-rotation-alignment': 'viewport', 'text-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport',
  'text-keep-upright': false, 'text-padding': 2, 'icon-padding': 2, ...extra })
const fit = { 'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 4.5, 0.5, 4.5] }
const badges = [
  { id: 'ct_route_badges_rcn', type: 'symbol', ...cycling('route_badges'), minzoom: 11, filter: ['==', badge, 'blue'],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-blue' }), paint: { 'text-color': '#ffffff' } },
  { id: 'ct_route_badges', type: 'symbol', ...cycling('route_badges'), minzoom: 11, filter: ['==', badge, 'red'],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-red' }), paint: { 'text-color': '#ffffff' } },
  { id: 'ct_route_badges_icn', type: 'symbol', ...cycling('route_badges'), minzoom: 12, filter: ['all', ['==', badge, 'eu'], ['!', ['get', 'ev']]],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-red' }), paint: { 'text-color': '#ffffff' } },
  { id: 'ct_route_badges_eu', type: 'symbol', ...cycling('route_badges'), minzoom: 11, maxzoom: 12, filter: ['==', badge, 'eu'],
    layout: badgeLayout({ 'icon-image': 'badge-eu', 'symbol-spacing': 220, 'text-size': 7.5 }), paint: { 'text-color': '#ffffff' } },
]

const urban = { id: 'ct_urban', type: 'fill', source: 'basemap', 'source-layer': 'landuse',
  filter: ['in', ['get', 'kind'], ['literal', ['residential', 'commercial', 'retail', 'railway', 'industrial']]],
  // cycle.travel's built-up fill steps with its tile zoom: grey-green, then paler green at its z12–13, then pinkish grey.
  paint: { 'fill-color': ['step', ['zoom'], ct.urban, 11, ct.urbanMid, 13, ct.urbanHigh] } }
const greens = { id: 'ct_greens', type: 'fill', source: 'basemap', 'source-layer': 'landuse',
  filter: ['in', ['get', 'kind'], ['literal', ['recreation_ground', 'pitch', 'grass', 'meadow', 'village_green', 'garden', 'dog_park', 'playground']]],
  paint: { 'fill-color': ct.scrub } }

const all = [...base]
const at = (id) => all.findIndex((l) => l.id === id)
all.splice(at('landuse_park'), 0, urban, greens)
all.splice(at('roads_rail'), 0, ...paths)
all.splice(at('roads_labels_minor'), 0, ...routes, stations)
all.splice(at('roads_labels_major') + 1, 0, roadRefs)
// Later layers win label collisions: badges beat point labels, EuroVelo beats national beats regional.
all.splice(at('places_subplace'), 0, ...labels, ...badges)

const font = (file) => [{ url: `${origin}/fonts/${file}.woff2` }]
const style = {
  version: 8,
  name: 'Ride On — cycle.travel-ish prototype',
  'font-faces': {
    'Montserrat Medium': font('montserrat-latin-500-normal'),
    'Montserrat SemiBold': font('montserrat-latin-600-normal'),
    'Montserrat Bold': font('montserrat-latin-700-normal'),
    'Montserrat Regular': font('montserrat-latin-400-normal'),
    'Montserrat Italic': font('montserrat-latin-400-italic'),
    'Montserrat Medium Italic': font('montserrat-latin-500-italic'),
    'Montserrat SemiBold Italic': font('montserrat-latin-600-italic'),
  },
  sources: {
    basemap: { type: 'vector', url: `pmtiles://${origin}/world.pmtiles`, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>' },
    cycling: { type: 'vector', url: `pmtiles://${origin}/data/cycling.pmtiles`, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' },
  },
  layers: all,
}
writeFileSync(out, JSON.stringify(style))
console.log(all.length, 'layers')
