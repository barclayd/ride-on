import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// GB, plus a margin so the coast isn't pinned to the edge.
const bounds: [[number, number], [number, number]] = [
  [-10.7, 48.8],
  [3.9, 61.9],
];

export async function mount(container: HTMLElement, signal: AbortSignal) {
  const { origin } = location;
  const [maplibre, style] = await Promise.all([
    // The vendored ESM build (build.ts); its worker loads beside it via import.meta.url.
    import(`${origin}/vendor/maplibre-gl/maplibre-gl.mjs`) as Promise<
      typeof import('maplibre-gl')
    >,
    // ponytail: SharedUI's copy of the style until maps/style publishes to maps.ride-on.cc (SPEC §12.3).
    fetch('/map/style.json', { signal }).then(
      (r) => r.json() as Promise<StyleSpecification>,
    ),
  ]);
  if (signal.aborted) return;
  maplibre.addProtocol('pmtiles', new Protocol().tile);
  style.sprite = `${origin}/map/sprite`;
  style.glyphs = `${origin}/map/glyphs/{fontstack}/{range}.pbf`;
  const map = new maplibre.Map({
    container,
    style,
    center: [-0.2665, 51.4455],
    zoom: 12,
    maxBounds: bounds,
    hash: true, // SPEC §4: the camera lives in the hash.
    attributionControl: { compact: true },
    // The style ships only the 2x sprite (as on iOS); its JSON carries pixelRatio 2.
    transformRequest: (url) => ({
      url: url.replace(/\/sprite(@2x)?\.(json|png)$/, '/sprite2x.$2'),
    }),
  });
  signal.addEventListener('abort', () => map.remove());
}
