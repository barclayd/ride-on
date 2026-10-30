const h = React.createElement
// The 15 fixture routes (SPEC §13): name, km, departs, back by, start/finish °C, wind, mean wind km/h,
// climb m, unpaved %, from cycle.travel.
const R = Object.fromEntries(Object.entries({
  '6b8b1863': ['Ripley café loop', 49.6, '10:00', '12:30', 10, 13, 'SW 18', 18, 267, 4, 1],
  '4e5ad57f': ['Windsor Great Park', 62.9, '09:30', '12:25', 9, 13, 'SW 18', 18, 225, 12, 1],
  c93c3293: ['Thames to Walton', 24.0, '11:00', '12:10', 12, 13, 'SW 18', 18, 59, 46, 1],
  '1eaf3c4f': ['Box Hill via Leatherhead', 55.7, '09:30', '12:20', 9, 12, 'gusts 32', 20, 488, 4, 1],
  b070c882: ['Richmond Park laps', 14.6, '12:00', '12:45', 13, 14, 'SW 20', 20, 119, 3, 1],
  '9e2b57c8': ['Esher & Claygate lanes', 29.0, '11:30', '12:55', 12, 13, 'SW 19', 19, 196, 2, 1],
  c5b155ac: ['Hampton Court & Bushy Park', 10.0, '13:00', '13:30', 13, 14, 'SW 21', 21, 51, 18, 1],
  e8d1896c: ['Runnymede & Staines', 52.1, '10:00', '12:25', 10, 13, 'SW 22', 22, 87, 21, 0],
  c8377ae3: ['Wimbledon Common', 21.7, '12:30', '13:35', 13, 14, 'gusts 34', 22, 131, 24, 1],
  fdbf61dc: ['Ham & Petersham riverside', 10.7, '13:30', '14:00', 14, 14, 'W 24', 24, 44, 38, 1],
  bcb8871c: ['Epsom Downs & Headley', 45.2, '09:00', '11:30', 9, 12, 'SW 22', 22, 416, 6, 0],
  a93550f3: ['Leith Hill & the Surrey Hills', 84.8, '', '', 0, 0, '', 0, 1072, 9, 1],
  ce0800ee: ['Barnes & Putney Bridge', 21.5, '11:00', '12:05', 12, 13, 'SW 18', 18, 103, 27, 1],
  '7376c6f8': ["Chertsey & St Ann's Hill", 47.5, '10:00', '12:10', 10, 13, 'SW 20', 20, 79, 8, 1],
  cc320e1e: ['Ranmore Common', 55.8, '09:30', '12:20', 9, 12, 'SW 22', 22, 517, 7, 1],
}).map(([k, [name, km, dep, end, lo, hi, wt, w, climb, unp, src]]) => [k, { name, km, dep, end, lo, hi, wt, w, climb, unp, src, short: name.replace(/ (café|Great|to|via|Park|&|Common|Downs|Court).*/, '') }]))
const RIPLEY = '6b8b1863'
const LEITH = 'a93550f3'
const DEFAULT = ['6b8b1863', '4e5ad57f', 'c93c3293', '1eaf3c4f', 'b070c882', '9e2b57c8', 'c5b155ac', 'e8d1896c', 'c8377ae3', 'fdbf61dc', 'bcb8871c']
// Saturday's scores at the default preferences; the library's three are what they'd score once added.
const BASE = { '6b8b1863': 84, '4e5ad57f': 79, c93c3293: 76, '1eaf3c4f': 71, b070c882: 68, '9e2b57c8': 66, c5b155ac: 63, e8d1896c: 61, c8377ae3: 57, fdbf61dc: 52, bcb8871c: 44, ce0800ee: 73, '7376c6f8': 64, cc320e1e: 59 }
// Each day's best over the default shortlist, Sat 24 to Fri 30 Oct. Tuesday rains all day: nothing scores.
const T = [84, 72, 58, null, 47, 66, 74]
const DAY = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const LONG = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
// ponytail: other days are Saturday shifted to T[d] plus a fixed jitter per route; departures and weather stay Saturday's.
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const raw = (k, d) => (d ? BASE[k] - (84 - T[d]) + (hash(k + d) % 11) - 5 : BASE[k])
const SHIFT = T.map((t, d) => (t == null ? 0 : t - Math.max(...DEFAULT.map((k) => raw(k, d)))))
const band = (s) => (s >= 75 ? 'great' : s >= 60 ? 'good' : s >= 50 ? 'fair' : 'notrec')
// Route identity colours (SPEC §6.2), slot order: the first slots are the most distinct, so a short shortlist
// is always easy to tell apart. The map stays light, so lines use these; panels use var(--route-n), lighter in dark mode.
const HUES = ['#026fd7', '#fd7306', '#a30362', '#07bba4', '#935f05', '#a989ff', '#7704aa', '#eb3067', '#088963', '#942300', '#0695b5', '#ff7c8a']
const WORD = { great: 'Great', good: 'Good', fair: 'Fair', notrec: 'Not recommended' }
const DELTA = { '4e5ad57f': '▲ 1', '1eaf3c4f': '▼ 2' }
const BELOW = { bcb8871c: 'Below your minimums: gusts 38 km/h' }
// Wind along every route, as fractions of the way round (SPEC §6.8): t tailwind, c crosswind, h headwind.
const STRETCH = [['c', 0, 0.1], ['h', 0.1, 0.38], ['c', 0.38, 0.54], ['t', 0.54, 1]]
const WIND_C = { t: 'var(--band-great)', c: 'var(--status-crosswind)', h: 'var(--status-headwind)' }
const WIND_W = { t: 'Tailwind', c: 'Crosswind', h: 'Headwind' }
const RAMP = [[-5, [13, 38, 140]], [4, [102, 178, 255]], [14, [52, 199, 89]], [21, [255, 204, 0]], [27, [255, 149, 0]], [33, [255, 59, 48]]]
const ramp = (t) => {
  for (let i = 1; i < RAMP.length; i++) {
    const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i]
    if (t <= t1) return `rgb(${c0.map((a, j) => Math.round(a + Math.max(0, (t - t0) / (t1 - t0)) * (c1[j] - a))).join(' ')})`
  }
  return 'rgb(255 59 48)'
}
const tpos = (t) => ((t + 5) / 40) * 100
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3)
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v))
const PAUSE = [['3 days', 'until Tue 27 Oct'], ['1 week', 'until Sat 31 Oct'], ['Until I resume', '']]
const PAD = { desk: { top: 72, right: 40, bottom: 140, left: 416 }, phone: { top: 112, right: 28, bottom: 596, left: 28 } }
const STEPS = [
  'You land on the best day: Saturday. Its best pick leads the panel. Each route has its own colour: the line under its score matches its line on the map.',
  'Hover a line on the map. The glance card shows its score, the conditions and the verdict.',
  'Click a line, or a row in the panel, to open the route.',
  'Scrub the elevation profile and the dot runs round the map. Run along the line on the map and the profile follows.',
  'Turn on Show wind on the map: the route redraws as headwind, crosswind and tailwind.',
  'Pick another day. The panel dims while the forecast is checked, then the new scores arrive.',
  'Add a library route to your full shortlist. Choose one to swap out: the lowest scorer is picked for you.',
  "Preferences, then Ideal Temperature: drag the low handle up and watch each route's fit change.",
  'Pause Ride On: the map goes quiet. Then Resume.',
]
const INIT = { view: 'home', dir: '', sel: null, day: 0, shownDay: 0, shortlist: [...DEFAULT, LEITH], library: ['ce0800ee', '7376c6f8', 'cc320e1e'], hue: Object.fromEntries([...DEFAULT, LEITH].map((k, i) => [k, i])), checking: [], stale: false, ideal: [11, 18], paused: false, pauseFor: 1, pausedOnce: false, wind: false, scrub: null, scrubSrc: null, hover: [], glance: [], glanceDemo: false, rowHover: null, pop: null, toast: null, detent: 'medium', scrolled: false, q: '' }

