// Ride On's cycle map style: the Protomaps basemap recoloured to cycle.travel, plus the cycling overlay
// (maps/tiles). Every rule here is described, with its reasons, in docs/maps/cycle-travel-style.md.
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { dots, networks } from './dots.ts'
import { shot } from './shot.ts'

/** Where the style's URLs point. */
export interface Target {
  /** Glyph PBFs, with `{fontstack}` and `{range}`. */
  glyphs: string
  /** The sprite sheet (src/sprite.ts), without `@2x.json` or `@2x.png`. */
  sprite: string
  /** The directory holding the tile archives, without a trailing slash. */
  tiles: string
}

/** The R2 keys the style reads (maps/hosting). Keys are immutable: a new build is a new key. */
export const archives = {
  basemap: 'basemap-gb-20261017.pmtiles',
  cycling: 'cycling-gb-20261017.pmtiles',
}

/** Montserrat faces. Each is a glyph PBF directory (scripts/glyphs.sh), named after its TTF file. */
export const faces = ['Regular', 'Italic', 'Medium', 'MediumItalic', 'SemiBold', 'Bold'] as const
type Face = (typeof faces)[number]
const fontstack = (face: Face) => `Montserrat-${face}`
const montserrat = (face: Face) => ['literal', [fontstack(face)]]

type Expression = unknown
interface Layer {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
  filter?: Expression
  layout?: Record<string, Expression>
  paint?: Record<string, Expression>
}

// cycle.travel's colours (docs/maps/cycle-travel-style.md, "Palette"). Its map key (/map/snippet_key) gives the
// values it draws, so those are used as they are.
const key = {
  motorway: '#73bded',
  trunk: '#c0c8ae',
  primary: '#f7bda7',
  secondary: '#fdd5a5',
  tertiary: '#fff5d0',
  minor: '#ffffff',
  cycleway: '#dd4c18',
  // Stations too: their dot samples exactly as a #dd4c18 swatch does.
  station: '#dd4c18',
  footpath: '#99bb2e',
  // The key's gravel cycleway: the unpaved dashes sample as #8b451e, next to it.
  unpaved: '#8b4513',
  halo: '#ffffff',
}
// Everything else was sampled off screenshots, which aren't the colours the page drew; shot() undoes the capture.
const sampled = {
  land: '#eef2e1',
  urban: '#dde0d0',
  urbanMid: '#e5e9d8',
  urbanHigh: '#e8e4e4',
  // Re-sampled in WS2.5 under our park, wood, golf, cemetery, pitch and pedestrian fills in Richmond and
  // Westminster at cycle.travel's z14–16.
  park: '#eaf2d9',
  wood: '#d5e4c9',
  golf: '#e2efd7',
  cemetery: '#d7ded3',
  pitch: '#deedd3',
  pedestrian: '#fcfbf5',
  // Re-sampled in WS2.2: cycle.travel's colour under our water in every comparison view that has water.
  water: '#b3c9cf',
  // Buildings are filled as built-up land; only this faint edge shows them.
  building: '#d2cbc8',
  // Military land's red edge.
  military: '#e44c43',
  // Railways: a grey line with a white dashed core (ct_rail_core).
  rail: '#9a9a99',
  casing: '#a3a3a3',
  majorCasingLow: '#b8aea8',
  majorCasingHigh: '#7a7a7a',
  minorLow: '#b9b9b9',
  text: '#222222',
  subtext: '#4a4a4a',
  town: '#242423',
  village: '#333333',
  macrohood: '#373836',
  neighbourhood: '#686966',
  street: '#343434',
  waterLabel: '#65707a',
  roadRef: '#686766',
  landmark: '#bb806d',
  locality: '#686867',
  parkLabel: '#3c6633',
  peak: '#754634',
}
// The key's colours and the sampled ones (route dots are in src/dots.ts).
const ct = {
  ...key,
  ...(Object.fromEntries(Object.entries(sampled).map(([k, v]) => [k, shot(v)])) as Record<
    keyof typeof sampled,
    string
  >),
  // The pale band inside military land's edge: this red at 22%, solved after shot() from the band's capture over
  // land, since the page blends drawn colours, not captured ones.
  militaryBand: '#f01914',
  // Solved in WS2.5 (lines) against swatches captured alongside the comparison shots, not with shot(): that session
  // captured 3–12/255 darker than shot() predicts. Each draws to within 1/255 of cycle.travel's capture.
  // Motorways draw far paler than the key's swatch: this is their fill at cycle.travel's z10–15.
  motorwayPale: '#bed9e7',
}

