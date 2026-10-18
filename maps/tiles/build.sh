#!/usr/bin/env bash
# Builds the cycling overlay from an OpenStreetMap extract, in Docker (no local Java needed):
#
#   maps/tiles/build.sh united-kingdom-YYMMDD.osm.pbf cycling-gb-YYYYMMDD.pmtiles [planetiler args…]
#
# Runs the tests first. Maven's cache goes in $M2_CACHE (default ~/.m2); planetiler's temporary files
# go next to the output and are removed when it finishes.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
fi

here=$(cd "$(dirname "$0")" && pwd)
input_dir=$(cd "$(dirname "$1")" && pwd)
input=$(basename "$1")
mkdir -p "$(dirname "$2")"
output_dir=$(cd "$(dirname "$2")" && pwd)
output=$(basename "$2")
m2=${M2_CACHE:-$HOME/.m2}
mkdir -p "$m2"
shift 2

docker run --rm \
  -v "$here":/src -v "$m2":/root/.m2 -v "$input_dir":/in:ro -v "$output_dir":/out \
  -w /src maven:3.9-eclipse-temurin-21 \
  bash -c '
    set -euo pipefail
    mvn -B -q package dependency:copy-dependencies -DincludeScope=runtime
    java -Xmx6g -cp "target/classes:target/dependency/*" cc.rideon.maps.CyclingProfile \
      --osm_path="/in/$0" --output="/out/$1" --tmpdir=/out/.planetiler-tmp "${@:2}"
  ' "$input" "$output" "$@"