class Component extends DCLogic {
  constructor(props) {
    super(props)
    this.state = { ...INIT, mode: innerWidth < 700 ? 'phone' : 'desk', theme: 'light', done: {} }
    this.timers = []
  }

  componentDidMount() {
    const el = document.querySelector('.proto [data-live]')
    if (!el) return setTimeout(() => this.componentDidMount(), 50)
    this.el = el
    // A logic hot swap mounts again: keep the one map, and send its callbacks to the newest logic.
    el._logic = this
    if (el._ctl) this.push()
    else if (!el._mounting) {
      el._mounting = true
      const go = () => {
        if (!(window.RideOnLive && window.RideOnMap && window.RIDE_ON_ROUTES && window.RIDE_ON_ELEV)) return setTimeout(go, 50)
        window.RideOnLive.mount(el, {
          pad: PAD[this.state.mode],
          onHover: (...a) => el._logic.onHover(...a),
          onSelect: (keys) => el._logic.onSelect(keys),
          onScrub: (t) => el._logic.onScrub(t),
          onReady: () => el._logic.onReady(),
        }).then((ctl) => {
          el._ctl = ctl
          el._logic.push()
        })
      }
      go()
    }
    if (!window.__rideOnProto) {
      window.__rideOnProto = true
      const glass = () => (window.RideOnGlass ? window.RideOnGlass.watch(document.querySelector('.proto')) : setTimeout(glass, 50))
      document.fonts.ready.then(glass)
      // The phone frame scales down to fit short windows.
      const k = () => document.querySelector('.proto')?.style.setProperty('--k', Math.min(1, (innerHeight - 32) / 852))
      addEventListener('resize', k)
      k()
    }
  }

  componentDidUpdate() {
    const p = this.prev || {}
    const s = (this.prev = this.state)
    this.push()
    const ctl = this.el?._ctl
    if (!ctl) return
    if (p.mode && p.mode !== s.mode) setTimeout(() => ctl.fit(s.sel, PAD[s.mode], 0), 60)
    else if (s.sel && p.sel !== s.sel) ctl.fit(s.sel, PAD[s.mode])
    else if (p.view === 'detail' && s.view !== 'detail') ctl.fit(null, PAD[s.mode])
    if (p.view !== s.view || p.sel !== s.sel) this.panelS()?.scrollTo(0, 0)
    if (p.glance !== s.glance) this.place()
  }

