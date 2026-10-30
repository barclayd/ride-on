// Builds everything the Worker serves from ./public: the client bundle, vendored MapLibre,
// the cycle map style, the design tokens and the favicon. The Worker itself is bundled by wrangler.
import { cp, rm } from 'node:fs/promises';

const style = '../../app/Packages/Features/Sources/SharedUI/CycleMap';
const maplibre = 'node_modules/maplibre-gl/dist';

await Promise.all(
  ['public/assets', 'public/vendor', 'public/map'].map((dir) =>
    rm(dir, { recursive: true, force: true }),
  ),
);

const result = await Bun.build({
  entrypoints: [
    'src/client/entry.ts',
    'src/client/cycle-map.tsx',
    'src/client/map.ts',
    'src/client/panel.tsx',
  ],
  outdir: 'public/assets',
  target: 'browser',
  format: 'esm',
  splitting: true, // one shared remix/component runtime for the entry and every client entry
  minify: true,
  naming: { entry: '[name].[ext]', chunk: 'chunk-[hash].[ext]' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await Promise.all([
  ...[
    'maplibre-gl.mjs',
    'maplibre-gl-shared.mjs',
    'maplibre-gl-worker.mjs',
    'maplibre-gl.css',
  ].map((file) =>
    cp(`${maplibre}/${file}`, `public/vendor/maplibre-gl/${file}`),
  ),
  cp(`${style}/style.json`, 'public/map/style.json'),
  // Workers assets 307 any path with an @, so the 2x sprite drops it.
  cp(`${style}/sprite@2x.json`, 'public/map/sprite2x.json'),
  cp(`${style}/sprite@2x.png`, 'public/map/sprite2x.png'),
  cp(`${style}/glyphs`, 'public/map/glyphs', { recursive: true }),
  cp('../design-system/tokens.css', 'public/tokens.css'),
  cp('../../extension/public/icon/32.png', 'public/favicon.png'),
]);
console.log(`Built ${result.outputs.length} client files into public/`);
