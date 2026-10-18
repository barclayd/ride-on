async () => {
  for (let i = 0; i < 80; i++) {
    if (window.map?.loaded() && window.map.areTilesLoaded()) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 800))
  return { center: map.getCenter(), zoom: map.getZoom() }
}
