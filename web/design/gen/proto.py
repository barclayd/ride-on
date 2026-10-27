# The interactive prototype (SPEC §13): screens.py's markup, made live. Reuses everything screens.py
# defines before its logic, then writes up/Prototype.dc.html with gen/proto-logic.js as the logic.
import pathlib
gen = pathlib.Path(__file__).resolve().parent
src = (gen / 'screens.py').read_text()
ns = {'__file__': str(gen / 'screens.py')}
exec(src[:src.index('SCRIPT = r"""')], ns)
g = type('NS', (), ns)

def swap(s, old, new):
    assert s.count(old) == 1, old
    return s.replace(old, new)

def head(back_to, label, title, go):
    return f'<div class="{{{{ phCls }}}}"><button class="icon-btn" aria-label="Back to {back_to}" onclick="{{{{ {go} }}}}"><i class="icon-chevron-left"></i></button><div class="ph-title">{title}</div><span class="ph-sp"></span></div>'

SCROLL = '<div class="{{ psCls }}" onscroll="{{ onScroll }}">'
HOVER = 'onclick="{{ X.go }}" onmouseenter="{{ X.enter }}" onmouseleave="{{ X.leave }}"'
hover = lambda x: HOVER.replace('X', x)
FOOT = '<div class="footer">Updated 08:12 · forecast retrieved 08:10<br />Contains Met Office data licensed under the Open Government Licence v3.0.</div>'
SEARCH = '<div class="{{ phCls }}"><label class="search"><i class="icon-search"></i><input type="search" placeholder="Search routes" aria-label="Search routes" value="{{ q }}" onchange="{{ onQ }}" /></label><button class="icon-btn" aria-label="Preferences" onclick="{{ openPrefs }}"><i class="icon-settings"></i></button></div>'
chip = lambda icon, text: f'<span class="chip"><i class="icon-{icon}"></i>{text}</span>'

HOME = SEARCH + SCROLL + f"""
  <sc-if value="{{{{ best }}}}"><div class="{{{{ best.cls }}}}" {hover('best')}>
    <span class="pill"><i class="icon-sparkles"></i>Best pick · {{{{ dayName }}}}</span>
    <div class="hero">
      <div class="f1 minw0"><h2>{{{{ best.name }}}}</h2><div class="dep">{{{{ best.dep }}}}</div><div class="facts">{{{{ best.facts }}}}</div></div>
      <div class="hero-score"><b>{{{{ best.s }}}}</b><span class="bar rline" style="background: {{{{ best.c }}}}"></span><span>{{{{ best.word }}}}</span></div>
    </div>
    <div class="chips">{chip('thermometer', '{{ best.temp }}')}{chip('wind', '{{ best.wind }}')}{chip('cloud-sun', 'Sunny spells')}{chip('droplet-off', 'Dry')}</div>
    <div class="{{{{ best.vcls }}}}"><i class="{{{{ best.vicon }}}}"></i>{{{{ best.verdict }}}}</div>
  </div></sc-if>
  <div>
    <div class="section-h"><h3>Shortlist</h3><span>{{{{ slCount }}}}</span></div>
    <sc-if value="{{{{ hasRows }}}}"><div class="list"><sc-for list="{{{{ rows }}}}" as="r"><div class="{{{{ r.cls }}}}" {hover('r')}>
      <div class="score"><b>{{{{ r.s }}}}</b><span class="bar rline" style="background: {{{{ r.c }}}}"></span></div>
      <div class="f1 minw0">
        <div class="nl"><span class="name">{{{{ r.name }}}}</span><span class="delta">{{{{ r.delta }}}}</span></div>
        <div class="sub">{{{{ r.l1 }}}}</div>
        <div class="sub">{{{{ r.l2 }}}}</div>
        <sc-if value="{{{{ r.below }}}}"><div class="sub warn"><i class="icon-triangle-alert"></i>{{{{ r.below }}}}</div></sc-if>
      </div>
    </div></sc-for></div></sc-if>
  </div>
  <sc-if value="{{{{ leith }}}}"><div>
    <div class="section-h"><h3>Doesn't Fit Your Window</h3></div>
    <div class="list"><div class="{{{{ leith.cls }}}}" {hover('leith')}><div class="score"><i class="icon-clock"></i><span class="bar rline" style="background: {{{{ leith.c }}}}"></span></div><div class="f1 minw0"><div class="name">Leith Hill &amp; the Surrey Hills</div><div class="sub">84.8 km · 1072 m climb</div><div class="sub">Needs about 5 h 10 min. Your window is 09:00–14:00.</div></div></div></div>
  </div></sc-if>
  <sc-if value="{{{{ hasLib }}}}"><div>
    <div class="section-h"><h3>Library</h3><span>{{{{ libCount }}}}</span></div>
    <div class="list"><sc-for list="{{{{ lib }}}}" as="r"><div class="{{{{ r.cls }}}}" {hover('r')}>
      <div class="thumb"><i class="icon-route"></i></div>
      <div class="f1 minw0"><div class="name">{{{{ r.name }}}}</div><div class="sub">{{{{ r.facts }}}}</div><div class="sub">{{{{ r.src }}}}</div></div>
      <button class="add" onclick="{{{{ r.add }}}}"><i class="icon-plus"></i>Add</button>
    </div></sc-for></div>
  </div></sc-if>
  {FOOT}
</div>"""

