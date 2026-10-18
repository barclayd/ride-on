#!/bin/sh
# Captures the app's cycle map (`--cycle-map`) in the iOS Simulator for the comparison views: the Routes
# map's window above the panel at medium, 402×299 pt from y = 70 pt, at 3× on an iPhone 17 (1206×897 px).
# ml-headless.mjs --phone takes the prototype at the same size; cycle.travel's side is a display Chrome
# emulating 402x299x3 (prototype README).
# Usage: sh capture/app-sim.sh <simulator udid> <outDir> [view ...]   (Ride On installed on that simulator)
# Name the simulator: never `booted`, which may pick someone's own device simulator.
set -eu
sim=$1 out=$2
shift 2
views='london-z9:51.45,-0.15,9 london-z11:51.48,-0.17,11 putney-z13:51.462,-0.215,13
westminster-z14:51.5005,-0.128,14 richmond-park-z13:51.4455,-0.2665,13 surrey-hills-z12:51.245,-0.33,12
harwich-z9:51.93,1.2,9 harwich-z10:51.93,1.2,10 harwich-z11:51.93,1.2,11 colchester-z12:51.8787,0.964,12'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for view in $views; do
  name=${view%%:*} camera=${view#*:}
  if [ $# -gt 0 ] && ! printf ' %s ' "$*" | grep -q " $name "; then continue; fi
  xcrun simctl launch --terminate-running-process "$sim" com.danbarclay.rideon \
    --fixture-world --cycle-map -CycleMapCamera "$camera" > /dev/null
  # Settled when two crops a second apart are identical (tiles, labels and fades all done).
  i=0
  rm -f "$tmp/prev.png"
  while [ $i -lt 40 ]; do
    sleep 1
    xcrun simctl io "$sim" screenshot "$tmp/full.png" > /dev/null 2>&1
    sips -c 897 1206 --cropOffset 210 0 "$tmp/full.png" --out "$tmp/crop.png" > /dev/null
    if [ $i -ge 3 ] && [ -f "$tmp/prev.png" ] && cmp -s "$tmp/crop.png" "$tmp/prev.png"; then break; fi
    mv "$tmp/crop.png" "$tmp/prev.png"
    i=$((i + 1))
  done
  mv "$tmp/crop.png" "$out/app-$name.png"
  echo "$name settled after ${i}s"
done
