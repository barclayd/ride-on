// Static server for the prototype, with single byte ranges (for PMTiles archives in data/), plus the app's files
// that the style reads: /glyphs/ (Montserrat glyph PBFs) and /sprite. The app's sprite is only `@2x`, drawn at 3×
// with its pixelRatio in the index, so it's served for `/sprite` (1× screens) too.
const root = process.argv[2]
const app = new URL('../../../../app/Packages/Features/Sources/SharedUI/CycleMap', import.meta.url).pathname
const sprite = /^\/sprite(@2x)?\.(json|png)$/
Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname)
    const file = Bun.file(
      path.startsWith('/glyphs/')
        ? app + path
        : sprite.test(path)
          ? `${app}/sprite@2x.${path.endsWith('.png') ? 'png' : 'json'}`
          : root + (path === '/' ? '/index.html' : path),
    )
    if (!(await file.exists())) return new Response('not found', { status: 404 })
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '')
    if (range) {
      const start = Number(range[1])
      const end = Math.min(range[2] ? Number(range[2]) : file.size - 1, file.size - 1)
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } })
      return new Response(file.slice(start, end + 1), { status: 206, headers: {
        'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${file.size}` } })
    }
    return new Response(file, { headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } })
  },
})
console.log('listening on http://localhost:8787')