const flavour = {
  ...namedFlavor('light'),
  background: ct.land,
  earth: ct.land,
  park_a: ct.park,
  park_b: ct.park,
  wood_a: ct.wood,
  wood_b: ct.wood,
  pedestrian: ct.pedestrian,
  zoo: ct.park,
  aerodrome: '#e0e2da',
  beach: '#f2ecd2',
  sand: '#f2ecd2',
  glacier: '#ffffff',
  water: ct.water,
  pier: '#e6e6e6',
  minor_a: ct.minor,
  minor_b: ct.minor,
  minor_service: ct.minor,
  other: ct.minor,
  minor_casing: ct.casing,
  minor_service_casing: '#a8a8a8',
  major: ct.secondary,
  link: ct.secondary,
  highway: ct.motorwayPale,
  major_casing_early: ct.casing,
  major_casing_late: '#6e6e6e',
  link_casing: '#6e6e6e',
  highway_casing_early: '#444444',
  highway_casing_late: '#444444',
  bridges_major: ct.secondary,
  bridges_highway: ct.motorwayPale,
  bridges_link: ct.secondary,
  bridges_minor: ct.minor,
  bridges_other: ct.minor,
  bridges_major_casing: '#555555',
  bridges_highway_casing: '#444444',
  bridges_link_casing: '#555555',
  bridges_minor_casing: '#777777',
  bridges_other_casing: '#777777',
  tunnel_major: '#f3e5da',
  tunnel_highway: '#c4dff2',
  tunnel_link: '#f3e5da',
  tunnel_minor: '#f4f4f4',
  tunnel_other: '#f4f4f4',
  railway: ct.rail,
  boundaries: '#a493b0',
  city_label: ct.text,
  city_label_halo: ct.halo,
  subplace_label: ct.subtext,
  subplace_label_halo: ct.halo,
  state_label: '#666666',
  state_label_halo: ct.halo,
  country_label: '#666666',
  roads_label_major: ct.subtext,
  roads_label_major_halo: ct.halo,
  roads_label_minor: '#555555',
  roads_label_minor_halo: ct.halo,
  ocean_label: '#5d8a94',
  address_label: '#777777',
  address_label_halo: ct.halo,
  regular: fontstack('Regular'),
  bold: fontstack('SemiBold'),
  italic: fontstack('Italic'),
}

// A layer of Ride On's cycling overlay (maps/tiles): routes, route_badges, paths, cycle_lanes, pois.
const cycling = (layer: string) => ({ source: 'cycling', 'source-layer': layer })

// Road fill by OSM class, from cycle.travel's key.
const roadColour = [
  'match',
  ['get', 'kind_detail'],
  'trunk',
  ct.trunk,
  'primary',
  ct.primary,
  'secondary',
  ct.secondary,
  'tertiary',
  ct.tertiary,
  ct.tertiary,
]
const kd = ['get', 'kind_detail']
const byClass = (big: number, mid: number, small: number) => [
  'match',
  kd,
  ['trunk', 'primary'],
  big,
  'secondary',
  mid,
  small,
]
// cycle.travel keeps A/B roads readable as colour well before the minor network appears.
const majorWidth = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  7,
  0.4,
  9,
  1,
  10,
  byClass(2.2, 1.6, 1),
  12,
  byClass(3.2, 2.6, 2),
  15,
  byClass(6, 5, 4),
  18,
  byClass(16, 14, 12),
]
const majorCasing = ['interpolate', ['linear'], ['zoom'], 9, 0, 9.5, 0.5, 12, 0.8, 16, 1.2]
const casingColour = ['interpolate', ['linear'], ['zoom'], 10, ct.majorCasingLow, 14, ct.majorCasingHigh]
// Motorways: pale blue, wider than A roads from our z9, with a thin casing that darkens from faint grey to black.
const motorwayWidth = ['interpolate', ['exponential', 1.6], ['zoom'], 6, 0.6, 9, 1.6, 11, 3, 12, 4.8, 15, 7, 18, 15]
const motorwayCasing = {
  'line-gap-width': motorwayWidth,
  'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 0.5, 11, 0.6],
  'line-color': ['interpolate', ['linear'], ['zoom'], 9, '#9aa0a4', 11, '#000000', 12, '#151719'],
}
const railway = ['all', ['==', ['get', 'kind'], 'rail'], ['!', ['has', 'is_tunnel']]]
const railStops = [6, 0.4, 9, 2.5, 10, 2.9, 12, 3.25, 14, 4, 18, 8]
const railWidth = [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  ...railStops.map((v, i) => (i % 2 ? ['case', ['has', 'service'], v / 2, v] : v)),
]
const minorWidth = ['interpolate', ['exponential', 1.6], ['zoom'], 10, 0.3, 12, 0.7, 13, 1.3, 15, 2.5, 18, 11]

