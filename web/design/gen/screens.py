import math, pathlib
here = pathlib.Path(__file__).resolve().parent.parent / 'up'

PANEL = """<div class="panel-h"><div class="search"><i class="icon-search"></i>Search routes</div><button class="icon-btn" aria-label="Preferences"><i class="icon-settings"></i></button></div>
<div class="panel-s">
  <div class="card">
    <span class="pill"><i class="icon-sparkles"></i>Best pick · Sat</span>
    <div class="hero">
      <div class="f1 minw0"><h2>Ripley café loop</h2><div class="dep">10:00 → ~12:30</div><div class="facts">↔ 49.6 km · 267 m climb</div></div>
      <div class="hero-score"><b>84</b><span class="bar band-great"></span><span>Great</span></div>
    </div>
    <div class="chips"><span class="chip"><i class="icon-thermometer"></i>10–13°</span><span class="chip"><i class="icon-wind"></i>SW 18 km/h</span><span class="chip"><i class="icon-cloud-sun"></i>Sunny spells</span><span class="chip"><i class="icon-droplet-off"></i>Dry</span></div>
    <div class="verdict"><i class="icon-circle-check"></i>Meets your preferences</div>
  </div>
  <div>
    <div class="section-h"><h3>Shortlist</h3><span>12 of 12</span></div>
    <div class="list"><sc-for list="{{ shortlist }}" as="r"><div class="row {{ r.cls }}">
      <div class="score"><b>{{ r.s }}</b><span class="bar band-{{ r.band }}"></span></div>
      <div class="f1 minw0">
        <div class="nl"><span class="name">{{ r.name }}</span><span class="delta">{{ r.delta }}</span></div>
        <div class="sub">{{ r.word }} · {{ r.dep }}</div>
        <div class="sub">{{ r.km }} · {{ r.cond }}</div>
        <sc-if value="{{ r.below }}"><div class="sub warn"><i class="icon-triangle-alert"></i>{{ r.below }}</div></sc-if>
      </div>
    </div></sc-for></div>
  </div>
  <div>
    <div class="section-h"><h3>Doesn't Fit Your Window</h3></div>
    <div class="list"><div class="row"><div class="thumb"><i class="icon-clock"></i></div><div class="f1 minw0"><div class="name">Leith Hill &amp; the Surrey Hills</div><div class="sub">84.8 km · 1072 m climb</div><div class="sub">Needs about 5 h 10 min. Your window is 09:00–14:00.</div></div></div></div>
  </div>
  <div>
    <div class="section-h"><h3>Library</h3><span>3 routes</span></div>
    <div class="list"><sc-for list="{{ library }}" as="r"><div class="row {{ r.cls }}">
      <div class="thumb"><i class="icon-route"></i></div>
      <div class="f1 minw0"><div class="name">{{ r.name }}</div><div class="sub">{{ r.facts }}</div><div class="sub">{{ r.src }}</div></div>
      <sc-if value="{{ r.hover }}"><span class="add"><i class="icon-plus"></i>Add</span></sc-if>
    </div></sc-for></div>
  </div>
  <div class="footer">Updated 08:12 · forecast retrieved 08:10<br />Contains Met Office data licensed under the Open Government Licence v3.0.</div>
</div>"""

DAYS = """<div class="daystrip glass" role="group" aria-label="Day"><sc-for list="{{ days }}" as="d"><button class="day {{ d.cls }}" aria-pressed="{{ d.sel }}"><span class="day-n">{{ d.d }}</span><span class="track"><span class="dbar band-{{ d.band }}" style="height: {{ d.h }}px"></span></span><span class="day-s">{{ d.s }}<sc-if value="{{ d.rain }}"><i class="icon-umbrella" aria-label="Rain"></i></sc-if></span></button></sc-for></div>"""

CONTROLS = """<div class="controls"><div class="keychip glass"><span class="sws"><span class="sw band-great"></span><span class="sw band-good"></span><span class="sw band-fair"></span><span class="sw band-notrec"></span></span>Bands<i class="icon-chevron-down"></i></div><button class="icon-btn glass" aria-label="Appearance"><i class="icon-sun-moon"></i></button></div>"""

def opt(id, label, width, body, attrs=''):
    return f"""<div class="dv-opt" id="{id}"{attrs}><div class="dv-olabel"><a class="dv-oid" href="#{id}">{id}</a>{label}</div><div class="dv-card" style="width: {width}px">
{body}
</div></div>"""

def desk(label, panel_theme, panel=PANEL, map_attrs='data-map="home"', overlay='', days=DAYS, controls=CONTROLS, pad='72 40 140 416'):
    return f"""<div class="frame desk theme-light" data-screen-label="{label}">
<div class="map" {map_attrs} data-pad="{pad}"></div>
<aside class="panel glass {panel_theme}">
{panel}
</aside>
{controls}
{days}
{overlay}
<div class="osm">© OpenStreetMap</div>
</div>"""

def phone(label, pad, docked, panel=PANEL, map_attrs='data-map="home"', days=DAYS, controls=CONTROLS, sheet_cls=''):
    return f"""<div class="frame phone theme-light" data-screen-label="{label}">
<div class="map" {map_attrs} data-pad="{pad}"></div>
<div class="statusbar">08:14<span><i class="icon-signal"></i><i class="icon-wifi"></i><i class="icon-battery-full"></i></span></div>
{controls}
{'' if docked else days}
<section class="sheet glass {sheet_cls}"><div class="grabber"></div>
{DAYS.replace('daystrip glass', 'daystrip') if docked else ''}
{panel}
</section>
</div>"""

