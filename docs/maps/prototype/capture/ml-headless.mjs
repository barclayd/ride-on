// Captures the prototype for the comparison views in headless Chrome, 1200×800 at DPR 2, or with --phone
// 402×299 at DPR 3: the iPhone 17's Routes map above the panel at medium, as capture/app-sim.sh takes it.
// cycle.travel refuses headless browsers (403), so its side still comes from capture/ct-prep.js in a
// display Chrome; analysis/lut.py maps these captures' colours to that display's.
// Usage: bun capture/ml-headless.mjs [--phone] <outDir> [viewName ...]   (with `bun run serve` running)
import { chromium } from 'playwright-core'

const views = [
  ['london-z9', 51.45, -0.15, 9],
  ['london-z11', 51.48, -0.17, 11],
  ['putney-z13', 51.462, -0.215, 13],
  ['westminster-z14', 51.5005, -0.128, 14],
  ['richmond-park-z13', 51.4455, -0.2665, 13],
  ['surrey-hills-z12', 51.245, -0.33, 12],
  ['harwich-z9', 51.93, 1.2, 9],
  ['harwich-z10', 51.93, 1.2, 10],
  ['harwich-z11', 51.93, 1.2, 11],
  ['colchester-z12', 51.8787, 0.964, 12],
]

const phone = process.argv[2] === '--phone'
const [outDir, ...only] = process.argv.slice(phone ? 3 : 2)
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--force-color-profile=srgb'],
})
const context = await browser.newContext(
  phone ? { viewport: { width: 402, height: 299 }, deviceScaleFactor: 3 } : { viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 },
)
const page = await context.newPage()

for (const [name, lat, lon, z] of views) {
  if (only.length && !only.includes(name)) continue
  await page.goto(`http://localhost:8787/#${z}/${lat}/${lon}`)
  const state = await page.evaluate(async (phone) => {
    // GL JS's zoom buttons and attribution aren't in the app's map window: leave them out of phone captures.
    if (phone) document.querySelector('.maplibregl-control-container')?.style.setProperty('display', 'none')
    for (let i = 0; i < 160; i++) {
      if (window.map?.loaded() && window.map.areTilesLoaded()) break
      await new Promise((r) => setTimeout(r, 250))
    }
    await new Promise((r) => setTimeout(r, 1500))
    return { center: map.getCenter(), zoom: map.getZoom(), loaded: map.loaded() }
  }, phone)
  await page.screenshot({ path: `${outDir}/ml-${name}.png` })
  console.log(name, JSON.stringify(state))
}

await browser.close()