// Name-ending shortening as cycle.travel does it: only Street and Road; Lane, Way, Place, Hill… stay whole.
const abbreviate = (name: Expression) => [
  'let',
  'n',
  name,
  [
    'let',
    'l',
    ['length', ['var', 'n']],
    [
      'case',
      ['all', ['>', ['var', 'l'], 7], ['==', ['slice', ['var', 'n'], ['-', ['var', 'l'], 7]], ' Street']],
      ['concat', ['slice', ['var', 'n'], 0, ['-', ['var', 'l'], 7]], ' St'],
      ['all', ['>', ['var', 'l'], 5], ['==', ['slice', ['var', 'n'], ['-', ['var', 'l'], 5]], ' Road']],
      ['concat', ['slice', ['var', 'n'], 0, ['-', ['var', 'l'], 5]], ' Rd'],
      ['var', 'n'],
    ],
  ],
]

// cycle.travel doesn't fill schools or hospitals: they show the land or built-up fill beneath. Allotments, village
// greens and playgrounds are bare land (ct_greens), and industrial land is built-up (ct_urban).
const dropped = new Set([
  'pois',
  'roads_shields',
  'roads_oneway',
  'address_label',
  'landcover',
  'landuse_urban_green',
  'landuse_hospital',
  'landuse_industrial',
  'landuse_school',
])

// cycle.travel's built-up fill steps with its tile zoom: grey-green, then paler green at its z12–13, then pinkish
// grey. Buildings take it too.
const urbanFill = ['step', ['zoom'], ct.urban, 11, ct.urbanMid, 13, ct.urbanHigh]
// Protomaps' landuse_park kinds that cycle.travel fills. It leaves scrub, grass and grassland as the land beneath,
// and outlines military land instead (ct_military).
const parkKinds = [
  'national_park',
  'park',
  'protected_area',
  'nature_reserve',
  'cemetery',
  'golf_course',
  'wood',
  'forest',
  'glacier',
  'sand',
]
const parkFill = [
  'match',
  ['get', 'kind'],
  ['wood', 'forest'],
  ct.wood,
  'golf_course',
  ct.golf,
  'cemetery',
  ct.cemetery,
  'glacier',
  '#ffffff',
  'sand',
  '#f2ecd2',
  ct.park,
]

