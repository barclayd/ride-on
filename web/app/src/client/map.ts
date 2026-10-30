import type { FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { Line } from '../geometry.ts';
import { board } from './board.ts';
import type { Library } from './library.ts';
import { HUES, UNSCORED } from './slots.ts';

type Bounds = [[number, number], [number, number]];
const gb: Bounds = [
  [-10.7, 48.8],
  [3.9, 61.9],
];
// Signed out, the map rests on London's cycle network.
const london: [number, number] = [-0.12, 51.5];
// Route lines go under the minor road labels, as in the prototype (design/up/map/live.js).
const before = 'roads_labels_minor';
// The panel and day strip cover the map's edges (PAD in design/gen/proto-logic.js).
const padding = () =>
  matchMedia('(max-width: 767px)').matches
    ? { top: 112, right: 28, bottom: 596, left: 28 }
    : { top: 72, right: 40, bottom: 140, left: 416 };

// Paint comes from feature state, never a data rewrite: c is the route's identity colour and on says
// it has one (it's shortlisted).
const state = (
  key: string,
  fallback: boolean | string,
): ExpressionSpecification => ['coalesce', ['feature-state', key], fallback];
const on = state('on', false);
const colour: ExpressionSpecification = ['to-color', state('c', UNSCORED)];
const width: ExpressionSpecification = ['case', on, 4, 2];
const casing: ExpressionSpecification = ['case', on, 7, 0];
const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
const only = (ids: string[]): FilterSpecification => [
  'in',
  ['get', 'id'],
  ['literal', ids],
];

/** The box around `lines`, or null when there's nothing to fit. */
const around = (lines: Iterable<Line>): Bounds | null => {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const line of lines)
    for (const [lon, lat] of line) {
      w = Math.min(w, lon);
      s = Math.min(s, lat);
      e = Math.max(e, lon);
      n = Math.max(n, lat);
    }
  return w <= e
    ? [
        [w, s],
        [e, n],
      ]
    : null;
};

/** SPEC §4: a bare URL fits the selected route, or else the library. An empty library rests on GB (§7.6). */
const camera = ({ lines }: Library) => {
  const selected = location.pathname.match(/^\/routes\/([^/]+)/)?.[1];
  const line = selected && lines.get(selected);
  return around(line ? [line] : lines.values()) ?? gb;
};

/** `backdrop`: the map behind sign-in. It has no routes, stays still and keeps its camera out of the URL. */
export async function mount(
  container: HTMLElement,
  signal: AbortSignal,
  backdrop = false,
) {
  const { origin } = location;
  // A camera in the hash wins; a bare URL waits for the library so the first frame already fits it.
  const bare = location.hash.length < 2;
  // ponytail: the designed error states are v1 (SPEC §7.8); until then a failed load shows no routes.
  const library = backdrop ? Promise.resolve(null) : board.load();
  const [maplibre, style, ready] = await Promise.all([
    import(`${origin}/vendor/maplibre-gl/maplibre-gl.mjs`) as Promise<
      typeof import('maplibre-gl')
    >,
    // ponytail: SharedUI's copy of the style until maps/style publishes to maps.ride-on.cc (SPEC §12.3).
    fetch('/map/style.json', { signal }).then(
      (r) => r.json() as Promise<StyleSpecification>,
    ),
    bare ? library : null,
  ]);
  if (signal.aborted) return;
  maplibre.addProtocol('pmtiles', new Protocol().tile);
  style.sprite = `${origin}/map/sprite`;
  style.glyphs = `${origin}/map/glyphs/{fontstack}/{range}.pbf`;
  const map = new maplibre.Map({
    container,
    style,
    ...(backdrop
      ? { center: london, zoom: 11, interactive: false }
      : {
          bounds: ready ? camera(ready) : gb,
          fitBoundsOptions: { padding: padding(), maxZoom: 14 },
          hash: true,
        }),
    maxBounds: gb,
    attributionControl: { compact: true },
    // Workers assets 307 any path with an @, so the 2x sprite is served without one.
    transformRequest: (url) => ({
      url: url.replace(/\/sprite(@2x)?\.(json|png)$/, '/sprite2x.$2'),
    }),
  });
  // The sign-in card covers the map's edge as the panel does, so London centres in what's left.
  if (backdrop) map.setPadding(padding());
  signal.addEventListener('abort', () => map.remove());
  const [loaded] = await Promise.all([library, map.once('load')]);
  if (loaded && !signal.aborted) addRoutes(map, loaded, signal);
}

/** Every route as one feature, shortlisted ones last so they draw over the grey ones and win a hover. */
const collection = (
  lines: Map<string, Line>,
  slots: Map<string, number>,
): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [...lines.keys()]
    .sort((a, b) => Number(slots.has(a)) - Number(slots.has(b)))
    .map((id) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: lines.get(id) ?? [] },
      properties: { id },
    })),
});

/** Every library route in one source: shortlisted ones in their identity colour, the rest thin and grey. */
function addRoutes(map: MapLibreMap, { lines }: Library, signal: AbortSignal) {
  map.addSource('routes', {
    type: 'geojson',
    promoteId: 'id',
    data: collection(lines, board.slots),
  });
  const line = { type: 'line', source: 'routes', layout: round } as const;
  // routes-hit is 22px and invisible, so thin lines are easy to hover.
  map.addLayer(
    {
      ...line,
      id: 'routes-hit',
      paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 },
    },
    before,
  );
  map.addLayer(
    {
      ...line,
      id: 'routes-casing',
      paint: { 'line-color': '#fff', 'line-width': casing },
    },
    before,
  );
  map.addLayer(
    {
      ...line,
      id: 'routes-line',
      paint: { 'line-color': colour, 'line-width': width },
    },
    before,
  );
  // The hovered route again, on top and 2px wider.
  map.addLayer(
    {
      ...line,
      id: 'top-casing',
      filter: only([]),
      paint: {
        'line-color': '#fff',
        'line-width': ['case', on, ['+', casing, 2], 0],
      },
    },
    before,
  );
  map.addLayer(
    {
      ...line,
      id: 'top-line',
      filter: only([]),
      paint: { 'line-color': colour, 'line-width': ['+', width, 2] },
    },
    before,
  );
  const paint = () => {
    for (const [id, slot] of board.slots)
      map.setFeatureState(
        { source: 'routes', id },
        { c: HUES[slot], on: true },
      );
  };
  paint();
  // A shortlist change re-sorts the lines and repaints them from scratch, so a route that left drops its colour.
  board.addEventListener(
    'shortlist',
    () => {
      map.removeFeatureState({ source: 'routes' });
      map
        .getSource<GeoJSONSource>('routes')
        ?.setData(collection(lines, board.slots));
      paint();
    },
    { signal },
  );

  // Hover goes through the board, so a line and its row in the panel light together.
  board.addEventListener(
    'hover',
    () => {
      const id = board.hovered;
      map.setFilter('top-casing', only(id ? [id] : []));
      map.setFilter('top-line', only(id ? [id] : []));
    },
    { signal },
  );
  map.on('mousemove', (event) => {
    const [top] = map.queryRenderedFeatures(event.point, {
      layers: ['routes-hit'],
    });
    const id =
      typeof top?.properties.id === 'string' ? top.properties.id : null;
    map.getCanvas().style.cursor = id ? 'pointer' : '';
    board.hover(id);
  });
  map.getCanvas().addEventListener('mouseleave', () => board.hover(null), {
    signal,
  });
}
