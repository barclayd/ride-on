// Renders the intro's opening view of the cycle map into src/assets/intro, with its world bounds in
// src/data/posters.json, so the page shows a map straight away while MapLibre loads behind it. Run
// with `bun run poster` after changing the first route or the map style.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { OVERHANG, route, TILE, toLngLat, zoomFor } from '../src/lib/map';

type Size = [number, number];

// Each poster is drawn at the opening zoom of `viewport`, big enough to cover the opening view of
// every size in `covers`. The page picks one by orientation.
const POSTERS: Record<string, { viewport: Size; dpr: number; covers: Size[] }> =
  {
    landscape: {
      viewport: [1440, 900],
      dpr: 1,
      covers: [
        [1024, 768],
        [1280, 720],
        [1440, 900],
        [1920, 1080],
        [2560, 1080],
      ],
    },
    portrait: {
      viewport: [390, 844],
      dpr: 2,
      covers: [
        [360, 780],
        [390, 844],
        [430, 932],
        [768, 1024],
        [1024, 1366],
      ],
    },
  };

const first = route(0);
const scaleAt = ([width, height]: Size) =>
  TILE * 2 ** zoomFor(first, width, height);

const built = await Bun.build({
  entrypoints: ['node_modules/pmtiles/dist/esm/index.js'],
  format: 'esm',
});
const pmtiles = await built.outputs[0]?.text();

const page = (width: number, height: number, dpr: number, zoom: number) => `
<!doctype html>
<style>html,body{margin:0}#map{width:${width}px;height:${height}px}</style>
<div id="map"></div>
<script type="module">
  const maplibre = await import('/vendor/maplibre-gl/maplibre-gl.mjs');
  const { Protocol } = await import('/pmtiles.js');
  maplibre.addProtocol('pmtiles', new Protocol().tile);
  const style = await (await fetch('/map/style.json')).json();
  style.sprite = location.origin + '/map/sprite2x';
  style.glyphs = location.origin + '/map/glyphs/{fontstack}/{range}.pbf';
  const map = new maplibre.Map({
    container: 'map',
    style,
    center: ${JSON.stringify(toLngLat(first.cx, first.cy))},
    zoom: ${zoom},
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: ${dpr},
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  map.once('idle', () => {
    window.poster = map.getCanvas().toDataURL('image/png');
  });
</script>`;

let html = '';
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/')
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    if (pathname === '/pmtiles.js')
      return new Response(pmtiles, {
        headers: { 'content-type': 'text/javascript' },
      });
    const file = Bun.file(`public${pathname}`);
    if (await file.exists()) return new Response(file);
    return new Response('Not found', { status: 404 });
  },
});

const bounds: Record<string, { x: number; y: number; w: number; h: number }> =
  {};
await mkdir('src/assets/intro', { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, { viewport, dpr, covers }] of Object.entries(POSTERS)) {
    const scale = scaleAt(viewport);
    // The opening view is centred on the first route, so cover the widest and tallest of them. Even
    // sizes keep the centre on a whole pixel, as it is on the page, so the two line up exactly.
    const [width, height] = [0, 1].map(
      (axis) =>
        2 *
        Math.ceil(
          (Math.max(
            ...covers.map(
              (size) => ((size[axis] as number) + OVERHANG) / scaleAt(size),
            ),
          ) *
            scale) /
            2,
        ),
    ) as Size;
    const tab = await browser.newPage({ viewport: { width, height } });
    html = page(width, height, dpr, Math.log2(scale / TILE));
    await tab.goto(server.url.href);
    const poster = await tab.waitForFunction(
      () => (window as Window & { poster?: string }).poster,
      null,
      { timeout: 60_000 },
    );
    const data = (await poster.jsonValue()) as string;
    const file = `src/assets/intro/${name}.avif`;
    // AVIF is about half the size of WebP here, and the wash hides what quality 40 loses.
    await sharp(Buffer.from(data.split(',')[1] as string, 'base64'))
      .avif({ quality: 40, effort: 6 })
      .toFile(file);
    bounds[name] = {
      x: first.cx - width / 2 / scale,
      y: first.cy - height / 2 / scale,
      w: width / scale,
      h: height / scale,
    };
    console.log(
      `${file}: ${width}×${height} @${dpr}x, ${Math.round(Bun.file(file).size / 1024)} KB`,
    );
    await tab.close();
  }
} finally {
  await browser.close();
  server.stop();
}

await Bun.write(
  'src/data/posters.json',
  `${JSON.stringify(bounds, null, 2)}\n`,
);
