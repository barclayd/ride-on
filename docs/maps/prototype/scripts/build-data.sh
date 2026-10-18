#!/bin/sh
# Turns raw/ Overpass output into the GeoJSON sources style.json reads from data/ (gitignored).
set -e
cd "$(dirname "$0")/.."
mkdir -p data
node tools/routes.mjs data/routes.geojson raw/national.json raw/regional.json raw/london.json
node tools/shields.mjs data/shields.geojson raw/national.json raw/regional.json raw/london.json
node tools/pois.mjs raw/pois.json data/pois.geojson
node tools/paths.mjs data/paths.geojson raw/paths
ls -la data
