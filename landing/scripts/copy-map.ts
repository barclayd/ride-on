// Copies SharedUI's cycle map style into public/map, and vendors MapLibre's ES
// modules into public/vendor so its worker resolves next to it, as web/app/build.ts does.
import { cp, rm } from 'node:fs/promises';

const style = '../apple/Packages/Features/Sources/SharedUI/CycleMap';
const maplibre = 'node_modules/maplibre-gl/dist';

await rm('public/map', { recursive: true, force: true });
await rm('public/vendor', { recursive: true, force: true });
await Promise.all([
  cp(`${style}/style.json`, 'public/map/style.json'),
  // Workers assets 307 any path with an @, so the 2x sprite drops it.
  cp(`${style}/sprite@2x.json`, 'public/map/sprite2x.json'),
  cp(`${style}/sprite@2x.png`, 'public/map/sprite2x.png'),
  cp(`${style}/glyphs`, 'public/map/glyphs', { recursive: true }),
  ...[
    'maplibre-gl.mjs',
    'maplibre-gl-shared.mjs',
    'maplibre-gl-worker.mjs',
  ].map((file) =>
    cp(`${maplibre}/${file}`, `public/vendor/maplibre-gl/${file}`),
  ),
]);
