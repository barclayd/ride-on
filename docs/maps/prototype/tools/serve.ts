// Static server for the prototype, with single byte ranges (for PMTiles archives in data/), plus /glyphs/: the
// app's Montserrat glyph PBFs, which the style reads.
const root = process.argv[2]
const glyphs = new URL('../../../../app/Packages/Features/Sources/RoutesUI/CycleMap/glyphs', import.meta.url).pathname
Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname)
    const file = Bun.file(
      path.startsWith('/glyphs/') ? glyphs + path.slice('/glyphs'.length) : root + (path === '/' ? '/index.html' : path),
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
