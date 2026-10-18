#!/bin/sh
# WS3.0 spike: builds the app's spike style and Montserrat glyph PBFs into RoutesUI's resources.
# Needs `cargo install build_pbf_glyphs` (Stadia Maps' SDF glyph builder) on PATH.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
dest=$here/../../../app/Packages/Features/Sources/RoutesUI/CycleMapSpike
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Static Montserrat instances (SIL OFL 1.1) from the upstream repo, pinned to a commit.
mkdir "$work/ttf"
for face in Regular Italic Medium MediumItalic SemiBold SemiBoldItalic Bold; do
  curl -sfL -o "$work/ttf/Montserrat-$face.ttf" \
    "https://raw.githubusercontent.com/JulietaUla/Montserrat/555facfb2a18/fonts/ttf/Montserrat-$face.ttf"
done
build_pbf_glyphs "$work/ttf" "$work/glyphs" >/dev/null

# Latin, Latin-1, Latin Extended-A/B (Welsh ŵ ŷ), Latin Extended Additional (ẁ ẃ ỳ), punctuation and
# letterlike symbols. Other ranges are left out: the GB basemap labels rarely need them.
rm -rf "$dest/glyphs"
for face in "$work"/glyphs/*; do
  mkdir -p "$dest/glyphs/${face##*/}"
  for range in 0-255 256-511 512-767 7680-7935 8192-8447 8448-8703; do
    cp "$face/$range.pbf" "$dest/glyphs/${face##*/}/"
  done
done
cp "$here/fonts/OFL.txt" "$dest/glyphs/"
node "$here/tools/native-spike.mjs" "$here/style.json" "$dest/style.json"
du -sh "$dest"