tall = f"""<div class="frame tall theme-light" data-screen-label="1e Panel, full length"><aside class="panel glass">
{PANEL}
</aside></div>"""

KM = 49.6
WIND_C = {'t': 'var(--band-great)', 'c': 'var(--status-crosswind)', 'h': 'var(--status-headwind)'}
STRETCHES = [('c', 0, 5), ('h', 5, 19), ('c', 19, 27), ('t', 27, KM)]

def elev(x):
    g = lambda c, h, w: h * math.exp(-((x - c) / w) ** 2)
    return 16 + g(8, 30, 2.2) + g(17, 62, 3.2) + g(31, 30, 3.6) + g(41, 22, 2) + 6 * math.sin(x * 1.3) + 4 * math.sin(x * 2.9 + 1) + 1.6 * math.sin(x * 4.7 + 2)

def ring(score, size=64):
    r = size / 2 - 4
    c = 2 * math.pi * r
    return f"""<svg class="ring" width="{size}" height="{size}" viewBox="0 0 {size} {size}" aria-hidden="true"><circle cx="{size/2}" cy="{size/2}" r="{r}" class="ring-t" /><circle cx="{size/2}" cy="{size/2}" r="{r}" class="ring-v" stroke-dasharray="{c:.1f}" stroke-dashoffset="{c * (1 - score / 100):.1f}" transform="rotate(-90 {size/2} {size/2})" /><text x="50%" y="50%" dy="0.35em">{score}</text></svg>"""

def share(segs, start, end):
    bar = ''.join(f'<span style="flex: {w}; background: {c}"></span>' for c, w in segs)
    return f'<div class="share"><div class="share-bar">{bar}</div><div class="share-ends"><span>{start}</span><span>{end}</span></div></div>'

def legend(items):
    return '<div class="legend">' + ''.join(f'<span><i style="background: {c}"></i>{n} <b>{v}</b></span>' for c, n, v in items) + '</div>'

def compass(deg_from, speed):
    c = 2 * math.pi * 44
    ticks = f'<circle cx="52" cy="52" r="44" class="tk" stroke-dasharray="1 {c / 72 - 1:.3f}" transform="rotate(-90.5 52 52)" />' + ''.join(f'<line x1="52" y1="4" x2="52" y2="12" transform="rotate({a} 52 52)" class="tk-m" />' for a in (0, 90, 180, 270))
    labels = ''.join(f'<text x="{x}" y="{y}" class="{"cn" if t == "N" else ""}">{t}</text>' for t, x, y in [('N', 52, 24), ('E', 82, 56), ('S', 52, 86), ('W', 22, 56)])
    # The arrow crosses the dial the way the wind blows (from deg_from), with a gap for the speed.
    arrow = f"""<g transform="rotate({deg_from + 180} 52 52)"><line x1="52" y1="96" x2="52" y2="75" class="ar" /><circle cx="52" cy="96" r="3.5" class="ah" /><line x1="52" y1="29" x2="52" y2="12" class="ar" /><path d="M52 7 l-6 9 h12 z" class="ah" /></g>"""
    return f'<svg class="compass" width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">{ticks}{labels}{arrow}<text x="52" y="52" class="cs">{speed}</text><text x="52" y="64" class="cu">km/h</text></svg>'

def profile(scrub=None):
    W, top, base = 320, 22, 100
    X = lambda km: km / KM * W
    Y = lambda m: base - m * (base - top) / 80
    pts = [(X(i * 0.5), Y(elev(i * 0.5))) for i in range(100)] + [(W, Y(elev(KM)))]
    line = ' '.join(f'{x:.0f},{y:.1f}' for x, y in pts)
    peak = max(pts, key=lambda p: -p[1])
    grid = ''.join(f'<line x1="0" x2="{W}" y1="{Y(m)}" y2="{Y(m)}" class="gl" /><text x="0" y="{Y(m) - 3}" class="yl">{m} m</text>' for m in (40, 80))
    strip = ''.join(f'<rect x="{X(a) + (1 if a else 0):.1f}" y="110" width="{X(b) - X(a) - (1 if a else 0):.1f}" height="8" rx="2" fill="{WIND_C[k]}" />' for k, a, b in STRETCHES)
    temps = ''.join(f'<text x="{X(km):.1f}" y="136" text-anchor="{a}" class="tl">{t}°</text>' for km, t, a in [(0, 10, 'start'), (14, 11, 'middle'), (28, 12, 'middle'), (42, 13, 'middle')])
    axis = ''.join(f'<text x="{X(km):.1f}" y="160" text-anchor="{"start" if km == 0 else "middle"}" class="xl">{km}</text>' for km in (0, 10, 20, 30, 40)) + f'<text x="{W}" y="160" text-anchor="end" class="xl">km</text>'
    cur = ''
    if scrub:
        km, label = scrub
        x, y = X(km), Y(elev(km))
        cur = f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top - 6}" y2="122" class="cur" /><circle cx="{x:.1f}" cy="{y:.1f}" r="5" class="cur-dot" /><g transform="translate({min(max(x, 84), W - 84):.1f} 0)"><rect x="-84" y="-1" width="168" height="18" rx="9" class="tag" /><text x="0" y="12" class="tag-t">{label}</text></g>'
    return f"""<svg class="profile" viewBox="0 0 {W} 168" aria-hidden="true">{grid}<polygon points="0,{base} {line} {W},{base}" class="area" /><polyline points="{line}" class="eline" /><text x="{peak[0] - 7:.1f}" y="{peak[1] + 3:.1f}" text-anchor="end" class="pk">{round(elev(17.2))} m</text>{strip}{temps}{axis}{cur}</svg>"""

