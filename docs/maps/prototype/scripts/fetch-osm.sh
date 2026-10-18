#!/bin/sh
# Downloads the prototype's OSM inputs from Overpass into raw/ (gitignored): cycle route relations, stations and
# hills, and bike-relevant paths in 3x4 chunks across south-east England. Skips files that are already complete.
# Overpass is often at capacity (HTTP 502/504, or a "remark" in the body), so every request retries with backoff.
# This is a prototype convenience only: production tiles come from a Geofabrik extract (see ../README.md, WS1).
set -e
cd "$(dirname "$0")/.."
mkdir -p raw/paths
API=https://overpass-api.de/api/interpreter
UA=ride-on-map-prototype/0.1

fetch() { # fetch <out> <query>
  out=$1 q=$2
  [ -s "$out" ] && grep -q '"elements"' "$out" && ! grep -q '"remark"' "$out" && return 0
  wait=10 i=0
  while :; do
    i=$((i + 1))
    code=$(curl -s -m 600 -o "$out" -w '%{http_code}' -A "$UA" --data-urlencode "data=$q" "$API")
    echo "$out attempt $i: HTTP $code $(wc -c < "$out")"
    [ "$code" = 200 ] && ! grep -q '"remark"' "$out" && return 0
    [ $i -ge 20 ] && echo "giving up on $out" && return 1
    sleep $wait; [ $wait -lt 120 ] && wait=$((wait * 2))
  done
}

for net in national regional london; do fetch "raw/$net.json" "$(cat overpass/routes-$net.overpass)"; done
fetch raw/pois.json "$(cat overpass/pois.overpass)"

for lat in 50.70 51.17 51.64; do for lon in -1.40 -0.80 -0.20 0.40; do
  bbox="$lat,$lon,$(echo "$lat + 0.47" | bc),$(echo "$lon + 0.60" | bc)"
  fetch "raw/paths/${lat}_${lon}.json" "[out:json][timeout:300];(way[\"highway\"=\"cycleway\"]($bbox);way[\"highway\"=\"bridleway\"]($bbox);way[\"highway\"~\"^(path|footway|pedestrian|track)\$\"][\"bicycle\"~\"^(yes|designated|permissive)\$\"]($bbox););out tags geom;"
done; done
