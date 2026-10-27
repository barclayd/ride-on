// Liquid Glass refraction (SPEC §9): one SVG backdrop filter per .glass element. The middle is the
// frosted base (blur + saturate); across the rim the sharp backdrop bends, as light does through a
// convex edge. A CSS blur first would leave nothing sharp to bend, so the blur lives in the filter.
// Chromium only: Safari and Firefox accept `backdrop-filter: url()` but don't draw it, so the gate
// also needs navigator.userAgentData, an API only Chromium ships. Markup: any .glass element, then
// RideOnGlass.refractAll(). It sets --glass-lens, which replaces the frosted chain in ride-on.css,
// so the Reduce Transparency and contrast fallbacks still win. RideOnGlass.watch() also follows
// elements added later and refits each lens when its element resizes.
(() => {
  const NS = 'http://www.w3.org/2000/svg'
  const supported = CSS.supports('backdrop-filter', 'url(#a)') && 'userAgentData' in navigator
  let defs
  let n = 0

  // A displacement map for a w×h rounded rect: R and G push the rim's samples inward, and alpha is
  // the rim mask, 1 at the edge fading to 0 at the bezel's inner side. The mask can't be a colour
  // channel: Chrome converts the image to the display's gamut, and on a P3 screen R and G leak into B.
  const lensMap = (w, h, r, bezel, depth) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - w / 2
        const py = y + 0.5 - h / 2
        const qx = Math.abs(px) - (w / 2 - r)
        const qy = Math.abs(py) - (h / 2 - r)
        let nx = 0, ny = 0, dist
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy)
          nx = qx / l
          ny = qy / l
          dist = r - l
        } else if (qx > qy) {
          nx = 1
          dist = r - qx
        } else {
          ny = 1
          dist = r - qy
        }
        const t = Math.max(0, 1 - Math.max(0, dist) / bezel)
        const m = depth * t * t
        const i = (y * w + x) * 4
        img.data[i] = 127.5 - 127.5 * Math.sign(px) * nx * (m / depth)
        img.data[i + 1] = 127.5 - 127.5 * Math.sign(py) * ny * (m / depth)
        img.data[i + 2] = 128
        img.data[i + 3] = 255 * Math.sqrt(t)
      }
    ctx.putImageData(img, 0, 0)
    return c.toDataURL()
  }

  // One filter per size and shape, shared by every element that matches.
  const made = new Map()
  const refract = (el) => {
    const w = Math.round(el.offsetWidth)
    const h = Math.round(el.offsetHeight)
    if (!w || !h) return
    const css = getComputedStyle(el)
    const r = Math.min(parseFloat(css.borderTopLeftRadius) || 0, w / 2, h / 2)
    const blur = parseFloat(css.getPropertyValue('--glass-blur')) || 24
    const saturate = parseFloat(css.getPropertyValue('--glass-saturate')) / 100 || 1.8
    const shape = `${w}x${h}x${r}x${blur}x${saturate}`
    if (made.has(shape)) return el.style.setProperty('--glass-lens', `url(#${made.get(shape)})`)
    const bezel = Math.min(24, Math.min(w, h) / 3)
    const depth = bezel
    if (!defs) {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('aria-hidden', 'true')
      svg.style.cssText = 'position:absolute;width:0;height:0'
      defs = svg.appendChild(document.createElementNS(NS, 'defs'))
      document.body.append(svg)
    }
    const id = `glass-lens-${++n}`
    const f = defs.appendChild(document.createElementNS(NS, 'filter'))
    for (const [k, v] of Object.entries({ id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v)
    const img = f.appendChild(document.createElementNS(NS, 'feImage'))
    for (const [k, v] of Object.entries({ href: lensMap(w, h, r, bezel, depth), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' })) img.setAttribute(k, v)
    const add = (tag, attrs) => {
      const e = f.appendChild(document.createElementNS(NS, tag))
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
      return e
    }
    // The blur fades out towards the element's edges (Chrome ignores edgeMode), which would let the sharp
    // backdrop through; un-premultiplying back to full alpha keeps the frost solid to the edge.
    add('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: blur, result: 'haze' })
    add('feColorMatrix', { in: 'haze', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1', result: 'frost' })
    add('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 1, result: 'soft' })
    add('feDisplacementMap', { in: 'soft', in2: 'map', scale: depth * 2, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' })
    add('feComposite', { in: 'bent', in2: 'map', operator: 'in', result: 'edge' })
    const merge = add('feMerge', { result: 'glass' })
    for (const i of ['frost', 'edge']) merge.appendChild(document.createElementNS(NS, 'feMergeNode')).setAttribute('in', i)
    add('feColorMatrix', { in: 'glass', type: 'saturate', values: saturate })
    made.set(shape, id)
    el.style.setProperty('--glass-lens', `url(#${id})`)
  }

  // A filter is drawn for one size, so while an element resizes (a sheet changing detent) it shows the
  // frost, and the lens comes back once the size has held for 150ms.
  const seen = new WeakSet()
  const timers = new WeakMap()
  const sized = new ResizeObserver((entries) => {
    for (const { target: el } of entries) {
      if (!seen.has(el)) {
        seen.add(el)
        refract(el)
        continue
      }
      el.style.removeProperty('--glass-lens')
      clearTimeout(timers.get(el))
      timers.set(el, setTimeout(() => refract(el), 150))
    }
  })
  const track = (root) => {
    if (root.matches?.('.glass')) sized.observe(root)
    root.querySelectorAll?.('.glass').forEach((el) => sized.observe(el))
  }

  window.RideOnGlass = {
    supported,
    refractAll: (root = document) => supported && track(root),
    // refractAll, then the same for every .glass element added under root later.
    watch: (root = document.body) => {
      if (!supported) return
      track(root)
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(track))).observe(root, { childList: true, subtree: true })
    },
  }
})()