plain_rows = lambda lst: f'<div class="list"><sc-for list="{{{{ {lst} }}}}" as="r"><div class="{{{{ r.cls }}}}" {hover("r")}><div class="thumb"><i class="icon-route"></i></div><div class="f1 minw0"><div class="name">{{{{ r.name }}}}</div><div class="sub">{{{{ r.facts }}}}</div></div></div></sc-for></div>'
PAUSED = SEARCH + SCROLL + f"""
  <div class="card"><div class="pc"><i class="icon-circle-pause"></i><div><div class="pc-t">{{{{ pauseTitle }}}}</div><div class="sub">{{{{ pauseSub }}}}</div></div></div><button class="btn tint" onclick="{{{{ resume }}}}">Resume</button></div>
  <div><div class="section-h"><h3>Shortlist</h3><span>{{{{ slPlain }}}}</span></div>{plain_rows('alpha')}</div>
  <div><div class="section-h"><h3>Library</h3><span>{{{{ libCount }}}}</span></div>{plain_rows('libPlain')}</div>
</div>"""

# The compass without its speed: that goes in .cspd, over the SVG, since text holes can't sit in SVG.
COMPASS = swap(g.compass(225, 18), '<text x="52" y="52" class="cs">18</text><text x="52" y="64" class="cu">km/h</text>', '')
YELLOW = '#ffcc00'
HALF = f'color-mix(in srgb, {YELLOW} 50%, transparent)'
WIND_SEGS = [(g.WIND_C[k], b - a) for k, a, b in g.STRETCHES]
WIND_LEGEND = g.legend([(g.WIND_C['t'], 'Tailwind', '~46%'), (g.WIND_C['h'], 'Headwind', '~28%'), (g.WIND_C['c'], 'Crosswind', '~26%')])
DETAIL = head('routes', '', '{{ d.name }}', 'goHome') + SCROLL + f"""
  <div class="dt">
    <sc-if value="{{{{ d.pill }}}}"><span class="pill"><i class="icon-sparkles"></i>{{{{ d.pill }}}}</span></sc-if>
    <h1>{{{{ d.name }}}}</h1>
    <sc-if value="{{{{ d.dep }}}}"><div class="dep">{{{{ d.dep }}}}</div></sc-if>
    <div class="facts">{{{{ d.facts }}}}</div>
  </div>
  <sc-if value="{{{{ d.unscored }}}}"><div class="card"><div class="pc"><i class="{{{{ d.uIcon }}}}"></i><div><div class="pc-t">{{{{ d.uTitle }}}}</div><div class="sub">{{{{ d.uText }}}}</div></div></div><sc-if value="{{{{ d.btn }}}}"><button class="btn tint" onclick="{{{{ d.btnGo }}}}">{{{{ d.btn }}}}</button></sc-if></div></sc-if>
  <sc-if value="{{{{ d.scored }}}}">
  <div class="card">
    <div class="vc">{{{{ d.ring }}}}<div class="minw0"><div class="vc-band">{{{{ d.word }}}}</div><div class="{{{{ d.vcls }}}}"><i class="{{{{ d.vicon }}}}"></i>{{{{ d.verdict }}}}</div><sc-if value="{{{{ d.sub }}}}"><div class="sub">{{{{ d.sub }}}}</div></sc-if></div></div>
    <div class="notes"><div><i class="icon-thermometer"></i>{{{{ d.tnote }}}}</div><div><i class="icon-wind"></i>{{{{ d.wnote }}}}</div></div>
  </div>
  <div>
    <div class="section-h"><h3>Departure</h3></div>
    <div class="dtiles"><sc-for list="{{{{ d.tiles }}}}" as="t"><button class="{{{{ t.cls }}}}" aria-pressed="{{{{ t.sel }}}}"><span class="sub">{{{{ t.d }}}}</span><b>{{{{ t.t }}}}</b><span class="dscore">{{{{ t.s }}}}</span></button></sc-for></div>
    <div class="sub note-u">The best start in your 09:00–14:00 window, then the next three.</div>
  </div>
  <div>
    <div class="section-h"><h3>Forecast on the Ride</h3></div>
    <div class="card">{{{{ d.fc }}}}</div>
  </div>
  <div>
    <div class="section-h"><h3>Sky on the Ride</h3></div>
    <div class="card"><div class="sk"><i class="icon-cloud-sun"></i>Sunny spells, cloudier towards the finish</div>{g.share([(YELLOW, 45), (HALF, 40), ('#8e8e93', 15)], '{{ d.t0 }}', '{{ d.t1 }}')}{g.legend([(YELLOW, 'Sunny', '~45%'), (HALF, 'Sunny intervals', '~40%'), ('#8e8e93', 'Cloudy', '~15%')])}</div>
  </div>
  <div class="wcard">
    <div class="section-h"><h3>Wind on the Ride</h3></div>
    <div class="card">
      <div class="wn"><div class="cwrap">{COMPASS}<div class="cspd"><b>{{{{ d.w }}}}</b><small>km/h</small></div></div><div class="minw0"><div class="wn-h">Wind from the south-west</div><div class="sub">{{{{ d.w }}}} km/h on average</div><div class="sub">{{{{ d.gust }}}}</div></div></div>
      {g.share(WIND_SEGS, '{{ d.t0 }}', '{{ d.t1 }}')}
      {WIND_LEGEND}
      <div class="tg"><span>Show wind on the map</span><span class="{{{{ d.windCls }}}}" role="switch" aria-checked="{{{{ d.wind }}}}" aria-label="Show wind on the map" onclick="{{{{ toggleWind }}}}"><i></i></span></div>
    </div>
  </div>
  </sc-if>
  <div>
    <div class="section-h"><h3>Along the Route</h3></div>
    <div class="card"><div class="prof" onpointermove="{{{{ onProf }}}}" onpointerleave="{{{{ offProf }}}}">{{{{ d.profile }}}}</div><sc-if value="{{{{ d.scored }}}}">{g.legend([('var(--label-secondary)', 'Elevation', ''), (g.WIND_C['t'], 'Tailwind', ''), (g.WIND_C['c'], 'Crosswind', ''), (g.WIND_C['h'], 'Headwind', '')])}</sc-if></div>
  </div>
  <sc-if value="{{{{ d.scored }}}}"><div>
    <div class="section-h"><h3>Why It Scored {{{{ d.s }}}}</h3></div>
    <div class="list"><sc-for list="{{{{ d.factors }}}}" as="f"><div class="frow"><div class="nl"><span class="fname">{{{{ f.name }}}}</span><b>{{{{ f.v }}}}</b></div><div class="ftrack"><span style="width: {{{{ f.v }}}}%"></span></div><div class="sub">{{{{ f.text }}}}</div></div></sc-for></div>
  </div></sc-if>
  <div class="list acts">
    <sc-if value="{{{{ d.dep }}}}"><button class="act"><i class="icon-calendar-plus"></i>Add to Calendar<span class="act-t">{{{{ d.cal }}}}<i class="icon-chevron-down"></i></span></button></sc-if>
    <sc-if value="{{{{ d.src }}}}"><button class="act"><i class="icon-external-link"></i>Open in cycle.travel</button></sc-if>
    <button class="act"><i class="icon-download"></i>Download GPX</button>
    <sc-if value="{{{{ d.inList }}}}"><button class="act danger" onclick="{{{{ remove }}}}"><i class="icon-circle-minus"></i>Remove from shortlist</button></sc-if>
  </div>
  <div class="footer">Forecast retrieved 08:10<br />Contains Met Office data licensed under the Open Government Licence v3.0.</div>
</div>"""