  later = (fn, ms) => {
    const id = setTimeout(fn, ms)
    this.timers.push(id)
    return id
  }
  mark = (n) => this.state.done[n] || this.setState({ done: { ...this.state.done, [n]: true } })
  step = () => {
    const { done, mode } = this.state
    for (let n = 1; n <= 9; n++) if (!(done[n] || (n === 1 && Object.keys(done).length) || (n === 2 && mode === 'phone'))) return n
    return 10
  }
  panelS = () => document.querySelector('.proto aside .panel-s')

  scoresFor(d, s = this.state) {
    if (T[d] == null) return {}
    const [lo, hi] = s.ideal
    const out = {}
    for (const k of s.shortlist) {
      if (k === LEITH) continue
      const r = R[k]
      // 7 points a degree outside the ideal range, relative to the default 11–18°.
      const dt = -7 * (Math.max(0, lo - r.lo) - Math.max(0, 11 - r.lo)) - 7 * (Math.max(0, r.hi - hi) - Math.max(0, r.hi - 18))
      out[k] = clamp(Math.round(raw(k, d) + SHIFT[d] + dt))
    }
    return out
  }

  push = () => {
    const s = this.state
    const ctl = this.el?._ctl
    if (!ctl) return
    const scored = s.sel && !s.paused && s.shortlist.includes(s.sel) && s.sel !== LEITH && (s.stale || !s.checking.includes(s.sel))
    ctl.set({ colors: s.paused ? {} : Object.fromEntries(s.shortlist.map((k) => [k, HUES[s.hue[k]]])), sel: s.sel, hover: s.rowHover || s.hover[0] || null, wind: scored && s.wind ? STRETCH : null, scrub: s.view === 'detail' ? s.scrub : null })
  }

  // The glance card sits 16px from the cursor, flipped at the frame's edges (SPEC §6.7).
  place = () => {
    const f = document.querySelector('.proto .frame')
    if (!f || !this.pt) return
    const g = f.querySelector('.glance')
    const { x, y } = this.pt
    const gh = g?.offsetHeight || 170
    const gx = x + 16 + 252 > f.offsetWidth - 12 ? x - 16 - 252 : x + 16
    const gy = y + 16 + gh > f.offsetHeight - 12 ? y - 16 - gh : y + 16
    for (const [k, v] of [['--gx', gx], ['--gy', gy], ['--cx', x], ['--cy', y]]) f.style.setProperty(k, `${v}px`)
  }

  onReady = () => {
    this.setState({ ready: true })
    this.push()
  }
  byScore = (keys) => {
    const sc = this.state.paused ? {} : this.scoresFor(this.state.shownDay)
    return [...keys].sort((a, b) => (sc[b] ?? -1) - (sc[a] ?? -1))
  }
  onHover = (keys, x, y, demo) => {
    const s = this.state
    this.pt = { x, y }
    this.place()
    keys = this.byScore(keys)
    if (keys.join() === this.hk) return
    this.hk = keys.join()
    clearTimeout(this.gt)
    this.setState(s.scrubSrc === 'map' && !keys.includes(s.sel) ? { hover: keys, scrub: null, scrubSrc: null } : { hover: keys })
    const gk = s.mode === 'phone' || s.paused ? [] : keys.filter((k) => !(s.view === 'detail' && k === s.sel)).slice(0, 3)
    const show = () => {
      this.setState({ glance: gk, glanceDemo: !!demo })
      this.mark(2)
    }
    // 120ms in, 100ms grace on the way out; from one line straight to another, no delay.
    if (!gk.length) this.gt = setTimeout(() => this.setState({ glance: [], glanceDemo: false }), 100)
    else if (s.glance.length || demo) show()
    else this.gt = setTimeout(show, 120)
  }
  onSelect = (keys) => this.select(this.byScore(keys)[0])
  onScrub = (t) => {
    if (this.state.view !== 'detail') return
    this.setState({ scrub: t, scrubSrc: 'map' })
    this.mark(4)
  }

  select = (k) => {
    if (!k) return
    this.hk = ''
    this.setState({ view: 'detail', dir: 'push', sel: k, wind: false, scrub: null, scrubSrc: null, glance: [], glanceDemo: false, hover: [], rowHover: null, pop: null, scrolled: false })
    this.mark(3)
  }
  goHome = () => this.setState({ view: 'home', dir: 'pop', sel: null, wind: false, scrub: null, scrubSrc: null, scrolled: false })
  openPrefs = () => this.setState({ view: 'prefs', dir: 'push', sel: null, scrolled: false })
  openIdeal = () => this.setState({ view: 'ideal', dir: 'push', scrolled: false })
  backToPrefs = () => this.setState({ view: 'prefs', dir: 'pop', scrolled: false })

  // A new day: the panel keeps the old day, dimmed, until the forecast is in (SPEC §7.7).
  setDay = (i) => {
    const s = this.state
    if (T[i] == null || i === s.day || s.paused) return
    clearTimeout(this.dt)
    this.setState({ day: i, checking: s.shortlist.filter((k) => k !== LEITH), stale: true })
    this.dt = this.later(() => {
      this.setState({ shownDay: this.state.day, checking: [], stale: false })
      if (this.state.day) this.mark(6)
    }, 1400)
  }
  check = (keys, ms = 1200) => {
    this.setState({ checking: [...new Set([...this.state.checking, ...keys])] })
    this.later(() => this.setState({ checking: this.state.checking.filter((k) => !keys.includes(k)) }), ms)
  }