/** Protomaps' `light` layers, recoloured and retuned. */
const basemap = (): Layer[] =>
  (layers('basemap', flavour, { lang: 'en' }) as Layer[])
    .filter((l) => !dropped.has(l.id))
    .map((l) => {
      const layout = l.layout ?? {}
      const paint = l.paint ?? {}
      for (const k of Object.keys(layout)) if (k.startsWith('icon-')) delete layout[k]
      if (l.id === 'landuse_park') {
        l.filter = ['in', ['get', 'kind'], ['literal', parkKinds]]
        paint['fill-color'] = parkFill
      }
      // cycle.travel fills buildings as built-up land, so blocks read as one, with a faint edge.
      if (l.id === 'buildings')
        Object.assign(paint, { 'fill-color': urbanFill, 'fill-opacity': 1, 'fill-outline-color': ct.building })
      if (['roads_major', 'roads_bridges_major', 'roads_tunnels_major'].includes(l.id))
        Object.assign(paint, { 'line-color': roadColour, 'line-width': majorWidth })
      if (
        [
          'roads_major_casing_early',
          'roads_major_casing_late',
          'roads_bridges_major_casing',
          'roads_tunnels_major_casing',
        ].includes(l.id)
      )
        Object.assign(paint, { 'line-gap-width': majorWidth, 'line-width': majorCasing, 'line-color': casingColour })
      if (['roads_highway', 'roads_bridges_highway', 'roads_tunnels_highway'].includes(l.id))
        paint['line-width'] = motorwayWidth
      if (
        [
          'roads_highway_casing_early',
          'roads_highway_casing_late',
          'roads_bridges_highway_casing',
          'roads_tunnels_highway_casing',
        ].includes(l.id)
      )
        Object.assign(paint, motorwayCasing)
      // Railways are a solid grey line from cycle.travel's z10 (our 9), wider than minor roads; ct_rail_core dashes
      // white along the middle. Sidings, yards and crossovers are half as wide, and tunnels (most of the Underground)
      // aren't drawn, as on cycle.travel.
      if (l.id === 'roads_rail') {
        delete paint['line-dasharray']
        l.filter = railway
        Object.assign(paint, { 'line-opacity': 1, 'line-color': ct.rail, 'line-width': railWidth })
      }
      if (l.id === 'roads_minor')
        Object.assign(paint, {
          'line-width': minorWidth,
          'line-color': ['interpolate', ['linear'], ['zoom'], 11, ct.minorLow, 13, '#ffffff'],
        })
      if (l.id === 'roads_minor_casing')
        Object.assign(paint, {
          'line-gap-width': minorWidth,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 0.6, 16, 1],
        })
      // cycle.travel draws paths itself (cycleways red/white, footpaths green dashes), so the plain path layer
      // only keeps "other".
      if (l.id === 'roads_other')
        l.filter = [
          'all',
          ['!', ['has', 'is_tunnel']],
          ['!', ['has', 'is_bridge']],
          ['==', ['get', 'kind'], 'other'],
          ['!=', ['get', 'kind_detail'], 'pier'],
        ]
      if (l.id === 'places_locality') {
        // OSM place=locality (park gates, river reaches) gets its own small grey layer at street level
        // (ct_localities). cycle.travel has no City of Westminster label; the Westminster quarter
        // (places_subplace) covers it. It never names farms or isolated dwellings, and hamlets only from its z14
        // (our 13): small and plain until its z16 (our 15), then like villages.
        l.filter = [
          'all',
          ['==', ['get', 'kind'], 'locality'],
          ['!', ['in', kd, ['literal', ['locality', 'farm', 'isolated_dwelling']]]],
          ['any', ['!=', kd, 'hamlet'], ['>=', ['zoom'], 13]],
          ['!=', ['get', 'name'], 'City of Westminster'],
        ]
        const capital = ['>=', ['get', 'population_rank'], 10]
        const town = ['match', kd, ['town', 'city'], true, false]
        const hamlet = ['==', kd, 'hamlet']
        layout['text-font'] = [
          'step',
          ['zoom'],
          [
            'case',
            capital,
            montserrat('Medium'),
            town,
            montserrat('Bold'),
            hamlet,
            montserrat('Regular'),
            montserrat('Medium'),
          ],
          15,
          ['case', capital, montserrat('Medium'), town, montserrat('Bold'), montserrat('Medium')],
        ]
        paint['text-color'] = ['case', capital, '#000000', town, ct.town, ct.village]
        layout['text-size'] = [
          'interpolate',
          ['linear'],
          ['zoom'],
          6,
          ['case', capital, 13, 10],
          10,
          ['case', capital, 17, ['<=', ['get', 'min_zoom'], 9], 14, 12],
          14,
          ['case', capital, 16, hamlet, 10, 15],
          15,
          ['case', capital, 16, 15],
        ]
        layout['text-max-width'] = ['step', ['zoom'], ['case', hamlet, 5, 10], 15, 10]
        // cycle.travel: mixed case to its z12 (our 11), then towns in letter-spaced capitals; LONDON spreads wide
        // at street level.
        layout['text-transform'] = ['step', ['zoom'], 'none', 12, ['case', town, 'uppercase', 'none']]
        layout['text-letter-spacing'] = [
          'step',
          ['zoom'],
          0,
          12,
          ['case', town, 0.08, 0],
          14,
          ['case', capital, 0.55, town, 0.08, 0],
        ]
        // cycle.travel packs place names tightly; Protomaps' wide padding knocks out neighbours and route badges.
        layout['text-padding'] = 3
        paint['text-halo-width'] = 2
        paint['text-halo-blur'] = 0.5
      }
      if (l.id === 'places_subplace') {
        layout['text-transform'] = 'none'
        layout['text-letter-spacing'] = 0
        layout['text-font'] = montserrat('Medium')
        layout['text-padding'] = 3
        layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14]
        paint['text-color'] = ['match', ['get', 'kind'], 'macrohood', ct.macrohood, ct.neighbourhood]
        paint['text-halo-width'] = 1.5
      }
      if (l.id === 'places_region' || l.id === 'places_country') layout['text-font'] = montserrat('Medium')
      // Street names only from cycle.travel's z15 (our 14), dark grey, with its Street→St / Road→Rd shortening.
      if (l.id.startsWith('roads_labels')) {
        l.minzoom = 14
        Object.assign(layout, {
          'text-size': 12,
          'text-font': montserrat('Regular'),
          'text-field': abbreviate(['coalesce', ['get', 'name:en'], ['get', 'name'], '']),
        })
        Object.assign(paint, { 'text-color': ct.street, 'text-halo-width': 1.5 })
      }
      // Rivers: slate italic, widely spaced, no halo, from cycle.travel's z13 (our 12).
      if (l.id === 'water_waterway_label') {
        l.minzoom = 12
        Object.assign(layout, { 'text-font': montserrat('Italic'), 'text-letter-spacing': 0.25 })
        Object.assign(paint, { 'text-color': ct.waterLabel, 'text-halo-width': 0 })
      }
      if (l.id === 'water_label_lakes') {
        layout['text-font'] = montserrat('Italic')
        Object.assign(paint, { 'text-color': ct.waterLabel, 'text-halo-width': 0 })
      }
      return l
    })