PANEL_S = '<div class="panel-s">'
IDEAL_ROW = g.prow('Ideal Temperature', g.chev('11–18°'), 'thermometer', 'orange')
PAUSE_ROW = g.prow('Pause Ride On', g.switch(False), 'circle-pause', 'gray', 'Hide forecasts, scores and alerts. Your routes stay listed.')
PAUSE_OPTS = '<sc-if value="{{ paused }}"><div class="pblock"><div class="seg auto" role="radiogroup" aria-label="Pause for"><sc-for list="{{ pauseOpts }}" as="o"><span class="{{ o.cls }}" role="radio" aria-checked="{{ o.on }}" onclick="{{ o.go }}">{{ o.t }}</span></sc-for></div></div></sc-if>'
PREFS = swap(g.PREFS, g.back('routes', 'Preferences'), head('routes', '', 'Preferences', 'goHome'))
PREFS = swap(PREFS, PANEL_S, SCROLL)
PREFS = swap(PREFS, IDEAL_ROW, IDEAL_ROW.replace('<div class="prow ">', '<div class="prow tap" role="button" onclick="{{ openIdeal }}">').replace('11–18°', '{{ idealText }}'))
PREFS = swap(PREFS, PAUSE_ROW, PAUSE_ROW.replace(g.switch(False), '<span class="{{ pauseCls }}" role="switch" aria-checked="{{ paused }}" aria-label="Pause Ride On" onclick="{{ togglePause }}"><i></i></span>') + PAUSE_OPTS)

