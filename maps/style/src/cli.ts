// bun src/cli.ts native                        → the app's style.json and sprite (CycleMap resources)
// bun src/cli.ts web <out> <origin> [<tiles>]  → a style for the browser prototype
import { format } from '@maplibre/maplibre-gl-style-spec'
import { buildSprite, formatIndex } from './sprite.ts'
import { buildStyle } from './style.ts'
import { appResources, native, web } from './targets.ts'

const [command, ...args] = process.argv.slice(2)
const [out, style] =
  command === 'native'
    ? [new URL('style.json', appResources), buildStyle(native)]
    : command === 'web' && args[0] && args[1]
      ? [args[0], buildStyle(web(args[1], args[2]))]
      : (() => {
          throw new Error('usage: bun src/cli.ts native | web <out> <origin> [<tiles>]')
        })()
await Bun.write(out, `${format(style, 1)}\n`)
console.log(`${style.layers.length} layers → ${out instanceof URL ? out.pathname : out}`)

if (command === 'native') {
  const { index, png } = buildSprite()
  await Bun.write(new URL('sprite@2x.json', appResources), formatIndex(index))
  await Bun.write(new URL('sprite@2x.png', appResources), png)
  console.log(`${Object.keys(index).length} images → ${new URL('sprite@2x.png', appResources).pathname}`)
}
