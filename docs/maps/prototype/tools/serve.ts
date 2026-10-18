// Static server for the prototype (with single byte ranges, for data/cycling.pmtiles) plus a Range proxy to
// strava-stitch's Protomaps world file.
const root = process.argv[2]
const upstream = 'https://stravastitch.com/maps/world-20260908.pmtiles'
Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/world.pmtiles') {
      const headers: Record<string, string> = { 'user-agent': 'ride-on-map-prototype/0.1' }
      const range = req.headers.get('range')
      if (range) headers.range = range
      const res = await fetch(upstream, { headers })
      const out = new Headers()
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
        const v = res.headers.get(h)
        if (v) out.set(h, v)
      }
      out.set('access-control-allow-origin', '*')
      return new Response(res.body, { status: res.status, headers: out })
    }
    const file = Bun.file(root + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)))
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