def factor(name, score, sentence):
    b = 'great' if score >= 75 else 'good' if score >= 60 else 'fair' if score >= 50 else 'notrec'
    return f'<div class="frow"><div class="nl"><span class="fname">{name}</span><b>{score}</b></div><div class="ftrack"><span class="band-{b}" style="width: {score}%"></span></div><div class="sub">{sentence}</div></div>'

def detail(part='all', wind=False, scrub=None):
    """part: 'top' (what fits before the fold), 'wind' (the panel scrolled to the Wind section) or 'all'."""
    hours = [('10:00', 'sun', 10, 16, 26, 0), ('11:00', 'cloud-sun', 12, 18, 29, 0), ('12:00', 'cloud-sun', 13, 19, 30, 5)]
    grid = '<div class="fc"><span></span>' + ''.join(f'<b>{h[0]}</b>' for h in hours)
    grid += '<span></span>' + ''.join(f'<i class="icon-{h[1]}"></i>' for h in hours)
    for label, i, unit in [('Temperature', 2, '°'), ('Wind, km/h', 3, ''), ('Gusts, km/h', 4, ''), ('Rain', 5, '%')]:
        grid += f'<span class="fl">{label}</span>' + ''.join(f'<span>{"SW " if i == 3 else ""}{h[i]}{unit}</span>' for h in hours)
    grid += '</div>'
    deps = [('Sat 24', '10:00', 84, True), ('Sat 24', '09:30', 81, False), ('Sat 24', '11:00', 80, False), ('Sun 25', '10:00', 72, False)]
    tiles = ''.join(f'<button class="dtile{" sel" if sel else ""}" aria-pressed="{str(sel).lower()}"><span class="sub">{d}</span><b>{t}</b><span class="dscore">{sc}<span class="bar band-{"great" if sc >= 75 else "good"}"></span></span></button>' for d, t, sc, sel in deps)
    yellow, gray = '#ffcc00', '#8e8e93'
    wind_segs = [(WIND_C[k], b - a) for k, a, b in STRETCHES]
    secs = f"""  <div class="dt">
    <span class="pill"><i class="icon-sparkles"></i>Best pick · Sat 24 Oct</span>
    <h1>Ripley café loop</h1>
    <div class="dep">10:00 → ~12:30</div>
    <div class="facts">↔ 49.6 km · 267 m climb · 4% unpaved</div>
  </div>
  <div class="card">
    <div class="vc">{ring(84)}<div class="minw0"><div class="vc-band">Great</div><div class="verdict"><i class="icon-circle-check"></i>Meets your preferences</div><div class="sub">▲ 3 since 07:00 · last ridden 12 Oct</div></div></div>
    <div class="notes"><div><i class="icon-thermometer"></i>Starts at 10°, a degree under your ideal range.</div><div><i class="icon-wind"></i>Headwind for 14 km on the way out to Ripley.</div></div>
  </div>
<!--cut-->  <div>
    <div class="section-h"><h3>Departure</h3></div>
    <div class="dtiles">{tiles}</div>
    <div class="sub note-u">The best start in your 09:00–14:00 window, then the next three.</div>
  </div>
  <div>
    <div class="section-h"><h3>Forecast on the Ride</h3></div>
    <div class="card">{grid}</div>
  </div>
  <div>
    <div class="section-h"><h3>Sky on the Ride</h3></div>
    <div class="card"><div class="sk"><i class="icon-cloud-sun"></i>Sunny spells, cloudier towards the finish</div>{share([(yellow, 45), (f'color-mix(in srgb, {yellow} 50%, transparent)', 40), (gray, 15)], '10:00', '~12:30')}{legend([(yellow, 'Sunny', '~45%'), (f'color-mix(in srgb, {yellow} 50%, transparent)', 'Sunny intervals', '~40%'), (gray, 'Cloudy', '~15%')])}</div>
  </div>
<!--cut-->  <div>
    <div class="section-h"><h3>Wind on the Ride</h3></div>
    <div class="card">
      <div class="wn">{compass(225, 18)}<div class="minw0"><div class="wn-h">Wind from the south-west</div><div class="sub">18 km/h on average</div><div class="sub">Gusts up to 30 km/h around 12:00</div></div></div>
      {share(wind_segs, '10:00', '~12:30')}
      {legend([(WIND_C['t'], 'Tailwind', '~46%'), (WIND_C['h'], 'Headwind', '~28%'), (WIND_C['c'], 'Crosswind', '~26%')])}
      <div class="tg"><span>Show wind on the map</span><span class="switch{' on' if wind else ''}" role="switch" aria-checked="{str(wind).lower()}"><i></i></span></div>
    </div>
  </div>
  <div>
    <div class="section-h"><h3>Along the Route</h3></div>
    <div class="card">{profile(scrub)}{legend([('var(--label-secondary)', 'Elevation', ''), (WIND_C['t'], 'Tailwind', ''), (WIND_C['c'], 'Crosswind', ''), (WIND_C['h'], 'Headwind', '')])}</div>
  </div>
  <div>
    <div class="section-h"><h3>Why It Scored 84</h3></div>
    <div class="list">{''.join(factor(*f) for f in [
        ('Rain', 100, 'Dry for the whole ride.'),
        ('Time budget', 95, 'Back by ~12:30, well inside your 09:00–14:00 window.'),
        ('Surface', 88, 'Almost all tarmac, with 2 km of firm towpath.'),
        ('Sky', 82, 'Sunny spells for most of the ride.'),
        ('Temperature', 80, 'Starts at 10°, a degree under your ideal, and reaches 13°.'),
        ('Wind', 78, 'South-westerly 18 km/h, with the tailwind for the last 22 km.'),
        ('Intent', 74, 'A steady endurance loop, as you asked for on Saturdays.'),
        ('Novelty', 70, 'You rode it 12 days ago.'),
    ])}</div>
  </div>
  <div class="list acts">
    <button class="act"><i class="icon-calendar-plus"></i>Add to Calendar<span class="act-t">Sat 10:00–12:30<i class="icon-chevron-down"></i></span></button>
    <button class="act"><i class="icon-external-link"></i>Open in cycle.travel</button>
    <button class="act"><i class="icon-download"></i>Download GPX</button>
    <button class="act danger"><i class="icon-circle-minus"></i>Remove from shortlist</button>
  </div>
  <div class="footer">Forecast retrieved 08:10<br />Contains Met Office data licensed under the Open Government Licence v3.0.</div>
""".split('<!--cut-->')
    body = {'top': secs[0] + secs[1], 'wind': secs[2], 'all': ''.join(secs)}[part]
    return f"""<div class="panel-h{' scrolled' if part == 'wind' else ''}"><button class="icon-btn" aria-label="Back to routes"><i class="icon-chevron-left"></i></button><div class="ph-title">Ripley café loop</div><span class="ph-sp"></span></div>
<div class="panel-s">
{body}</div>"""

