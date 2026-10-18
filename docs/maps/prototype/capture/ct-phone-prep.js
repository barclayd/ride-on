async () => {
  // cycle.travel's mobile layout (viewport 402x299x3,mobile,touch): hide everything but the map, which
  // then fills the viewport centred on the URL's lat/lon, then wait for the tiles.
  const map = document.querySelector('.leaflet-container')
  const keep = new Set()
  for (let el = map; el; el = el.parentElement) keep.add(el)
  for (const el of keep) {
    for (const sibling of el.parentElement?.children ?? []) {
      if (!keep.has(sibling) && sibling.tagName === 'DIV') sibling.style.setProperty('display', 'none', 'important')
    }
  }
  const style = document.createElement('style')
  style.textContent = '.leaflet-control-container { display: none !important }'
  document.head.appendChild(style)
  for (let i = 0; i < 40; i++) {
    const pending = [...document.querySelectorAll('img.leaflet-tile')].filter((t) => !t.complete).length
    if (!pending) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 800))
  const lmap = Object.values(window).find((v) => v && v._container && typeof v.getCenter === 'function')
  return { center: lmap?.getCenter(), zoom: lmap?.getZoom(), size: lmap?.getSize() }
}
