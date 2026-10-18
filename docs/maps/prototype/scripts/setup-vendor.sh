#!/bin/sh
# Copies the browser builds index.html loads from node_modules into vendor/ (gitignored).
set -e
cd "$(dirname "$0")/.."
mkdir -p vendor
for f in maplibre-gl.mjs maplibre-gl-shared.mjs maplibre-gl-worker.mjs maplibre-gl.css; do cp "node_modules/maplibre-gl/dist/$f" vendor/; done
cp node_modules/pmtiles/dist/pmtiles.js vendor/
ls vendor