DETAIL_MAP = 'data-map="detail" data-selected="6b8b1863"'
SCRUB_KM = 31
detail_tall = f"""<div class="frame tall theme-light" data-screen-label="2e Detail, full length"><aside class="panel glass">
{detail()}
</aside></div>"""

# The hover glance card (SPEC §6.7), placed by cyclemap.js from data-hover.
GLANCE = """<div class="cursor" aria-hidden="true"><svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19.2 L8.6 12 L15 12 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" /></svg></div>
<div class="glance glass" role="tooltip">
  <div class="name">Thames to Walton</div>
  <div class="g-score"><b>76</b><span class="bar band-great"></span>Great</div>
  <div class="sub">Sat · 11:00 → ~12:10 · 24.0 km</div>
  <div class="chips"><span class="chip"><i class="icon-thermometer"></i>12–13°</span><span class="chip"><i class="icon-wind"></i>SW 18 km/h</span><span class="chip"><i class="icon-droplet-off"></i>Dry</span></div>
  <div class="verdict"><i class="icon-circle-check"></i>Meets your preferences</div>
</div>"""

# Round 3: Preferences, the swap popover, paused and empty (SPEC §7.4–7.6).
# ConditionPalette.color(forTemperatureC:) as a continuous ramp, -5° to 35°.
RAMP = [(-5, (13, 38, 140)), (4, (102, 178, 255)), (14, (52, 199, 89)), (21, (255, 204, 0)), (27, (255, 149, 0)), (33, (255, 59, 48))]

def ramp(t):
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        if t <= t1:
            k = max(0, (t - t0) / (t1 - t0))
            return '#' + ''.join(f'{round(a + k * (b - a)):02x}' for a, b in zip(c0, c1))
    return '#%02x%02x%02x' % RAMP[-1][1]

tpos = lambda t: (t + 5) / 40 * 100
RAMP_CSS = 'linear-gradient(90deg, ' + ', '.join(f'rgb{c} {tpos(t):.1f}%' for t, c in RAMP) + ')'
C = dict(orange='#ff9500', cyan='#32ade6', yellow='#ffcc00', blue='#007aff', green='#34c759', purple='#af52de', teal='#30b0c7', indigo='#5856d6', red='#ff3b30', slate='#667894', gray='#8e8e93', black='#1c1c1e')

def prow(label, right='', icon=None, color='gray', sub='', cls=''):
    ic = f'<span class="ico" style="background: {C.get(color, color)}"><i class="icon-{icon}"></i></span>' if icon else ''
    sb = f'<span class="sub">{sub}</span>' if sub else ''
    return f'<div class="prow {cls}">{ic}<div class="f1"><span class="pl">{label}</span>{sb}</div>{right}</div>'

chev = lambda v: f'<span class="pv">{v}</span><i class="icon-chevron-right chev"></i>'
menu = lambda v: f'<span class="menu">{v}<i class="icon-chevrons-up-down"></i></span>'
step = lambda v: f'<span class="pv">{v}</span><span class="stepper"><span><i class="icon-minus"></i></span><span><i class="icon-plus"></i></span></span>'
pv = lambda v: f'<span class="pv">{v}</span>'
tpill = lambda v: f'<span class="tpill">{v}</span>'
seg = lambda opts, on, cls='': f'<div class="seg {cls}" role="radiogroup">' + ''.join(f'<span class="{"on" if i == on else ""}" role="radio" aria-checked="{str(i == on).lower()}">{o}</span>' for i, o in enumerate(opts)) + '</div>'
switch = lambda on: f'<span class="switch{" on" if on else ""}" role="switch" aria-checked="{str(on).lower()}"><i></i></span>'
EXT = '<i class="icon-arrow-up-right chev"></i>'
scale = lambda ticks: '<div class="rscale">' + ''.join(f'<span style="--p: {p:.1f}">{t}</span>' for p, t in ticks) + '</div>'

