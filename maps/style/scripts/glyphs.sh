#!/bin/sh
# Builds the Montserrat glyph PBFs into the app's CycleMap resources (glyphs/<font stack>/<range>.pbf).
# Needs `cargo install build_pbf_glyphs` (Stadia Maps' SDF glyph builder) on PATH. Faces must match `faces` in
# src/style.ts; the tests check they do.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
dest=$here/../../app/Packages/Features/Sources/RoutesUI/CycleMap/glyphs
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Static Montserrat instances (SIL OFL 1.1) from the upstream repo, pinned to a commit and checked.
upstream=https://raw.githubusercontent.com/JulietaUla/Montserrat/555facfb2a18
mkdir "$work/ttf"
for face in Regular Italic Medium MediumItalic SemiBold Bold; do
  curl -sfL -o "$work/ttf/Montserrat-$face.ttf" "$upstream/fonts/ttf/Montserrat-$face.ttf"
done
curl -sfL -o "$work/OFL.txt" "$upstream/OFL.txt"
(cd "$work" && shasum -a 256 -c - >/dev/null) <<'SUMS'
3e8abe50c44c82e2242e97d1ec8c0d385c4890cdc50447bcdb8605c81a38cfb2  ttf/Montserrat-Regular.ttf
b8fa0ea7f433669d94d27e66ea81cc627deb71861ed9d20f53d7afa1f33ba86a  ttf/Montserrat-Italic.ttf
dae47428bb041f9716604e0e07b5b0c8585b3bdd8183362f75c69fe7bb3cfaf4  ttf/Montserrat-Medium.ttf
b544641c1fde7c5228a26ddade08870a9c1dc7426446828fc8aa8acab2521a45  ttf/Montserrat-MediumItalic.ttf
b4e1563393d73fdff491a869441245aef31add2ec03d9c97a6dae4de07c52fd0  ttf/Montserrat-SemiBold.ttf
bc6e854971cea46b463be6f9eef4d9cd52f51cfc1fc0dd90c9d3e6483dc0ec61  ttf/Montserrat-Bold.ttf
8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e  OFL.txt
SUMS
build_pbf_glyphs "$work/ttf" "$work/glyphs" >/dev/null

# Latin, Latin-1, Latin Extended-A/B (Welsh ŵ ŷ), Latin Extended Additional (ẁ ẃ ỳ), punctuation and letterlike
# symbols. Other ranges are left out: GB labels rarely need them, and MapLibre just drops a label it can't draw.
rm -rf "$dest"
for face in "$work"/glyphs/*; do
  mkdir -p "$dest/${face##*/}"
  for range in 0-255 256-511 512-767 7680-7935 8192-8447 8448-8703; do
    cp "$face/$range.pbf" "$dest/${face##*/}/"
  done
done
cp "$work/OFL.txt" "$dest/"
du -sh "$dest"