  // A shortlist holds 12 (SPEC §7.3): a 13th asks which to swap out, the lowest scorer chosen for you.
  addLib = (k, e) => {
    e?.stopPropagation()
    const s = this.state
    if (s.shortlist.length < 12) {
      // The lowest free colour slot; a route keeps its colour for as long as it's shortlisted.
      const used = Object.values(s.hue)
      this.setState({ shortlist: [...s.shortlist, k], library: s.library.filter((x) => x !== k), hue: { ...s.hue, [k]: HUES.findIndex((_, i) => !used.includes(i)) } })
      return this.check([k])
    }
    const sc = this.scoresFor(s.shownDay)
    this.setState({ pop: { add: k, out: Object.keys(sc).sort((a, b) => sc[a] - sc[b])[0] || LEITH }, glance: [] })
  }
  swap = () => {
    const s = this.state
    const { add, out } = s.pop
    this.snap = { shortlist: s.shortlist, library: s.library, hue: s.hue }
    const { [out]: slot, ...hue } = s.hue
    this.setState({ pop: null, shortlist: s.shortlist.map((k) => (k === out ? add : k)), library: [...s.library.filter((k) => k !== add), out], hue: { ...hue, [add]: slot } })
    this.check([add])
    this.toast(`${R[out].name} moved to your library`)
    this.mark(7)
  }
  remove = () => {
    const s = this.state
    this.snap = { shortlist: s.shortlist, library: s.library, hue: s.hue }
    const { [s.sel]: _, ...hue } = s.hue
    this.goHome()
    this.setState({ shortlist: s.shortlist.filter((k) => k !== s.sel), library: [s.sel, ...s.library], hue })
    this.toast(`Removed ${R[s.sel].name}`)
  }
  toast = (text) => {
    clearTimeout(this.tt)
    this.setState({ toast: { text } })
    this.tt = this.later(() => this.setState({ toast: null }), 5000)
  }
  undo = () => {
    if (this.snap) this.setState({ ...this.snap, toast: null })
    this.snap = null
  }

  togglePause = () => (this.state.paused ? this.resume() : this.setState({ paused: true, pausedOnce: true, glance: [], hover: [], wind: false }))
  resume = () => {
    const s = this.state
    this.setState({ paused: false })
    this.check(s.shortlist.filter((k) => k !== LEITH), 1400)
    if (s.pausedOnce) this.mark(9)
  }