def sec(title, rows, foot='', cls=''):
    h = f'<div class="section-h"><h3>{title}</h3></div>' if title else ''
    f = f'<div class="sub note-u">{foot}</div>' if foot else ''
    return f'<div>{h}<div class="list {cls}">{rows}</div>{f}</div>'

def rng(a, b, temp=False):
    track = f'<span class="rt" style="background: {RAMP_CSS}"></span><span class="rd rd1"></span><span class="rd rd2"></span>' if temp else '<span class="rt"></span><span class="rf"></span>'
    return f'<div class="range{" ramp" if temp else ""}" style="--a: {a:.1f}; --b: {b:.1f}">{track}<span class="th ta"></span><span class="th tb"></span></div>'

def fit_row(name, lo, hi, ideal=(12, 18)):
    p = lambda t: (t - 6) / 14 * 100  # the bars run 6–20°
    v = '<span class="pv ok">In range</span>' if lo >= ideal[0] else f'<span class="pv">{ideal[0] - lo}° under</span>'
    return f'<div class="tfit"><span class="name">{name}</span><span class="tbar"><span class="tideal" style="left: {p(ideal[0]):.1f}%; right: {100 - p(ideal[1]):.1f}%"></span><span class="tspan" style="left: {p(lo):.1f}%; right: {100 - p(hi):.1f}%; background: linear-gradient(90deg, {ramp(lo)}, {ramp(hi)})"></span></span>{v}</div>'

back = lambda to, title: f'<div class="panel-h"><button class="icon-btn" aria-label="Back to {to}"><i class="icon-chevron-left"></i></button><div class="ph-title">{title}</div><span class="ph-sp"></span></div>'
HEAD = PANEL.split('\n')[0]
MORE = '<button class="icon-btn sm" aria-label="Passkey options"><i class="icon-ellipsis"></i></button>'

PREFS = back('routes', 'Preferences') + f"""
<div class="panel-s">
  <div class="dt"><h1>Preferences</h1><div class="sub">Changes re-rank your rides straight away.</div></div>
  {sec('What Makes a Good Ride', ''.join([
      prow('Ideal Temperature', chev('11–18°'), 'thermometer', 'orange'),
      prow('Comfortable Wind', chev('20 km/h'), 'wind', 'cyan'),
      prow('Sunshine', menu('Nice to Have'), 'sun', 'yellow'),
      prow('Rain', menu('Prefer Dry'), 'cloud-rain', 'blue'),
      prow('Climbing', menu('No Preference'), 'mountain', 'green'),
      prow('Recently Ridden', menu('Prefer Variety'), 'repeat', 'purple'),
  ]), 'Prefer Variety scores a route lower if you rode it in the last 14 days.')}
  {sec('Distance', prow('Distance', pv('20–60 km'), 'route', 'teal') + f'<div class="pblock">{seg(["No limit", "Choose a range"], 1)}{rng(20, 60)}{scale([(0, "0"), (50, "50"), (100, "100")])}</div>',
      "Routes outside the range stay in your library, but aren't recommended.")}
  {sec('When', f'<div class="pblock">{seg(["Daylight hours", "Choose times"], 1)}</div>' + prow('Leave After', tpill('09:00'), 'clock-9', 'orange') + prow('Back By', tpill('14:00'), 'clock-2', 'indigo'),
      'Ride On finds the best start inside this window, every day.')}
  {sec('Deal-Breakers', ''.join([
      prow('Never Colder Than', chev('4°'), 'thermometer-snowflake', 'blue'),
      prow('Never Hotter Than', chev('28°'), 'thermometer-sun', 'red'),
      prow('Gust Limit', chev('35 km/h'), 'wind', 'slate'),
      prow('Chance of Rain', menu('60%'), 'umbrella', 'teal'),
  ]), 'A ride past any of these is marked Below your minimums, whatever it scores.')}
  {sec('Riding', prow('Average Speed', step('22 km/h'), 'gauge', 'green') + prow('Try Departures Every', menu('30 min'), 'timer', 'gray'),
      'Sets how long each route takes you, so departures fit your window.')}
  {sec('Units', prow('Temperature', seg(['°C', '°F'], 0, 'sm')) + prow('Speed', seg(['km/h', 'mph'], 0, 'sm')) + prow('Distance', seg(['km', 'mi'], 0, 'sm')), cls='plain')}
  {sec('', prow('Pause Ride On', switch(False), 'circle-pause', 'gray', 'Hide forecasts, scores and alerts. Your routes stay listed.'))}
  {sec('Account', prow('Email', pv('rider@example.com'), 'user-round', 'black') + prow('Sign-In Methods', chev('2'), 'shield-check', 'green'))}
  {sec('Passkeys', ''.join([
      prow('MacBook Pro', MORE, 'key-round', 'gray', 'iCloud Keychain · added 2 Oct'),
      prow('Pixel 9', MORE, 'key-round', 'gray', 'Google Password Manager · added 14 Oct'),
      prow('Add a Passkey', '', 'plus', 'var(--accent)', cls='acc'),
  ]), 'Sign in with Face ID, Touch ID or your phone. No password to remember.')}
  {sec('', prow('Sign Out', cls='danger'), "You'll stay signed in on your other devices.", 'plain')}
  {sec('About', ''.join([
      prow('OpenStreetMap', EXT, sub='Map data © OpenStreetMap contributors'),
      prow('Protomaps', EXT, sub='Basemap'),
      prow('Mapterhorn', EXT, sub='Terrain and hillshading'),
      prow('Ordnance Survey', EXT, sub='Contains OS data © Crown copyright and database right 2026'),
      prow('Met Office', EXT, sub='Weather. Contains Met Office data licensed under the Open Government Licence v3.0.'),
      prow('Version', pv('1.0 (Dec 2026)')),
  ]), cls='plain')}
</div>"""