FIT = '<sc-for list="{{ fits }}" as="f"><div class="tfit"><span class="name">{{ f.name }}</span><span class="tbar"><span class="tideal" style="left: {{ f.il }}%; right: {{ f.ir }}%"></span><span class="tspan" style="left: {{ f.sl }}%; right: {{ f.sr }}%; background: {{ f.bg }}"></span></span><span class="{{ f.cls }}">{{ f.v }}</span></div></sc-for>'
IDEAL = swap(g.IDEAL, g.back('Preferences', 'Ideal Temperature'), head('Preferences', '', 'Ideal Temperature', 'backToPrefs'))
IDEAL = swap(IDEAL, PANEL_S, SCROLL)
IDEAL = swap(IDEAL, '<b>12–18°</b>', '<b>{{ idealText }}</b>')
IDEAL = swap(IDEAL, '<div class="range ramp" style="--a: 42.5; --b: 57.5">', '<div class="range ramp" style="--a: {{ ia }}; --b: {{ ib }}" role="group" aria-label="Ideal temperature range" onpointerdown="{{ rangeDown }}" onpointermove="{{ rangeMove }}" onpointerup="{{ rangeUp }}">')
IDEAL = swap(IDEAL, ''.join(g.fit_row(*f) for f in g.FITS), FIT)
IDEAL = swap(IDEAL, "Saturday's forecast for each route, start to finish.", '{{ fitsNote }}')

view = lambda flag, body: f'<sc-if value="{{{{ {flag} }}}}"><div class="{{{{ dirCls }}}}">\n{body}\n</div></sc-if>'
DAYS = swap(swap(g.DAYS, 'aria-pressed="{{ d.sel }}"', 'aria-pressed="{{ d.sel }}" onclick="{{ d.go }}"'), 'dbar band-{{ d.band }}', 'dbar')
CURSOR = g.GLANCE.split('\n')[0]
GLANCE = f"""<div class="glance glass {{{{ theme }}}}" role="tooltip"><sc-for list="{{{{ glance }}}}" as="g"><div class="g-item">
  <div class="name">{{{{ g.name }}}}</div>
  <sc-if value="{{{{ g.scored }}}}"><div class="g-score"><b>{{{{ g.s }}}}</b><span class="bar rline" style="background: {{{{ g.c }}}}"></span>{{{{ g.word }}}}</div><div class="sub">{{{{ g.sub }}}}</div><div class="chips">{chip('thermometer', '{{ g.temp }}')}{chip('wind', '{{ g.wind }}')}{chip('droplet-off', 'Dry')}</div><div class="{{{{ g.vcls }}}}"><i class="{{{{ g.vicon }}}}"></i>{{{{ g.verdict }}}}</div></sc-if>
  <sc-if value="{{{{ g.plain }}}}"><div class="sub">{{{{ g.sub }}}}</div><div class="sub">{{{{ g.note }}}}</div></sc-if>
</div></sc-for></div>"""
POP = """<div class="pop glass {{ theme }}" role="dialog" aria-label="Your shortlist is full"><div class="pop-h"><h3>Your shortlist is full</h3><div class="sub">Choose one to swap out for {{ popAdd }}. A shortlist holds 12.</div></div><div class="pop-l" role="radiogroup"><sc-for list="{{ popRows }}" as="r"><div class="{{ r.cls }}" role="radio" aria-checked="{{ r.on }}" onclick="{{ r.go }}"><span class="{{ r.rcls }}"><sc-if value="{{ r.on }}"><i class="icon-check"></i></sc-if></span><span class="name">{{ r.name }}</span><sc-if value="{{ r.scored }}"><b>{{ r.s }}</b><span class="bar rline" style="background: {{ r.c }}"></span></sc-if><sc-if value="{{ r.nofit }}"><span class="sub">Doesn't fit</span></sc-if></div></sc-for></div><div class="pop-a"><button class="btn" onclick="{{ cancelPop }}">Cancel</button><button class="btn tint" onclick="{{ swap }}">Swap</button></div></div>"""
GUIDE = """<div class="guide" role="region" aria-label="Prototype guide">
  <div class="g-h"><span>{{ stepText }}</span><span class="dots"><sc-for list="{{ dots }}" as="x"><span class="dot {{ x }}"></span></sc-for></span></div>
  <div class="g-label">{{ stepLabel }}</div>
  <div class="g-a"><sc-if value="{{ canDo }}"><button class="go" onclick="{{ doIt }}">Do it</button></sc-if><button onclick="{{ restart }}">Restart</button><div class="seg" role="radiogroup" aria-label="Viewport"><span class="{{ deskCls }}" role="radio" onclick="{{ toDesk }}">Desktop</span><span class="{{ phoneCls }}" role="radio" onclick="{{ toPhone }}">Mobile</span></div></div>
</div>"""