const width = (stops: Expression[]) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops]
// A/B road numbers: small grey italics from cycle.travel's z11 (our 10).
const roadRefs: Layer = {
  id: 'ct_road_refs',
  type: 'symbol',
  source: 'basemap',
  'source-layer': 'roads',
  minzoom: 10,
  filter: [
    'all',
    ['has', 'ref'],
    ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]],
    ['in', kd, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
  ],
  layout: {
    'symbol-placement': 'line',
    'symbol-spacing': 350,
    'text-field': ['get', 'ref'],
    'text-font': montserrat('Italic'),
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 10.5],
    'text-padding': 20,
  },
  paint: { 'text-color': ct.roadRef, 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
}

const kind = ['get', 'kind']
const structure = ['==', ['get', 'structure'], true]
const area = ['coalesce', ['get', 'area'], 0]
const bigLandmark = 6000 // m², about the smallest landmark cycle.travel marks at its z14–15 (Westminster Bridge)
// Point labels cycle.travel adds at street level (its z15, our 14), coloured by what they are.
// cycle.travel names far fewer of these than Protomaps carries: roughly a zoom later than Protomaps' own min_zoom.
const poiKind = (kinds: string[]) => [
  'all',
  ['in', ['get', 'kind'], ['literal', kinds]],
  ['<=', ['get', 'min_zoom'], ['-', ['zoom'], 1]],
]
const pointLabel = (size: number, face: Face, maxWidth = 7) => ({
  'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
  'text-font': montserrat(face),
  'text-size': size,
  'text-max-width': maxWidth,
  'text-line-height': 1.1,
  'text-padding': 4,
})
const halo = (colour: string) => ({ 'text-color': colour, 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 })
const labels: Layer[] = [
  // Later entries win collisions: landmarks give way to localities, localities to parks (St James's Park beats
  // Pelican Rock). Landmarks come from the cycling overlay (tourism attractions, museums, zoos, castles, palaces;
  // never churches), each under a castle, museum or star, the biggest first. Until its z16 (our 15) cycle.travel
  // marks only big buildings and bridges, no museums: Buckingham Palace, the Palace of Westminster, the Royal Mews,
  // Westminster and London Bridges, not the British Museum, Horse Guards or Horse Guards Parade. The label gives way
  // before the icon does.
  {
    id: 'ct_landmarks',
    type: 'symbol',
    ...cycling('pois'),
    minzoom: 13,
    filter: [
      'all',
      ['==', kind, 'landmark'],
      ['step', ['zoom'], ['all', structure, ['!=', ['get', 'icon'], 'museum'], ['>=', area, bigLandmark]], 15, true],
    ],
    layout: {
      ...pointLabel(11, 'SemiBold'),
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 14, 11],
      'icon-image': [
        'match',
        ['get', 'icon'],
        'castle',
        'landmark-castle',
        'museum',
        'landmark-museum',
        'landmark-attraction',
      ],
      'text-anchor': 'top',
      'text-offset': [0, 0.7],
      'text-optional': true,
      'symbol-sort-key': ['-', area],
    },
    paint: halo(ct.landmark),
  },
  {
    id: 'ct_localities',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'places',
    minzoom: 14,
    filter: ['all', ['==', ['get', 'kind'], 'locality'], ['==', ['get', 'kind_detail'], 'locality']],
    layout: pointLabel(11, 'Medium'),
    paint: halo(ct.locality),
  },
  {
    id: 'ct_parks',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'pois',
    minzoom: 14,
    filter: poiKind(['park', 'garden', 'nature_reserve', 'wood', 'forest', 'golf_course']),
    layout: { ...pointLabel(11.5, 'MediumItalic'), 'symbol-sort-key': ['get', 'min_zoom'] },
    paint: halo(ct.parkLabel),
  },
  // Protomaps only ships hills from tile z14, so these come from the cycling overlay (natural=peak|hill).
  {
    id: 'ct_peaks',
    type: 'symbol',
    ...cycling('pois'),
    minzoom: 12,
    filter: ['==', ['get', 'kind'], 'peak'],
    layout: pointLabel(11, 'MediumItalic', 6),
    paint: halo(ct.peak),
  },
  // Above or below the dot, sliding to a corner when that's taken (Charing Cross beside LONDON).
  {
    id: 'ct_stations_label',
    type: 'symbol',
    ...cycling('pois'),
    minzoom: 14,
    filter: ['==', ['get', 'kind'], 'station'],
    layout: {
      ...pointLabel(11, 'SemiBold', 8),
      'text-variable-anchor': ['top', 'bottom', 'bottom-right', 'bottom-left', 'top-right', 'top-left'],
      'text-radial-offset': 0.6,
    },
    paint: halo(ct.station),
  },
]
// National Rail stations as cycle.travel's orange dot, every one from its z13 (our 12).
const stations: Layer = {
  id: 'ct_stations',
  type: 'circle',
  ...cycling('pois'),
  minzoom: 12,
  filter: ['==', ['get', 'kind'], 'station'],
  paint: {
    'circle-color': ct.station,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 2.6],
    'circle-stroke-color': '#000000',
    'circle-stroke-width': 0.9,
  },
}
// At its z11–12 (our 10–11) cycle.travel shows the stations of the country and a few at a city's edge, none in it. A
// town's name beats its station (Clacton, Felixstowe, Ipswich) but a station beats a village's name (Mistley, Wrabness
// and Westerfield get the dot, not the name). Ours approximate that: only those with at most `crowdedStation` others
// within 5 km (the overlay's crowd_5km), as the same dot drawn as a symbol, placed after town names and before villages'
// (places_villages). Surrey's and Essex's have up to about 10; London's suburbs 8–19, its middle 20+.
const crowdedStation = 11
const stationsThinned: Layer = {
  id: 'ct_stations_thinned',
  type: 'symbol',
  ...cycling('pois'),
  minzoom: 10,
  maxzoom: 12,
  filter: ['all', ['==', ['get', 'kind'], 'station'], ['<=', ['get', 'crowd_5km'], crowdedStation]],
  layout: { 'icon-image': 'station', 'icon-padding': 4 },
}
// cycle.travel's POI icons (sprite poi-*), from its z15 (our 14). Car parks stay off, as on cycle.travel. Where icons
// overlap, the earlier kinds in this list draw on top: what a rider stops for first.
const poiKinds = [
  'drinking_water',
  'toilets',
  'bicycle_shop',
  'cafe',
  'camp_site',
  'viewpoint',
  'pub',
  'bicycle_parking',
]
// cycle.travel thins them by how crowded they are. At its z15 it shows a village's, a country park's and a lone one at
// the edge of town, but not a town centre's; from its z16 all of them, except a city's cafés, which it never shows.
// Bike shops always show. The overlay counts each icon's neighbours (crowd_500m, crowd_1km); these limits are
// calibrated on Shere, Box Hill, Dorking, Putney and Westminster (docs/maps/cycle-travel-style.md, "POI icons").
const quiet = 10 // other icons within 500 m, to show at our z14
const cityCafes = 80 // other icons within 1 km, above which a café never shows
const pois: Layer = {
  id: 'ct_pois',
  type: 'symbol',
  ...cycling('pois'),
  minzoom: 14,
  filter: [
    'step',
    ['zoom'],
    [
      'all',
      ['in', kind, ['literal', poiKinds]],
      ['any', ['==', kind, 'bicycle_shop'], ['<=', ['get', 'crowd_500m'], quiet]],
    ],
    15,
    [
      'all',
      ['in', kind, ['literal', poiKinds]],
      ['any', ['!=', kind, 'cafe'], ['<=', ['get', 'crowd_1km'], cityCafes]],
    ],
  ],
  layout: {
    'icon-image': ['match', kind, ...poiKinds.flatMap((k) => [k, `poi-${k.replaceAll('_', '-')}`]), ''],
    // With overlap allowed, higher keys draw on top.
    'symbol-sort-key': ['-', ['index-of', kind, ['literal', poiKinds]]],
    // cycle.travel lets them overlap each other and the badges; labels still keep clear of them.
    'icon-allow-overlap': true,
  },
}
// Paths come from the cycling overlay, which keeps the surface and bicycle tags the basemap drops: class is 'p'
// (paved, red and white), 'u' (unpaved, brown dashes) or 'foot' (other footpaths, green dashes).
const pathClass = (c: string) => ['==', ['get', 'class'], c]
const paths: Layer[] = [
  // ~1.2px wide, 2px dashes every 7.3px at cycle.travel's z15.
  {
    id: 'ct_footpaths',
    type: 'line',
    ...cycling('paths'),
    minzoom: 14,
    filter: pathClass('foot'),
    paint: { 'line-color': ct.footpath, 'line-width': width([14, 1.2, 18, 2.4]), 'line-dasharray': [1.7, 4.4] },
  },
  // Measured off cycle.travel @2x screenshots: ~1px wide, dashes ~5px long every ~8px at its z13–15.
  {
    id: 'ct_unpaved',
    type: 'line',
    ...cycling('paths'),
    minzoom: 12,
    filter: pathClass('u'),
    paint: {
      'line-color': ct.unpaved,
      'line-width': width([12, 0.95, 15, 1.1, 18, 2]),
      'line-dasharray': [5.5, 2.5],
    },
  },
  {
    id: 'ct_cycleways_casing',
    type: 'line',
    ...cycling('paths'),
    minzoom: 12,
    filter: pathClass('p'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ct.cycleway, 'line-width': width([12, 2.2, 15, 4.5, 18, 10]) },
  },
  {
    id: 'ct_cycleways',
    type: 'line',
    ...cycling('paths'),
    minzoom: 12,
    filter: pathClass('p'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': width([12, 0.9, 15, 2.2, 18, 6]) },
  },
]

// Cycle network relations (the overlay's routes layer), drawn as cycle.travel's dotted lines: dot icons placed along
// each route (src/dots.ts), local under regional under national under EuroVelo. Each overlay way carries its
// highest-ranked network, so dots of two networks never share a line.
const net = ['get', 'network']
const visible = ['>=', ['zoom'], ['get', 'minz']]
// Steps take effect at the tile's integer zoom, as layout properties do.
const step = (values: { zoom: number; value: Expression }[]) => {
  const [first, ...rest] = values
  return rest.length
    ? ['step', ['zoom'], first?.value, ...rest.flatMap(({ zoom, value }) => [zoom, value])]
    : first?.value
}
const routes: Layer[] = networks.map((network) => ({
  id: network === 'ncn' ? 'ct_routes' : `ct_routes_${network === 'icn' ? 'eurovelo' : network}`,
  type: 'symbol',
  ...cycling('routes'),
  filter: ['all', ['==', net, network], visible],
  layout: {
    'symbol-placement': 'line',
    'symbol-spacing': step(dots[network].steps.map(({ zoom, spacing }) => ({ zoom, value: spacing }))),
    'icon-image': step(dots[network].steps.map(({ zoom, image }) => ({ zoom, value: image }))),
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-rotation-alignment': 'viewport',
    'icon-pitch-alignment': 'viewport',
  },
}))

// cycle.travel's repeater badges: upright, every ~160px along the route, from its z12 (our 11). Red for national,
// blue for regional/London; boxes are 11.5px tall and 15/20/25px wide for 1/2/3 characters.
// EuroVelo shows as a starred navy square only at our z11; from z12 the Avenue Verte turns red and EVs drop out.
// The badge images (badge-red, badge-blue, badge-eu) are in the sprite (src/sprite.ts).
const badge = ['get', 'badge']
// No symbol-sort-key: with line placement it drops the box from some badges (MapLibre draws the number alone),
// so priority comes from layer order instead.
const badgeLayout = (extra: Record<string, Expression>) => ({
  'symbol-placement': 'line',
  'symbol-spacing': 160,
  'text-max-angle': 180,
  'text-field': ['get', 'label'],
  'text-font': montserrat('Bold'),
  'text-size': 8.5,
  'text-letter-spacing': 0.04,
  'text-rotation-alignment': 'viewport',
  'text-pitch-alignment': 'viewport',
  'icon-rotation-alignment': 'viewport',
  'icon-pitch-alignment': 'viewport',
  'text-keep-upright': false,
  'text-padding': 2,
  'icon-padding': 2,
  ...extra,
})
const fit = { 'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 4.5, 0.5, 4.5] }
const badges: Layer[] = [
  {
    id: 'ct_route_badges_rcn',
    type: 'symbol',
    ...cycling('route_badges'),
    minzoom: 11,
    filter: ['==', badge, 'blue'],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-blue' }),
    paint: { 'text-color': '#ffffff' },
  },
  {
    id: 'ct_route_badges',
    type: 'symbol',
    ...cycling('route_badges'),
    minzoom: 11,
    filter: ['==', badge, 'red'],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-red' }),
    paint: { 'text-color': '#ffffff' },
  },
  {
    id: 'ct_route_badges_icn',
    type: 'symbol',
    ...cycling('route_badges'),
    minzoom: 12,
    filter: ['all', ['==', badge, 'eu'], ['!', ['get', 'ev']]],
    layout: badgeLayout({ ...fit, 'icon-image': 'badge-red' }),
    paint: { 'text-color': '#ffffff' },
  },
  {
    id: 'ct_route_badges_eu',
    type: 'symbol',
    ...cycling('route_badges'),
    minzoom: 11,
    maxzoom: 12,
    filter: ['==', badge, 'eu'],
    layout: badgeLayout({ 'icon-image': 'badge-eu', 'symbol-spacing': 220, 'text-size': 7.5 }),
    paint: { 'text-color': '#ffffff' },
  },
]

const urban: Layer = {
  id: 'ct_urban',
  type: 'fill',
  source: 'basemap',
  'source-layer': 'landuse',
  filter: ['in', ['get', 'kind'], ['literal', ['residential', 'commercial', 'retail', 'railway', 'industrial']]],
  paint: { 'fill-color': urbanFill },
}
// cycle.travel shows grass, gardens and the like as bare land even inside built-up land, so they're filled with the
// land colour over ct_urban.
const greens: Layer = {
  id: 'ct_greens',
  type: 'fill',
  source: 'basemap',
  'source-layer': 'landuse',
  filter: [
    'in',
    ['get', 'kind'],
    [
      'literal',
      ['recreation_ground', 'grass', 'meadow', 'village_green', 'garden', 'dog_park', 'playground', 'allotments'],
    ],
  ],
  paint: { 'fill-color': ct.land },
}
// Pitches are cycle.travel's only filled sports or garden land use; above the parks, so they show inside them.
const pitches: Layer = {
  id: 'ct_pitches',
  type: 'fill',
  source: 'basemap',
  'source-layer': 'landuse',
  filter: ['==', ['get', 'kind'], 'pitch'],
  paint: { 'fill-color': ct.pitch },
}
// Military land, as cycle.travel draws it at street level: a 1px red edge with a 7px pale red band just inside. Its
// lowest zoom for these is unchecked; ours is 13.
// Positive offsets go right of the ring, which is inside for vector tiles' clockwise outer rings.
const militaryKinds = ['in', ['get', 'kind'], ['literal', ['military', 'naval_base', 'airfield']]]
const military: Layer[] = [
  {
    id: 'ct_military_band',
    type: 'line',
    source: 'basemap',
    'source-layer': 'landuse',
    minzoom: 13,
    filter: militaryKinds,
    // Mitred: round joins on an offset line overlap at every vertex, and the overlaps show darker.
    layout: { 'line-join': 'miter' },
    paint: { 'line-color': ct.militaryBand, 'line-opacity': 0.22, 'line-width': 7, 'line-offset': 3.5 },
  },
  {
    id: 'ct_military',
    type: 'line',
    source: 'basemap',
    'source-layer': 'landuse',
    minzoom: 13,
    filter: militaryKinds,
    paint: { 'line-color': ct.military, 'line-width': 1 },
  },
]

// The white dashes along a main line's middle. Below cycle.travel's z12 (our 11) they're longer and thinner.
const railCore: Layer = {
  id: 'ct_rail_core',
  type: 'line',
  source: 'basemap',
  'source-layer': 'roads',
  minzoom: 9,
  filter: ['all', railway, ['!', ['has', 'service']]],
  paint: {
    'line-color': '#ffffff',
    'line-width': width([9, 0.5, 10, 1, 12, 2.25, 14, 3, 18, 6]),
    'line-dasharray': ['step', ['zoom'], ['literal', [5.5, 5.5]], 11, ['literal', [4, 4]]],
  },
}

const attribution = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'

export const buildStyle = (target: Target): StyleSpecification => {
  const all = basemap()
  const at = (id: string) => {
    const index = all.findIndex((l) => l.id === id)
    if (index < 0) throw new Error(`No basemap layer ${id}`)
    return index
  }
  all.splice(at('landuse_park'), 0, urban, greens)
  all.splice(at('landuse_park') + 1, 0, pitches)
  all.splice(at('buildings') + 1, 0, ...military)
  all.splice(at('roads_rail'), 0, ...paths)
  all.splice(at('roads_rail') + 1, 0, railCore)
  all.splice(at('roads_labels_minor'), 0, ...routes, stations)
  all.splice(at('roads_labels_major') + 1, 0, roadRefs)
  // Later layers win label collisions: badges beat POI icons, which beat point labels; EuroVelo beats national
  // beats regional.
  all.splice(at('places_subplace'), 0, ...labels, pois, ...badges)
  // Below our z12, villages' and hamlets' names go in their own layer, placed after the thinned stations, which are
  // placed after towns' names.
  const locality = all[at('places_locality')] as Layer
  const town = ['match', kd, ['town', 'city'], true, false]
  const villages: Layer = {
    ...locality,
    id: 'places_villages',
    maxzoom: 12,
    filter: ['all', locality.filter, ['!', town]],
  }
  locality.filter = ['all', locality.filter, ['any', town, ['>=', ['zoom'], 12]]]
  all.splice(at('places_subplace'), 0, villages, stationsThinned)

  return {
    version: 8,
    name: 'Ride On cycle map',
    glyphs: target.glyphs,
    sprite: target.sprite,
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${target.tiles}/${archives.basemap}`,
        attribution: `${attribution} · <a href="https://protomaps.com">Protomaps</a>`,
      },
      cycling: { type: 'vector', url: `pmtiles://${target.tiles}/${archives.cycling}`, attribution },
    },
    layers: all,
  } as StyleSpecification
}