FITS = [('Ripley', 10, 13), ('Windsor', 9, 13), ('Thames', 12, 13), ('Box Hill', 9, 12), ('Richmond', 13, 14), ('Esher', 12, 13), ('Runnymede', 10, 13)]
IDEAL = back('Preferences', 'Ideal Temperature') + f"""
<div class="panel-s">
  <div class="dt"><h1>Ideal Temperature</h1></div>
  <div class="card">
    <div class="tr-read"><b>12–18°</b><span class="sub">The range you'd happily ride in</span></div>
    {rng(tpos(12), tpos(18), True)}
    {scale([(tpos(t), f'{t}°') for t in (0, 10, 20, 30)])}
    <div class="sub">A ride that starts or ends outside it scores lower. Never Colder Than and Never Hotter Than are the hard limits.</div>
  </div>
  <div>
    <div class="section-h"><h3>How Your Routes Fit</h3></div>
    <div class="card">{''.join(fit_row(*f) for f in FITS)}</div>
    <div class="sub note-u">Saturday's forecast for each route, start to finish.</div>
  </div>
  {sec('Deal-Breakers', prow('Never Colder Than', step('4°')) + prow('Never Hotter Than', step('28°')), 'Rides outside these are marked Below your minimums.')}
</div>"""
COOL = 'data-map="home" data-scores="6b8b1863:77,4e5ad57f:70,1eaf3c4f:63,e8d1896c:55,bcb8871c:41"'
DAYS_COOL = DAYS.replace('{{ days }}', '{{ daysCool }}')
CONTROLS_PLAIN = '<div class="controls"><button class="icon-btn glass" aria-label="Appearance"><i class="icon-sun-moon"></i></button></div>'

SWAP = [('Ripley café loop', 84), ('Windsor Great Park', 79), ('Thames to Walton', 76), ('Box Hill via Leatherhead', 71), ('Richmond Park laps', 68), ('Esher & Claygate lanes', 66), ('Hampton Court & Bushy Park', 63), ('Runnymede & Staines', 61), ('Wimbledon Common', 57), ('Ham & Petersham riverside', 52), ('Epsom Downs & Headley', 44), ('Leith Hill & the Surrey Hills', None)]
band = lambda s: 'great' if s >= 75 else 'good' if s >= 60 else 'fair' if s >= 50 else 'notrec'
POP = '<div class="pop glass" role="dialog" aria-label="Your shortlist is full" style="left: 404px; top: 150px"><div class="pop-h"><h3>Your shortlist is full</h3><div class="sub">Choose one to swap out for Barnes &amp; Putney Bridge. A shortlist holds 12.</div></div><div role="radiogroup">' + ''.join(
    f'<div class="pop-r{" on" if n.startswith("Epsom") else ""}" role="radio" aria-checked="{str(n.startswith("Epsom")).lower()}"><span class="radio{" on" if n.startswith("Epsom") else ""}">{"<i class=icon-check></i>" if n.startswith("Epsom") else ""}</span><span class="name">{n.replace("&", "&amp;")}</span>'
    + (f'<b>{s}</b><span class="bar band-{band(s)}"></span>' if s else '<span class="sub">Doesn\'t fit</span>') + '</div>' for n, s in SWAP
) + '</div><div class="pop-a"><button class="btn">Cancel</button><button class="btn tint">Swap</button></div></div>'
PANEL_END = PANEL.replace('<div class="panel-h">', '<div class="panel-h scrolled">', 1).replace('<div class="panel-s">', '<div class="panel-s end">', 1)

ALPHA = [('Box Hill via Leatherhead', 55.7), ('Epsom Downs &amp; Headley', 45.2), ('Esher &amp; Claygate lanes', 29.0), ('Ham &amp; Petersham riverside', 10.7), ('Hampton Court &amp; Bushy Park', 10.0), ('Leith Hill &amp; the Surrey Hills', 84.8), ('Richmond Park laps', 14.6), ('Ripley café loop', 49.6), ('Runnymede &amp; Staines', 52.1), ('Thames to Walton', 24.0), ('Wimbledon Common', 21.7), ('Windsor Great Park', 62.9)]
PAUSED = HEAD + f"""
<div class="panel-s">
  <div class="card"><div class="pc"><i class="icon-circle-pause"></i><div><div class="pc-t">Ride On is paused until Mon 3 Nov</div><div class="sub">No forecasts, scores or alerts until then. Your routes stay here to browse.</div></div></div><button class="btn tint">Resume</button></div>
  <div><div class="section-h"><h3>Shortlist</h3><span>12 routes</span></div><div class="list">{''.join(f'<div class="row"><div class="thumb"><i class="icon-route"></i></div><div class="f1 minw0"><div class="name">{n}</div><div class="sub">{km} km</div></div></div>' for n, km in ALPHA)}</div></div>
  <div><div class="section-h"><h3>Library</h3><span>3 routes</span></div><div class="list"><sc-for list="{{{{ libraryPlain }}}}" as="r"><div class="row"><div class="thumb"><i class="icon-route"></i></div><div class="f1 minw0"><div class="name">{{{{ r.name }}}}</div><div class="sub">{{{{ r.facts }}}}</div></div></div></sc-for></div></div>
</div>"""