TEMPLATE = f"""<div class="proto" data-screen-label="Prototype">
<div class="{{{{ frameCls }}}}">
<div class="map" data-live=""></div>
<sc-if value="{{{{ isPhone }}}}"><div class="statusbar">08:14<span><i class="icon-signal"></i><i class="icon-wifi"></i><i class="icon-battery-full"></i></span></div></sc-if>
<div class="controls"><button class="icon-btn glass" aria-label="Appearance" onclick="{{{{ toggleTheme }}}}"><i class="icon-sun-moon"></i></button></div>
<sc-if value="{{{{ showDays }}}}">{DAYS}</sc-if>
<aside class="{{{{ asideCls }}}}">
<sc-if value="{{{{ isPhone }}}}"><div class="grab" onpointerdown="{{{{ grabDown }}}}" onpointerup="{{{{ grabUp }}}}"><div class="grabber"></div></div></sc-if>
{view('isHome', HOME)}
{view('isPausedHome', PAUSED)}
{view('isDetail', DETAIL)}
{view('isPrefs', PREFS)}
{view('isIdeal', IDEAL)}
</aside>
<sc-if value="{{{{ pill }}}}"><div class="checkpill glass" role="status"><i class="icon-loader-circle spin"></i>Checking the forecast…</div></sc-if>
<sc-if value="{{{{ showGlance }}}}"><sc-if value="{{{{ glanceDemo }}}}">{CURSOR}</sc-if>{GLANCE}</sc-if>
<sc-if value="{{{{ pop }}}}">{POP}</sc-if>
<sc-if value="{{{{ toast }}}}"><div class="toast glass {{{{ theme }}}}" role="status"><span>{{{{ toast.text }}}}</span><button class="btn" onclick="{{{{ undo }}}}">Undo</button></div></sc-if>
<sc-if value="{{{{ isDesk }}}}"><div class="osm">© OpenStreetMap</div></sc-if>
</div>
{GUIDE}
</div>"""

SCRIPT = (gen / 'proto-logic.js').read_text()
html = f"""<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><script src="./support.js"></script></head><body><x-dc><helmet data-dc-atomics><title>Ride On Web: prototype</title><link rel="stylesheet" href="https://unpkg.com/lucide-static@0.469.0/font/lucide.css" /><link rel="stylesheet" href="./ride-on.css" /><link rel="stylesheet" href="./proto.css" /><script src="./map/routes.js"></script><script src="./map/elev.js"></script><script src="./map/cyclemap.js"></script><script src="./map/live.js"></script><script src="./glass.js"></script></helmet>
{TEMPLATE}
</x-dc><script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":900}}}}'>{SCRIPT}</script></body></html>
"""
(gen.parent / 'up' / 'Prototype.dc.html').write_text(html)
(gen / 'proto-check.js').write_text(SCRIPT)
print(len(html.splitlines()), 'lines', len(html), 'bytes')