  // Ideal Temperature: the nearer handle follows the pointer, -5° to 35°, at least a degree apart.
  rangeAt = (e) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const w = el.offsetWidth
    return clamp(Math.round(-5 + (40 * (((e.clientX - r.left) * w) / r.width - 14)) / (w - 28)), -5, 35)
  }
  rangeDown = (e) => {
    const v = this.rangeAt(e)
    const [lo, hi] = this.state.ideal
    this.drag = Math.abs(v - lo) <= Math.abs(v - hi) ? 0 : 1
    e.currentTarget.setPointerCapture(e.pointerId)
    this.setIdeal(v)
  }
  rangeMove = (e) => this.drag != null && this.setIdeal(this.rangeAt(e))
  rangeUp = () => (this.drag = null)
  setIdeal = (v) => {
    const [lo, hi] = this.state.ideal
    const next = this.drag ? [lo, Math.max(v, lo + 1)] : [Math.min(v, hi - 1), hi]
    if (next[0] === lo && next[1] === hi) return
    this.setState({ ideal: next })
    if (next[0] !== 11 || next[1] !== 18) this.mark(8)
  }

  onProf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    this.setState({ scrub: clamp((e.clientX - r.left) / r.width, 0, 1), scrubSrc: 'prof' })
    this.mark(4)
  }
  offProf = () => this.state.scrubSrc === 'prof' && this.setState({ scrub: null, scrubSrc: null })
  runScrub = () => {
    const t0 = performance.now()
    const tick = (now) => {
      const k = clamp((now - t0) / 2500, 0, 1)
      this.setState({ scrub: 0.62 * (1 - (1 - k) ** 2), scrubSrc: 'demo' })
      if (k < 1) this.raf = requestAnimationFrame(tick)
      else this.mark(4)
    }
    this.raf = requestAnimationFrame(tick)
  }
  onScroll = (e) => {
    const sc = e.currentTarget.scrollTop > 40
    if (sc !== this.state.scrolled) this.setState({ scrolled: sc })
  }
  // The sheet's grabber: a tap toggles the detent, a drag picks one (SPEC §5.2).
  grabDown = (e) => {
    this.gy = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  grabUp = (e) => {
    if (this.gy == null) return
    const dy = e.clientY - this.gy
    const d = this.state.detent
    this.gy = null
    this.setState({ detent: Math.abs(dy) < 6 ? (d === 'large' ? 'medium' : 'large') : dy < -20 ? 'large' : dy > 20 ? 'medium' : d })
  }

  restart = () => {
    this.timers.forEach(clearTimeout)
    this.timers = []
    cancelAnimationFrame(this.raf)
    this.snap = null
    this.hk = ''
    this.setState({ ...INIT, done: {} })
    this.el?._ctl?.fit(null, PAD[this.state.mode])
  }
  doIt = () => {
    const s = this.state
    const ctl = this.el?._ctl
    if (!ctl) return
    const ripley = () => (s.view === 'detail' && s.sel === RIPLEY) || this.select(RIPLEY)
    const reveal = (sel, then) => this.later(() => {
      const ps = this.panelS()
      const el = ps?.querySelector(sel)
      if (el) ps.scrollTo({ top: ps.scrollTop + el.getBoundingClientRect().top - ps.getBoundingClientRect().top - 72, behavior: 'smooth' })
      then?.()
    }, 450)
    ;({
      1: () => {
        ctl.fit(null, PAD[s.mode])
        this.mark(1)
      },
      2: () => {
        if (s.view !== 'home') this.goHome()
        this.later(() => {
          const p = ctl.project('c93c3293', 0.42)
          this.hk = ''
          this.onHover(['c93c3293'], p.x, p.y, true)
        }, s.view === 'home' ? 0 : 900)
      },
      3: ripley,
      4: () => {
        ripley()
        reveal('.prof', () => this.later(this.runScrub, 400))
      },
      5: () => {
        ripley()
        this.setState({ wind: true })
        this.mark(5)
        reveal('.wcard')
      },
      6: () => this.setDay(this.state.day === 1 ? 2 : 1),
      7: () => {
        if (s.pop) return this.swap()
        this.goHome()
        this.addLib(this.state.library[0])
      },
      8: () => {
        this.openIdeal()
        this.later(() => {
          this.drag = 0
          this.setIdeal(12)
          this.drag = null
        }, 600)
      },
      9: () => {
        if (s.paused) return this.resume()
        this.openPrefs()
        this.later(this.togglePause, 600)
        this.later(this.goHome, 1800)
      },
    })[this.step()]?.()
  }

  // The score ring wears the route's colour, like its line on the map.
  ring(v, col) {
    const c = 2 * Math.PI * 28
    return h('svg', { className: 'ring', width: 64, height: 64, viewBox: '0 0 64 64', 'aria-hidden': true },
      h('circle', { cx: 32, cy: 32, r: 28, className: 'ring-t' }),
      h('circle', { cx: 32, cy: 32, r: 28, className: 'ring-v', strokeDasharray: c.toFixed(1), strokeDashoffset: (c * (1 - v / 100)).toFixed(1), transform: 'rotate(-90 32 32)', style: { stroke: col } }),
      h('text', { x: '50%', y: '50%', dy: '0.35em' }, v))
  }
  forecast(r) {
    const t0 = mins(r.dep)
    const dir = r.wt.startsWith('W') ? 'W' : 'SW'
    const kids = [h('span', { key: 'a' }), ...[0, 60, 120].map((m) => h('b', { key: m }, hhmm(t0 + m))), h('span', { key: 'b' }), ...['sun', 'cloud-sun', 'cloud-sun'].map((i, j) => h('i', { key: 'i' + j, className: `icon-${i}` }))]
    for (const [l, vs] of [['Temperature', [r.lo, Math.round((r.lo + r.hi) / 2), r.hi].map((t) => `${t}°`)], ['Wind, km/h', [r.w - 2, r.w, r.w + 1].map((w) => `${dir} ${w}`)], ['Gusts, km/h', [r.w + 8, r.w + 11, r.w + 12]], ['Rain', ['0%', '0%', '5%']]])
      kids.push(h('span', { key: l, className: 'fl' }, l), ...vs.map((v, j) => h('span', { key: l + j }, v)))
    return h('div', { className: 'fc' }, kids)
  }
  // Elevation along the route from elev.js, with the wind and temperature strips when it's scored.
  profile(k, scored, scrub) {
    const E = window.RIDE_ON_ELEV?.[k]
    if (!E) return null
    const r = R[k]
    const e = E.e
    const n = e.length - 1
    const W = 320, top = 22, base = 100
    const max = Math.max(...e)
    const step = [10, 20, 25, 50, 100, 200, 250, 500].find((x) => max / x <= 2.5) || 500
    const ymax = Math.ceil(max / step) * step
    const X = (t) => t * W
    const Y = (m) => base - (m * (base - top)) / ymax
    const pts = e.map((m, i) => `${X(i / n).toFixed(1)},${Y(m).toFixed(1)}`).join(' ')
    const kids = []
    for (let m = step; m <= ymax; m += step) kids.push(h('line', { key: 'g' + m, x1: 0, x2: W, y1: Y(m), y2: Y(m), className: 'gl' }), h('text', { key: 'y' + m, x: 0, y: Y(m) - 3, className: 'yl' }, `${m} m`))
    kids.push(h('polygon', { key: 'a', points: `0,${base} ${pts} ${W},${base}`, className: 'area' }), h('polyline', { key: 'l', points: pts, className: 'eline' }))
    const px = X(e.indexOf(max) / n)
    kids.push(h('text', { key: 'pk', x: px < 70 ? px + 7 : px - 7, y: Y(max) + 3, textAnchor: px < 70 ? 'start' : 'end', className: 'pk' }, `${max} m`))
    const tempAt = (t) => Math.round(r.lo + (r.hi - r.lo) * t)
    if (scored) {
      STRETCH.forEach(([c, a, b], i) => kids.push(h('rect', { key: 'w' + i, x: X(a) + (a ? 1 : 0), y: 110, width: X(b) - X(a) - (a ? 1 : 0), height: 8, rx: 2, style: { fill: WIND_C[c] } })))
      ;[0, 0.28, 0.56, 0.84].forEach((t, i) => kids.push(h('text', { key: 't' + i, x: X(t), y: 136, textAnchor: i ? 'middle' : 'start', className: 'tl' }, `${tempAt(t)}°`)))
    }
    const ax = scored ? 160 : 116
    const ks = [2, 5, 10, 20].find((x) => r.km / x <= 6) || 20
    for (let km = 0; km < r.km - ks / 2; km += ks) kids.push(h('text', { key: 'x' + km, x: X(km / r.km), y: ax, textAnchor: km ? 'middle' : 'start', className: 'xl' }, km))
    kids.push(h('text', { key: 'xkm', x: W, y: ax, textAnchor: 'end', className: 'xl' }, 'km'))
    if (scrub != null) {
      const x = X(scrub)
      const m = e[Math.round(scrub * n)]
      const wind = STRETCH.find(([, a, b]) => scrub >= a && scrub <= b)[0]
      const tag = `${Math.round(scrub * r.km)} km · ${m} m` + (scored ? ` · ${tempAt(scrub)}° · ${WIND_W[wind]}` : '')
      kids.push(h('line', { key: 'c', x1: x, x2: x, y1: top - 4, y2: scored ? 122 : 104, className: 'cur' }), h('circle', { key: 'cd', cx: x, cy: Y(m), r: 5, className: 'cur-dot' }),
        h('g', { key: 'tg', transform: `translate(${clamp(x, 92, W - 92)} 0)` }, h('rect', { x: -92, y: 0, width: 184, height: 18, rx: 9, className: 'tag' }), h('text', { x: 0, y: 12.5, className: 'tag-t' }, tag)))
    }
    return h('svg', { className: 'profile', viewBox: `0 0 ${W} ${scored ? 168 : 124}`, 'aria-hidden': true }, kids)
  }

  renderVals() {
    const s = this.state
    const isPhone = s.mode === 'phone'
    const theme = s.theme === 'dark' ? 'theme-dark' : 'theme-light'
    const sd = s.shownDay
    const all = this.scoresFor(sd)
    const sc = s.paused ? {} : all
    const chk = (k) => s.checking.includes(k) && !s.stale
    const q = s.q.trim().toLowerCase()
    const match = (k) => !q || R[k].name.toLowerCase().includes(q)
    const ranked = Object.keys(sc).filter((k) => !chk(k)).sort((a, b) => sc[b] - sc[a])
    const best = ranked[0]
    const defaults = sd === 0 && s.ideal[0] === 11 && s.ideal[1] === 18
    const verdict = (v) => (v >= 60 ? ['Meets your preferences', 'icon-circle-check', ''] : v >= 50 ? ['Close to your preferences', 'icon-circle-alert', 'close'] : ['Not one for today', 'icon-triangle-alert', 'low'])
    const hov = (k) => (s.rowHover === k || s.hover[0] === k ? 'hover' : '')
    const ev = (k) => ({ go: () => this.select(k), enter: () => this.setState({ rowHover: k }), leave: () => this.setState({ rowHover: null }) })
    const rc = (k) => `var(--route-${s.hue[k] + 1})`
    const cond = (r) => `${r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}° · ${r.wt} km/h · dry`
    const row = (k) => {
      const r = R[k]
      if (chk(k)) return { s: '–', c: rc(k), name: r.name, delta: '', l1: 'Checking the forecast…', l2: `${r.km} km`, below: '', cls: `row tap ${hov(k)}`, ...ev(k) }
      const v = sc[k]
      return { s: v, c: rc(k), name: r.name, delta: (defaults && DELTA[k]) || '', l1: `${WORD[band(v)]} · ${r.dep} → ~${r.end}`, l2: `${r.km} km · ${cond(r)}`, below: BELOW[k] || '', cls: `row tap ${hov(k)}`, ...ev(k) }
    }
    const rows = [...ranked.slice(1), ...s.shortlist.filter(chk)].filter(match).map(row)
    let bestCard = false
    if (best && match(best)) {
      const r = R[best]
      const v = sc[best]
      const [vt, vi, vc] = verdict(v)
      bestCard = { name: r.name, dep: `${r.dep} → ~${r.end}`, facts: `↔ ${r.km} km · ${r.climb} m climb`, s: v, c: rc(best), word: WORD[band(v)], temp: `${r.lo}–${r.hi}°`, wind: `${r.wt} km/h`, verdict: vt, vicon: vi, vcls: `verdict ${vc}`, cls: `card tap ${hov(best)}`, ...ev(best) }
    }
    const plain = (k, facts) => ({ name: R[k].name, facts, cls: `row tap ${hov(k)}`, ...ev(k) })
    const lib = s.library.filter(match).map((k) => ({ ...plain(k, `${R[k].km} km · ${R[k].climb} m · ${R[k].unp}% unpaved`), cls: `row tap lib ${hov(k)}`, src: R[k].src ? 'cycle.travel' : 'GPX upload', add: (e) => this.addLib(k, e) }))
    const days = DAY.map((d, i) => {
      const vs = Object.values(this.scoresFor(i))
      const t = s.paused || !vs.length ? null : Math.max(...vs)
      return { d, s: t ?? '', h: t != null ? Math.round(t * 0.26) : 3, sel: i === s.day, rain: T[i] == null, cls: i === s.day ? 'sel' : t == null ? 'off' : '', go: () => this.setDay(i) }
    })
    const glance = s.glance.map((k) => {
      const r = R[k]
      const v = sc[k]
      if (v == null || chk(k)) return { name: r.name, scored: false, plain: true, sub: `${r.km} km · ${r.climb} m climb`, note: k === LEITH ? "Doesn't fit your window" : s.library.includes(k) ? 'Add to shortlist to score it' : 'Checking the forecast…' }
      const [vt, vi, vc] = verdict(v)
      return { name: r.name, scored: true, plain: false, s: v, c: rc(k), word: WORD[band(v)], sub: `${DAY[sd]} · ${r.dep} → ~${r.end} · ${r.km} km`, temp: `${r.lo}–${r.hi}°`, wind: `${r.wt} km/h`, verdict: vt, vicon: vi, vcls: `verdict ${vc}` }
    })

    let d = false
    if (s.sel) {
      const k = s.sel
      const r = R[k]
      const inList = s.shortlist.includes(k)
      const v = inList && !chk(k) ? sc[k] : undefined
      const scored = v != null
      const b = scored ? band(v) : 'none'
      const [vt, vi, vc] = scored ? verdict(v) : []
      const under = s.ideal[0] - r.lo
      const tnote = `Starts at ${r.lo}°, ${under > 0 ? `${under === 1 ? 'a degree' : `${under} degrees`} under your ideal range` : 'inside your ideal range'}.`
      const t0 = r.dep ? mins(r.dep) : 0
      const date = (i) => `${DAY[i]} ${24 + i}`
      const next = [1, 2, 3, 4, 5, 6].map((j) => sd + j).find((j) => j < 7 && T[j] != null)
      const tiles = !scored ? [] : [[date(sd), r.dep, v, true], [date(sd), hhmm(t0 - 30), v - 3], [date(sd), hhmm(t0 + 60), v - 4], ...(next != null ? [[date(next), r.dep, this.scoresFor(next)[k]]] : [])]
        .map(([dd, t, x, on]) => ({ d: dd, t, s: x, sel: !!on, cls: on ? 'dtile sel' : 'dtile' }))
      const ft = ['Dry for the whole ride.', `Back by ~${r.end}, inside your 09:00–14:00 window.`, r.unp < 10 ? `Almost all tarmac: ${r.unp}% unpaved.` : `${r.unp}% unpaved, on firm towpath and gravel.`, 'Sunny spells for most of the ride.', tnote, `South-westerly ${r.w} km/h, with the tailwind for the last ${Math.round(0.46 * r.km)} km.`, 'A steady endurance loop, as you asked for at weekends.', k === RIPLEY ? 'You rode it 12 days ago.' : "You haven't ridden it this month."]
      const u = scored ? {}
        : s.paused ? { uIcon: 'icon-circle-pause', uTitle: 'Ride On is paused', uText: 'Resume to see forecasts and scores again.', btn: 'Resume', btnGo: this.resume }
        : k === LEITH ? { uIcon: 'icon-clock', uTitle: "Doesn't fit your window", uText: 'Needs about 5 h 10 min. Your window is 09:00–14:00.', btn: '' }
        : !inList ? { uIcon: 'icon-route', uTitle: 'Not on your shortlist', uText: 'Add it to your shortlist to score it for every day this week.', btn: 'Add to Shortlist', btnGo: () => this.addLib(k) }
        : { uIcon: 'icon-loader-circle spin', uTitle: 'Checking the forecast…', uText: 'The score arrives in a moment.', btn: '' }
      d = {
        ...u,
        name: r.name,
        dep: r.dep ? `${r.dep} → ~${r.end}` : '',
        facts: `↔ ${r.km} km · ${r.climb} m climb · ${r.unp}% unpaved`,
        pill: scored && k === best ? `Best pick · ${date(sd)} Oct` : '',
        scored,
        unscored: !scored,
        s: v,
        word: WORD[b],
        verdict: vt,
        vicon: vi,
        vcls: `verdict ${vc}`,
        sub: k === RIPLEY ? (defaults ? '▲ 3 since 07:00 · last ridden 12 Oct' : 'Last ridden 12 Oct') : defaults && DELTA[k] ? `${DELTA[k]} since 07:00` : '',
        ring: scored && this.ring(v, rc(k)),
        tnote,
        wnote: `Headwind for ${Math.round(0.28 * r.km)} km on the way out.`,
        tiles,
        fc: scored && this.forecast(r),
        t0: r.dep,
        t1: `~${r.end}`,
        w: r.w,
        gust: `Gusts up to ${r.w + 12} km/h around ${hhmm(t0 + 120)}`,
        windCls: `switch${s.wind ? ' on' : ''}`,
        wind: s.wind,
        factors: !scored ? [] : [100, 95, 88, 82, 80, 78, 74, 70].map((x, i) => {
          const f = clamp(x + v - 84)
          return { name: ['Rain', 'Time budget', 'Surface', 'Sky', 'Temperature', 'Wind', 'Intent', 'Novelty'][i], v: f, text: ft[i] }
        }),
        profile: this.profile(k, scored, s.scrub),
        cal: `${DAY[sd]} ${r.dep}–${r.end}`,
        src: !!r.src,
        inList,
      }
    }

    const [ilo, ihi] = s.ideal
    const p = (t) => ((t - 6) / 14) * 100
    const n = this.step()
    return {
      frameCls: `frame live ${s.mode} theme-light`,
      isPhone,
      isDesk: !isPhone,
      theme,
      asideCls: isPhone ? `sheet glass ${s.detent === 'large' ? 'large' : ''} ${s.pop ? 'gone' : ''} ${theme}` : `panel glass ${theme}`,
      isHome: s.view === 'home' && !s.paused,
      isPausedHome: s.view === 'home' && s.paused,
      isDetail: s.view === 'detail' && !!d,
      isPrefs: s.view === 'prefs',
      isIdeal: s.view === 'ideal',
      dirCls: `view v-${s.dir}`,
      phCls: `panel-h${s.scrolled ? ' scrolled' : ''}`,
      psCls: `panel-s${s.stale ? ' stale' : ''}`,
      showDays: !s.paused && !(isPhone && (s.detent === 'large' || s.pop)),
      days,
      pill: s.checking.length > 1,
      showGlance: glance.length > 0 && !isPhone,
      glance,
      glanceDemo: s.glanceDemo,
      dayName: DAY[sd],
      best: bestCard,
      rows,
      hasRows: rows.length > 0,
      slCount: `${s.shortlist.length} of 12`,
      leith: s.shortlist.includes(LEITH) && match(LEITH) && { cls: `row tap ${hov(LEITH)}`, c: rc(LEITH), ...ev(LEITH) },
      lib,
      hasLib: lib.length > 0,
      libCount: `${s.library.length} route${s.library.length === 1 ? '' : 's'}`,
      alpha: [...s.shortlist].sort((a, b) => R[a].name.localeCompare(R[b].name)).filter(match).map((k) => plain(k, `${R[k].km} km`)),
      libPlain: s.library.filter(match).map((k) => plain(k, `${R[k].km} km · ${R[k].climb} m · ${R[k].unp}% unpaved`)),
      slPlain: `${s.shortlist.length} routes`,
      d,
      q: s.q,
      onQ: (e) => this.setState({ q: e.target.value }),
      idealText: `${ilo}–${ihi}°`,
      ia: tpos(ilo).toFixed(1),
      ib: tpos(ihi).toFixed(1),
      fits: Object.keys(all).sort((a, b) => all[b] - all[a]).slice(0, 7).map((k) => {
        const r = R[k]
        const under = ilo - r.lo
        const over = r.hi - ihi
        return { name: r.short, il: clamp(p(ilo)).toFixed(1), ir: clamp(100 - p(ihi)).toFixed(1), sl: p(r.lo).toFixed(1), sr: (100 - p(r.hi)).toFixed(1), bg: `linear-gradient(90deg, ${ramp(r.lo)}, ${ramp(r.hi)})`, v: under > 0 ? `${under}° under` : over > 0 ? `${over}° over` : 'In range', cls: under > 0 || over > 0 ? 'pv' : 'pv ok' }
      }),
      fitsNote: `${LONG[sd]}'s forecast for each route, start to finish.`,
      paused: s.paused,
      pauseCls: `switch${s.paused ? ' on' : ''}`,
      pauseOpts: PAUSE.map(([t], i) => ({ t, on: i === s.pauseFor, cls: i === s.pauseFor ? 'on' : '', go: () => this.setState({ pauseFor: i }) })),
      pauseTitle: `Ride On is paused ${PAUSE[s.pauseFor][1]}`.trim(),
      pauseSub: `No forecasts, scores or alerts until ${PAUSE[s.pauseFor][1] ? 'then' : 'you resume'}. Your routes stay here to browse.`,
      pop: s.pop,
      popAdd: s.pop ? R[s.pop.add].name : '',
      popRows: !s.pop ? [] : this.byScore(s.shortlist).map((k) => {
        const on = k === s.pop.out
        const v = sc[k]
        return { name: R[k].name, on, cls: on ? 'pop-r on' : 'pop-r', rcls: on ? 'radio on' : 'radio', scored: v != null, nofit: v == null, s: v, c: rc(k), go: () => this.setState({ pop: { ...s.pop, out: k } }) }
      }),
      toast: s.toast,
      stepText: n > 9 ? 'All 9 steps done' : `Step ${n} of 9`,
      stepLabel: STEPS[n - 1] || "That's the happy path. Restart to run it again, or switch to Mobile.",
      dots: STEPS.map((_, i) => (i + 1 === n ? 'cur' : s.done[i + 1] || (i === 0 && n > 1) || (i === 1 && isPhone) ? 'done' : '')),
      canDo: n <= 9,
      deskCls: isPhone ? '' : 'on',
      phoneCls: isPhone ? 'on' : '',
      toDesk: () => this.setState({ mode: 'desk', detent: 'medium', glance: [] }),
      toPhone: () => this.setState({ mode: 'phone', detent: 'medium', glance: [] }),
      toggleTheme: () => this.setState({ theme: s.theme === 'dark' ? 'light' : 'dark' }),
      toggleWind: () => {
        this.setState({ wind: !s.wind })
        if (!s.wind) this.mark(5)
      },
      cancelPop: () => this.setState({ pop: null }),
      ...Object.fromEntries(['goHome', 'openPrefs', 'openIdeal', 'backToPrefs', 'swap', 'remove', 'undo', 'togglePause', 'resume', 'rangeDown', 'rangeMove', 'rangeUp', 'onProf', 'offProf', 'onScroll', 'grabDown', 'grabUp', 'restart', 'doIt'].map((f) => [f, this[f]])),
    }
  }
}