def empty(acts):
    return f"""<div class="panel-h"><span class="ph-name">Ride On</span><button class="icon-btn" aria-label="Preferences"><i class="icon-settings"></i></button></div>
<div class="panel-s"><div class="card empty"><div class="e-icon"><i class="icon-route"></i></div><h2>Import routes from cycle.travel</h2><p>Install the extension, open a journey on cycle.travel and save it.</p><div class="e-acts">{acts}</div><div class="sub">Saved routes show up here and on the map straight away.</div></div></div>"""

prefs_tall = f"""<div class="frame tall theme-light" data-screen-label="3c Preferences, full length"><aside class="panel glass">
{PREFS}
</aside></div>"""

T3 = f"""<section class="dv-turn" id="t3">
<div class="dv-thd"><a class="dv-tid" href="#t3">3</a><span class="dv-tname">Preferences, the full shortlist, paused and empty</span></div>
<div class="dv-opts">
{opt('3a', 'Preferences: ⚙ pushes them into the panel, over the live map', 1440, desk('3a Preferences, desktop', '', PREFS))}
{opt('3b', 'Ideal Temperature: the low handle dragged from 11° to 12°. The map recolours as you drag: Windsor drops to Good, Runnymede to Fair, Saturday to 77', 1440, desk('3b Ideal Temperature, desktop', '', IDEAL, COOL, days=DAYS_COOL))}
{opt('3c', 'Preferences, full length', 404, prefs_tall)}
{opt('3d', 'Adding a 13th route: pick one to swap out. The lowest scorer is chosen for you', 1440, desk('3d Swap popover, desktop', '', PANEL_END, overlay=POP))}
{opt('3e', 'Paused: a quiet map, every line grey; no scores, day strip or bands', 1440, desk('3e Paused, desktop', '', PAUSED, 'data-map="paused"', days='', controls=CONTROLS_PLAIN))}
{opt('3f', 'Empty: no routes yet, the map pulled back to Great Britain', 1440, desk('3f Empty, desktop', 'fit', empty('<button class="btn tint">Add to Chrome</button><button class="btn">Add to Safari</button>'), 'data-map="empty"', days='', controls=CONTROLS_PLAIN, pad='40 40 40 416'))}
{opt('3g', 'Empty, mobile: Safari only, since Chrome on iPhone has no extensions', 393, phone('3g Empty, mobile', '112 28 380 28', False, empty('<button class="btn tint">Add to Safari</button>'), 'data-map="empty"', days='', controls=CONTROLS_PLAIN, sheet_cls='fit'))}
</div>
<p class="dv-next">Next up: the interactive prototype on live MapLibre (the 9-step happy path, desktop and mobile, light/dark toggle), then the state board and the dark map exploration. The swap popover on mobile, as a sheet, goes on the state board.</p>
</section>"""

SCRIPT = r"""class Component extends DCLogic {
  componentDidMount() {
    const go = () => (window.RideOnMap ? window.RideOnMap.mountAll() : setTimeout(go, 50)); go();
    // Refraction everywhere but the data-frost frames, which show what Safari and Firefox get.
    const lens = () => (window.RideOnGlass ? document.querySelectorAll('.dv-opt:not([data-frost])').forEach((o) => window.RideOnGlass.refractAll(o)) : setTimeout(lens, 50));
    document.fonts.ready.then(lens);
  }
  renderVals() {
    const band = (s) => (s >= 75 ? 'great' : s >= 60 ? 'good' : s >= 50 ? 'fair' : 'notrec');
    const word = { great: 'Great', good: 'Good', fair: 'Fair', notrec: 'Not recommended' };
    const row = (s, name, dep, km, cond, delta = '', below = '') => ({ s, band: band(s), word: word[band(s)], name, dep, km, cond, delta, below, cls: '' });
    const day = (d, s, sel) => ({ d, s: s ?? '', band: s ? band(s) : 'none', h: s ? Math.round(s * 0.26) : 3, sel: !!sel, rain: !s, cls: sel ? 'sel' : s ? '' : 'off' });
    const shortlist = [
        row(79, 'Windsor Great Park', '09:30 → ~12:25', '62.9 km', '9–13° · SW 18 km/h · dry', '▲ 1'),
        row(76, 'Thames to Walton', '11:00 → ~12:10', '24.0 km', '12–13° · SW 18 km/h · dry'),
        row(71, 'Box Hill via Leatherhead', '09:30 → ~12:20', '55.7 km', '9–12° · gusts 32 km/h · dry', '▼ 2'),
        row(68, 'Richmond Park laps', '12:00 → ~12:45', '14.6 km', '13–14° · SW 20 km/h · dry'),
        row(66, 'Esher & Claygate lanes', '11:30 → ~12:55', '29.0 km', '12–13° · SW 19 km/h · dry'),
        row(63, 'Hampton Court & Bushy Park', '13:00 → ~13:30', '10.0 km', '13–14° · SW 21 km/h · dry'),
        row(61, 'Runnymede & Staines', '10:00 → ~12:25', '52.1 km', '10–13° · SW 22 km/h · dry'),
        row(57, 'Wimbledon Common', '12:30 → ~13:35', '21.7 km', '13–14° · gusts 34 km/h · dry'),
        row(52, 'Ham & Petersham riverside', '13:30 → ~14:00', '10.7 km', '14° · W 24 km/h · dry'),
        row(44, 'Epsom Downs & Headley', '09:00 → ~11:30', '45.2 km', '9–12° · SW 22 km/h · dry', '', 'Below your minimums: gusts 38 km/h'),
    ];
    return {
      shortlist,
      // 2a: Thames to Walton's line is hovered on the map, so its row lights up too.
      shortlistHover: shortlist.map((r) => (r.name === 'Thames to Walton' ? { ...r, cls: 'hover' } : r)),
      libraryPlain: [
        { name: 'Barnes & Putney Bridge', facts: '21.5 km · 103 m · 27% unpaved', src: 'cycle.travel', cls: '', hover: false },
        { name: "Chertsey & St Ann's Hill", facts: '47.5 km · 79 m · 8% unpaved', src: 'cycle.travel', cls: '', hover: false },
        { name: 'Ranmore Common', facts: '55.8 km · 517 m · 7% unpaved', src: 'cycle.travel', cls: '', hover: false },
      ],
      library: [
        { name: 'Barnes & Putney Bridge', facts: '21.5 km · 103 m · 27% unpaved', src: 'cycle.travel', cls: 'hover', hover: true },
        { name: "Chertsey & St Ann's Hill", facts: '47.5 km · 79 m · 8% unpaved', src: 'cycle.travel', cls: '', hover: false },
        { name: 'Ranmore Common', facts: '55.8 km · 517 m · 7% unpaved', src: 'cycle.travel', cls: '', hover: false },
      ],
      // 3b: a warmer ideal range re-ranks Saturday, so its best drops from 84 to 77.
      daysCool: [day('Sat', 77, true), day('Sun', 72), day('Mon', 58), day('Tue'), day('Wed', 47), day('Thu', 66), day('Fri', 74)],
      days: [day('Sat', 84, true), day('Sun', 72), day('Mon', 58), day('Tue'), day('Wed', 47), day('Thu', 66), day('Fri', 74)],
    };
  }
}"""

