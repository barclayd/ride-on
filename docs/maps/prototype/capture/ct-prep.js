async () => {
  const style = document.createElement('style')
  style.textContent = '#sidebar_column, .leaflet-control-container, #map_nav_panel { display: none !important }'
  document.head.appendChild(style)
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const pending = [...document.querySelectorAll('img.leaflet-tile')].filter((t) => !t.complete).length
      if (!pending) break
      await new Promise((r) => setTimeout(r, 250))
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  await settle()
  const lmap = Object.values(window).find((v) => v && v._container && typeof v.getCenter === 'function')
  return { center: lmap?.getCenter(), zoom: lmap?.getZoom(), href: location.href }
}
