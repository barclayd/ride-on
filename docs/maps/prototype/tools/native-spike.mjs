// WS3.0 spike: the prototype's style cut down for MapLibre Native in the app, written to the
// RoutesUI resources. Basemap layers only (the cycling overlay is GeoJSON until WS1.2), glyph PBFs
// instead of `font-faces`, and the basemap from Ride On's own R2 copy. WS2 replaces this with the
// production style builder.
import { readFileSync, writeFileSync } from 'node:fs'

const [input, out] = process.argv.slice(2)
const style = JSON.parse(readFileSync(input, 'utf8'))

// Glyph directories are named after the TTF files ("Montserrat-MediumItalic"): no spaces in URLs.
const faces = Object.fromEntries(Object.keys(style['font-faces']).map((name) => [name, name.replace(' ', '-').replaceAll(' ', '')]))
const rename = (value) =>
  typeof value === 'string' ? (faces[value] ?? value)
    : Array.isArray(value) ? value.map(rename)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v)]))
    : value

const { 'font-faces': _, sources, layers, ...rest } = style
const spike = {
  ...rest,
  name: 'Ride On cycle map (WS3.0 spike)',
  // `bundle://` is swapped for the resource bundle's file URL at runtime (CycleMapSpike.swift).
  glyphs: 'bundle://glyphs/{fontstack}/{range}.pbf',
  sources: { basemap: { ...sources.basemap, url: 'pmtiles://https://maps.ride-on.cc/basemap-gb-20261017.pmtiles' } },
  layers: rename(layers.filter((layer) => !layer.source || layer.source === 'basemap')),
}
writeFileSync(out, `${JSON.stringify(spike, null, 1)}\n`)
console.log(spike.layers.length, 'layers;', Object.values(faces).join(', '))