html = f"""<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><script src="./support.js"></script></head><body><x-dc><helmet data-dc-atomics><meta name="design_doc_mode" content="canvas" /><title>Ride On Web: screens</title><link rel="stylesheet" href="https://unpkg.com/lucide-static@0.469.0/font/lucide.css" /><link rel="stylesheet" href="./ride-on.css" /><script src="./map/routes.js"></script><script src="./map/cyclemap.js"></script><script src="./glass.js"></script><style>body {{ margin: 0; background: #f0eee9; }}</style></helmet>
<section class="dv-turn" id="t1">
<div class="dv-thd"><a class="dv-tid" href="#t1">1</a><span class="dv-tname">Home: best pick, shortlist and library on the cycle map (Sat 24 Oct)</span></div>
<div class="dv-opts">
{opt('1a', 'Desktop, light, with Liquid Glass refraction (Chrome and Edge)', 1440, desk('1a Home, desktop light', ''))}
{opt('1b', 'Desktop, Dark Mode panel (map, controls and day strip held light)', 1440, desk('1b Home, desktop dark panel', 'theme-dark'))}
{opt('1c', 'Mobile, sheet at the medium detent (day strip above the sheet, per spec)', 393, phone('1c Home, mobile', '112 28 596 28', False))}
{opt('1d', 'Mobile alternative: day strip docked in the sheet, more map', 393, phone('1d Home, mobile, docked day strip', '112 28 510 28', True))}
{opt('1e', 'Panel, full length (what scrolls under the fade)', 404, tall)}
{opt('1f', 'Frosted fallback: Safari (so every iPhone browser) and Firefox. Same layout, frost instead of refraction', 1440, desk('1f Home, desktop light, frosted', ''), ' data-frost')}
</div>
</section>
<section class="dv-turn" id="t2">
<div class="dv-thd"><a class="dv-tid" href="#t2">2</a><span class="dv-tname">Route detail: hover, select, scroll (Ripley café loop, Sat 24 Oct)</span></div>
<div class="dv-opts">
{opt('2a', 'Hover: the glance card 16px from the cursor; the line thickens and its row lights up', 1440, desk('2a Home, desktop, glance card', '', PANEL.replace('{{ shortlist }}', '{{ shortlistHover }}').replace('{{ library }}', '{{ libraryPlain }}'), 'data-map="home" data-hover="c93c3293@0.42"', GLANCE))}
{opt('2b', 'Selected: the detail pushes into the panel; other lines step back, the route gets its start marker', 1440, desk('2b Detail, desktop', '', detail('top'), DETAIL_MAP))}
{opt('2c', 'Scrolled to wind: "Show wind on the map" on, and scrubbing the profile at 31 km moves the dot on the map', 1440, desk('2c Detail, desktop, wind view and scrub', '', detail('wind', True, (SCRUB_KM, f'{SCRUB_KM} km · {round(elev(SCRUB_KM))} m · 12° · Tailwind')), f'{DETAIL_MAP} data-wind="c:0-5,h:5-19,c:19-27,t:27-49.6" data-scrub="{SCRUB_KM}"'))}
{opt('2d', 'Mobile: the detail in the sheet at the medium detent, day strip above it', 393, phone('2d Detail, mobile', '112 28 596 28', False, detail('top'), DETAIL_MAP))}
{opt('2e', 'Detail, full length: every section, in iOS order', 404, detail_tall)}
</div>
</section>
{T3}
</x-dc><script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":900}}}}'>{SCRIPT}</script></body></html>
"""
(here / 'Screens.dc.html').write_text(html)
print(len(html.splitlines()), 'lines', len(html), 'bytes')
