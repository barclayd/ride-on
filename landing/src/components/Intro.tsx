import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { type CSSProperties, useEffect, useRef } from 'react';
import landscape from '../assets/intro/landscape.avif';
import portrait from '../assets/intro/portrait.avif';
import posters from '../data/posters.json';
import {
  camera,
  MAX_ZOOM,
  MIN_ZOOM,
  OVERHANG,
  ROUTES,
  type Route,
  route,
  TILE,
  toLngLat,
} from '../lib/map';
import { clamp, easeInOut } from '../lib/math';
import { sticky } from '../lib/scroll';

type Fx = 'sun' | 'wind' | 'clouds' | 'still' | 'sunset' | 'dream' | 'terms';

// Each phrase flies the map to the ride at the same index in src/data/routes.json.
const WORDS: { text: string; emoji: string; fx: Fx }[] = [
  { text: 'sunny days', emoji: '☀️', fx: 'sun' },
  { text: 'tailwinds', emoji: '💨', fx: 'wind' },
  { text: 'dry roads', emoji: '🌤️', fx: 'clouds' },
  { text: 'still mornings', emoji: '🍃', fx: 'still' },
  { text: 'warm evenings', emoji: '🌅', fx: 'sunset' },
  { text: 'dream days', emoji: '✨', fx: 'dream' },
  { text: 'perfect conditions', emoji: '✅', fx: 'terms' },
];
const N = WORDS.length;
const FX_INDEX = Object.fromEntries(
  WORDS.map((word, i) => [word.fx, i]),
) as Record<Fx, number>;

// Only these phrases move letter by letter.
const SPLIT = new Set<Fx>(['wind', 'dream', 'terms']);
const LETTERS = WORDS.map((word) =>
  [...word.text].map((letter, j) => ({ letter, id: `${word.fx}-${j}` })),
);

const BEAMS = [
  [44, 10, 0],
  [57, 6, 0.15],
  [67, 14, 0.3],
  [81, 5, 0.45],
  [30, 7, 0.6],
] as const;
const STREAKS = Array.from({ length: 9 }, (_, i) => ({
  id: i,
  top: 12 + i * 9.5,
  width: 16 + ((i * 7) % 15),
}));
const CLOUDS = {
  left: [
    [-5, 8, 60, 36],
    [12, 42, 52, 30],
    [-10, 60, 45, 26],
  ],
  right: [
    [42, 4, 58, 34],
    [30, 38, 55, 32],
    [52, 62, 48, 26],
  ],
} as const;
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  left: (i * 37 + 11) % 96,
  top: (i * 53 + 7) % 92,
  size: 12 + ((i * 7) % 16),
  color: i % 3 ? 'light-dark(#8944AB,#BF5AF2)' : 'light-dark(#B07A00,#FFD60A)',
}));
const RINGS = [0, 1, 2];

const cloud: CSSProperties = {
  borderRadius: '50%',
  background:
    'radial-gradient(closest-side,light-dark(rgba(90,100,125,0.22),rgba(205,210,225,0.2)),rgba(128,128,128,0))',
};

// Phones get the compact layout below this width, as in global.css.
const PHONE = '(width < 700px)';

// The map's hillshade and contour sources, which phones go without.
const RELIEF = ['terrain', 'contours'];

// A phrase runs from its first letter to the far edge of its emoji.
const phraseWidth = (row: Element) => {
  const first = row.firstElementChild as HTMLElement | null;
  const last = row.lastElementChild as HTMLElement | null;
  return first && last
    ? last.offsetLeft + last.offsetWidth - first.offsetLeft
    : 0;
};

// Fits the first phrase before the island hydrates, so a phone never paints "Ride on" clipped.
const FIRST_FIT = `{const f=document.currentScript.previousElementSibling.firstElementChild,[h,c]=f.children,r=c.querySelector('[data-row]'),w=(${phraseWidth})(r),s=Math.min(1,(f.parentElement.offsetWidth-32)/(c.offsetLeft-h.offsetLeft+w)),x=matchMedia('${PHONE}').matches?(c.offsetWidth-w)/2:0;f.style.transform='scale('+s+') translateX('+x+'px)'}`;

// Values at the top of the page, so the server render matches the first frame.
const I = (raw: number, i: number) =>
  clamp(1 - Math.abs(raw - (i + 0.25)) / 0.7);
const P = (raw: number, i: number) => clamp((raw - i + 0.45) / 1.4);
const rowOpacity = (i: number, pos: number) => {
  const d = Math.abs(i - pos);
  return Math.round(pos) === i ? 1 : Math.max(0.06, 0.3 - 0.07 * (d - 1));
};

// Each ride draws in as its phrase arrives, then fades back while the map flies to the next.
const drawn = (raw: number, i: number) => {
  const from = i ? i - 0.15 : 0;
  return clamp((raw - from) / (i + 0.5 - from));
};
const dim = (raw: number, i: number) => 1 - 0.65 * clamp((raw - i - 0.5) / 0.5);

// The poster's bounds around the first ride, in units of that ride's width, so the stylesheet can
// place it at the opening zoom before the island hydrates.
const first = route(0);
const posterVars = {
  '--aspect': (first.h / first.w).toFixed(4),
  '--min': `${(TILE * 2 ** MIN_ZOOM * first.w).toFixed(2)}px`,
  '--max': `${(TILE * 2 ** MAX_ZOOM * first.w).toFixed(2)}px`,
  ...Object.fromEntries(
    Object.entries(posters).flatMap(([name, { x, y, w, h }]) =>
      Object.entries({
        x: (x - first.cx) / first.w,
        y: (y - first.cy) / first.w,
        w: w / first.w,
        h: h / first.w,
      }).map(([key, value]) => [`--${key}-${name[0]}`, value.toFixed(4)]),
    ),
  ),
} as CSSProperties;

type SaveData = Navigator & { connection?: { saveData?: boolean } };

export default function Intro() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const all = (selector: string) => [
      ...section.querySelectorAll<HTMLElement | SVGElement>(selector),
    ];
    const one = (selector: string) =>
      section.querySelector<HTMLElement>(selector);

    const stage = one('.intro-stage');
    const drift = one('.intro-drift');
    const mapContainer = one('.intro-map');
    const poster = one('.intro-poster');
    const live = one('.intro-live');
    const fit = one('[data-fit]');
    const heading = one('.intro-text h1');
    const column = one('.intro-list');
    const list = one('[data-list]');
    const cue = one('.intro-cue');
    const fxRoot = one('[data-fx-root]');
    const grid = document.getElementById('grid');
    const rows = all('[data-row]');
    const emoji = all('[data-emoji]');
    const letters = WORDS.map((_, i) => all(`[data-row="${i}"] [data-letter]`));
    const layers = all('[data-fx]');
    const beams = all('[data-beam]');
    const streaks = all('[data-streak]');
    const sparks = all('[data-spark]');
    const rings = all('[data-ring]');
    const [cloudGlow, cloudLeft, cloudRight, sunsetGlow, sunsetSun] = [
      one('[data-cloud="glow"]'),
      one('[data-cloud="left"]'),
      one('[data-cloud="right"]'),
      one('[data-sunset="glow"]'),
      one('[data-sunset="sun"]'),
    ];
    const groups = all('[data-route]');
    const strokes = groups.map((group) => [...group.querySelectorAll('path')]);
    const starts = groups.map((group) => [...group.querySelectorAll('circle')]);
    if (
      !stage ||
      !drift ||
      !mapContainer ||
      !live ||
      !fit ||
      !heading ||
      !column ||
      !list ||
      !cue ||
      !fxRoot
    )
      return;

    const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
    const portraitQuery = matchMedia('(orientation: portrait)');
    const phoneQuery = matchMedia(PHONE);
    let map: MapLibreMap | undefined;
    let view = { center: toLngLat(route(0).cx, route(0).cy), zoom: 10 };
    let frame = 0;
    let last = 0;
    let t = 0;
    let introOn: boolean | undefined;
    let cameraKey = '';

    // Widths for fitting the text, read again whenever the layout changes.
    let measured = false;
    let phrases: number[] = [];
    let [rideWidth, gapWidth, columnWidth] = [0, 0, 0];
    const measure = () => {
      measured = true;
      phrases = rows.map(phraseWidth);
      rideWidth = heading.offsetWidth;
      gapWidth = column.offsetLeft - heading.offsetLeft - rideWidth;
      columnWidth = column.offsetWidth;
    };
    const remeasure = () => {
      measured = false;
      schedule();
    };

    const render = (raw: number, reduced: boolean) => {
      const k = Math.min(N - 1, Math.floor(raw));
      const eased = Math.min(
        N - 1,
        k + easeInOut(clamp((raw - k - 0.5) / 0.5)),
      );
      const pos = reduced ? Math.round(eased) : eased;
      const act = Math.round(pos);
      if (!measured) measure();
      const { width, height } = stage.getBoundingClientRect();

      // Text: scale "Ride on" and the phrase in view to fit one line, and on phones centre the
      // pair rather than "Ride on" and the widest phrase. Mid-swap it sizes for the wider of the
      // two phrases, so the one in view never runs off the edge.
      const at = Math.floor(pos);
      const swap = pos - at;
      const from = phrases[at] ?? 0;
      const to = phrases[at + 1] ?? from;
      const wide = Math.max(from, to);
      const phrase =
        swap < 0.5
          ? from + (wide - from) * swap * 2
          : wide + (to - wide) * (swap * 2 - 1);
      const scale = Math.min(1, (width - 32) / (rideWidth + gapWidth + phrase));
      const shift = phoneQuery.matches ? (columnWidth - phrase) / 2 : 0;
      fit.style.transform = `scale(${scale.toFixed(4)}) translateX(${shift.toFixed(1)}px)`;
      list.style.transform = `translateY(${(-pos * 1.18).toFixed(3)}em)`;
      cue.style.opacity = clamp(1 - raw * 2).toFixed(2);
      WORDS.forEach((word, i) => {
        const row = rows[i];
        const glyph = emoji[i];
        if (!row || !glyph) return;
        const active = i === act;
        const ii = reduced ? 0 : I(raw, i);
        const p = P(raw, i);
        row.style.opacity = (
          reduced ? (active ? 1 : 0) : rowOpacity(i, pos)
        ).toFixed(2);
        row.style.color = active ? 'var(--accent)' : '';
        row.style.textShadow =
          word.fx === 'sun' && ii
            ? `0 0 ${((0.3 + 0.1 * Math.sin(t * 1.6)) * ii).toFixed(3)}em rgba(255,214,10,${(0.7 * ii).toFixed(2)})`
            : word.fx === 'sunset' && ii
              ? `0 0 ${(0.35 * ii).toFixed(3)}em rgba(255,149,0,${(0.6 * ii).toFixed(2)})`
              : '';

        letters[i]?.forEach((span, j, spans) => {
          let [x, y, r] = [0, 0, 0];
          if (word.fx === 'wind') {
            const phase = j * 0.8 - p * 18 - t * 5;
            x = ii * 0.1 * (0.6 + 0.4 * Math.sin(phase));
            y = ii * 0.05 * Math.sin(phase);
            r = ii * 7 * Math.sin(phase + 1);
          } else if (word.fx === 'dream') {
            y = ii * 0.06 * Math.sin(j * 0.9 + p * 12 + t * 2.2);
          } else if (word.fx === 'terms') {
            x = (j - (spans.length - 1) / 2) * 0.07 * (1 - clamp(p * 1.8)) * ii;
            y = ii * 0.015 * Math.sin(t * 2.4 - j * 0.35);
          }
          span.style.transform = ii
            ? `translate(${x.toFixed(3)}em,${y.toFixed(3)}em) rotate(${r.toFixed(2)}deg)`
            : '';
        });

        let [ex, ey, er, es] = [0, 0, 0, active ? 1 : 0.75];
        if (!reduced) {
          if (word.fx === 'sun') er = p * 120 + t * 25;
          if (word.fx === 'wind') ex = ii * (p * 0.4 + 0.08 * Math.sin(t * 3));
          if (word.fx === 'clouds')
            ex = (p - 0.5) * 0.1 * ii + 0.04 * Math.sin(t * 0.8) * ii;
          if (word.fx === 'still') er = Math.sin(p * 6 + t * 0.9) * 8 * ii;
          if (word.fx === 'sunset') ey = p * 0.12 + 0.03 * Math.sin(t * 1.1);
          if (word.fx === 'dream')
            es *= 1 + 0.12 * Math.sin(p * 14 + t * 2.5) * ii;
          if (word.fx === 'terms' && active)
            es =
              (0.5 + 0.5 * clamp(p * 2)) * (1 + 0.06 * Math.sin(t * 2.4) * ii);
        }
        glyph.style.transform = `translate(${ex.toFixed(3)}em,${ey.toFixed(3)}em) rotate(${er.toFixed(1)}deg) scale(${es.toFixed(3)})`;
        glyph.style.filter = active ? '' : 'grayscale(1)';
      });

      // Weather
      fxRoot.hidden = reduced;
      if (!reduced) {
        layers.forEach((layer, i) => {
          const o = I(raw, i) * (WORDS[i]?.fx === 'still' ? 0.9 : 1);
          layer.style.opacity = o.toFixed(2);
          layer.style.visibility = o ? '' : 'hidden';
        });
        const live = (fx: Fx) => I(raw, FX_INDEX[fx]) > 0;
        const progress = (fx: Fx) => P(raw, FX_INDEX[fx]);
        if (live('sun')) {
          const sp = progress('sun');
          beams.forEach((beam, n) => {
            const delay = BEAMS[n]?.[2] ?? 0;
            const y =
              -70 +
              70 * easeInOut(clamp(sp * 1.6 - delay * 0.5)) +
              4 * Math.sin(t * 0.7 + delay * 6);
            beam.style.transform = `rotate(28deg) translateY(${y.toFixed(1)}%)`;
            beam.style.opacity = (
              0.55 +
              0.45 * Math.sin(sp * 8 + delay * 10 + t * 1.3)
            ).toFixed(2);
          });
        }
        if (live('wind')) {
          const wp = progress('wind');
          streaks.forEach((streak, i) => {
            const x =
              -45 +
              (((wp * 170 + t * 38) * (0.8 + (i % 3) * 0.2) + ((i * 29) % 60)) %
                190);
            streak.style.transform = `translateX(${x.toFixed(1)}vw)`;
          });
        }
        if (live('clouds') && cloudGlow && cloudLeft && cloudRight) {
          const cp = progress('clouds');
          cloudGlow.style.opacity = (
            cp *
            (0.8 + 0.2 * Math.sin(t * 1.2))
          ).toFixed(2);
          cloudLeft.style.transform = `translateX(${(-easeInOut(cp) * 42 - 3 * Math.sin(t * 0.5)).toFixed(1)}vw)`;
          cloudRight.style.transform = `translateX(${(easeInOut(cp) * 42 + 3 * Math.sin(t * 0.5 + 1)).toFixed(1)}vw)`;
        }
        if (live('still')) {
          const mist = layers[FX_INDEX.still];
          const x = (progress('still') - 0.5) * 12 + 6 * Math.sin(t * 0.3);
          if (mist) mist.style.transform = `translateX(${x.toFixed(1)}vw)`;
        }
        if (live('sunset') && sunsetGlow && sunsetSun) {
          const tp = progress('sunset');
          sunsetGlow.style.transform = `translateY(${((1 - easeInOut(tp)) * 45 + 3 * Math.sin(t * 0.6)).toFixed(1)}%)`;
          sunsetSun.style.transform = `translateY(${(10 + tp * 40 + 4 * Math.sin(t * 0.5)).toFixed(1)}%)`;
        }
        if (live('dream')) {
          const dp = progress('dream');
          sparks.forEach((spark, i) => {
            const twinkle = Math.max(0, Math.sin(dp * 10 + t * 1.8 + i * 1.7));
            spark.style.opacity = (0.25 + 0.75 * twinkle).toFixed(2);
            spark.style.transform = `scale(${(0.5 + 0.6 * twinkle).toFixed(2)}) rotate(${(dp * 90 + t * 20 + i * 20).toFixed(1)}deg)`;
          });
        }
        if (live('terms')) {
          const rp = progress('terms');
          rings.forEach((ring, i) => {
            const q = (rp * 1.6 + t * 0.3 + i / 3) % 1;
            ring.style.transform = `scale(${(0.2 + q * 1.6).toFixed(3)})`;
            ring.style.opacity = (1 - q).toFixed(2);
          });
        }
      }

      // Map: the camera follows the phrase, the backdrop drifts on its own.
      drift.style.transform = reduced
        ? ''
        : `translate(${(-20 * Math.sin(t * 0.12)).toFixed(1)}px,${(-12 * Math.cos(t * 0.1)).toFixed(1)}px)`;
      const key = `${pos.toFixed(4)}|${width}|${height}`;
      if (key !== cameraKey) {
        cameraKey = key;
        const { x: cx, y: cy, zoom } = camera(pos, width, height);
        const scale = TILE * 2 ** zoom;
        const [ox, oy] = [(width + OVERHANG) / 2, (height + OVERHANG) / 2];
        const path = (r: Route) =>
          r.points
            .map(
              ([x, y], n) =>
                `${n ? 'L' : 'M'}${((x - cx) * scale + ox).toFixed(1)},${((y - cy) * scale + oy).toFixed(1)}`,
            )
            .join('');
        ROUTES.forEach((r, i) => {
          const d = path(r);
          for (const stroke of strokes[i] ?? []) stroke.setAttribute('d', d);
          const [sx, sy] = r.points[0] ?? [0, 0];
          for (const start of starts[i] ?? []) {
            start.setAttribute('cx', ((sx - cx) * scale + ox).toFixed(1));
            start.setAttribute('cy', ((sy - cy) * scale + oy).toFixed(1));
          }
        });
        view = { center: toLngLat(cx, cy), zoom };
        map?.jumpTo(view);

        // The poster only covers the first ride, so it fades as the camera leaves in case the live
        // map hasn't taken over by then.
        if (poster) {
          const bounds = portraitQuery.matches
            ? posters.portrait
            : posters.landscape;
          poster.style.left = `${((bounds.x - cx) * scale + ox).toFixed(1)}px`;
          poster.style.top = `${((bounds.y - cy) * scale + oy).toFixed(1)}px`;
          poster.style.width = `${(bounds.w * scale).toFixed(1)}px`;
          poster.style.height = `${(bounds.h * scale).toFixed(1)}px`;
          poster.style.opacity = clamp(1 - pos * 2.5).toFixed(2);
        }
      }
      groups.forEach((group, i) => {
        const draw = reduced ? +(i <= act) : drawn(raw, i);
        const fade = reduced ? (i < act ? 0.35 : 1) : dim(raw, i);
        group.style.opacity = (clamp(draw * 20) * fade).toFixed(2);
        for (const stroke of strokes[i] ?? [])
          stroke.style.strokeDashoffset = (1 - draw).toFixed(3);
      });
    };

    const tick = (now: number) => {
      frame = 0;
      const reduced = reducedQuery.matches;
      const rect = section.getBoundingClientRect();
      const height = window.innerHeight;
      // Past the intro, render once more to settle, then sleep until it scrolls back.
      const on = rect.bottom > height * 0.4;
      const changed = on !== introOn;
      // The map starts on the way back if the page opened further down, and phones drop it on
      // the way out.
      if (changed && introOn !== undefined) {
        if (on) void startMap();
        else if (phoneQuery.matches) stopMap();
      }
      introOn = on;
      if (changed && grid) grid.style.opacity = on ? '' : '0';
      if (!on && !changed) {
        last = 0;
        return;
      }
      if (!reduced && !document.hidden && last)
        t += Math.min(0.1, (now - last) / 1000);
      last = now;
      render(sticky(rect, height) * (N - 0.4), reduced);
      if (on && !reduced) schedule();
      else last = 0;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    document.addEventListener('visibilitychange', schedule);
    reducedQuery.addEventListener('change', schedule);
    void document.fonts.ready.then(remeasure);

    // The live map is a nice-to-have: skip it on Save-Data, and never let it break the page. Its
    // tiles cost a few hundred MB, so phones get a lighter map and hand it back past the intro.
    let cancelled = false;
    let loading = false;
    const startMap = async () => {
      if (map || loading || (navigator as SaveData).connection?.saveData)
        return;
      loading = true;
      const light = phoneQuery.matches;
      try {
        const origin = location.origin;
        const [maplibre, { Protocol }, style] = await Promise.all([
          import(
            /* @vite-ignore */ `${origin}/vendor/maplibre-gl/maplibre-gl.mjs`
          ) as Promise<typeof import('maplibre-gl')>,
          import('pmtiles'),
          fetch('/map/style.json').then(
            (response) => response.json() as Promise<StyleSpecification>,
          ),
        ]);
        if (cancelled || introOn === false) return;
        maplibre.addProtocol('pmtiles', new Protocol().tile);
        style.sprite = `${origin}/map/sprite`;
        style.glyphs = `${origin}/map/glyphs/{fontstack}/{range}.pbf`;
        if (light) {
          // One tile worker rather than Safari's three, and no hillshade or contours.
          maplibre.setWorkerCount(1);
          style.layers = style.layers.filter(
            (layer) =>
              !('source' in layer) || !RELIEF.includes(layer.source as string),
          );
          for (const source of RELIEF) delete style.sources[source];
        }
        let warned = false;
        map = new maplibre.Map({
          container: live,
          style,
          ...view,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          renderWorldCopies: false,
          maxTileCacheZoomLevels: light ? 1 : undefined,
          pixelRatio: Math.min(window.devicePixelRatio, 2),
          // Workers assets redirect any path with an @, so the 2x sprite is published without it.
          transformRequest: (url) => ({
            url: url.replace(/\/sprite(@2x)?\.(json|png)$/, '/sprite2x.$2'),
          }),
        });
        map.on('error', ({ error }) => {
          if (!warned) console.warn('Intro map', error);
          warned = true;
        });
        // Swap the poster out once the first view's tiles have drawn.
        map.once('idle', () => mapContainer.classList.add('is-ready'));
      } catch (error) {
        console.warn('Intro map unavailable', error);
      } finally {
        loading = false;
      }
    };
    const stopMap = () => {
      map?.remove();
      map = undefined;
      mapContainer.classList.remove('is-ready');
    };
    if ('requestIdleCallback' in window)
      requestIdleCallback(() => void startMap());
    else setTimeout(() => void startMap(), 200);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      document.removeEventListener('visibilitychange', schedule);
      reducedQuery.removeEventListener('change', schedule);
      map?.remove();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="intro"
      style={{ height: `${N * 70 + 100}vh` }}
    >
      <div className="intro-stage">
        <div className="intro-layer" aria-hidden="true">
          <div className="intro-drift">
            <div className="intro-map">
              <picture>
                <source media="(orientation: portrait)" srcSet={portrait.src} />
                <img
                  className="intro-poster"
                  src={landscape.src}
                  alt=""
                  fetchPriority="high"
                  style={posterVars}
                />
              </picture>
              <div className="intro-live" />
            </div>
            <svg className="intro-routes">
              <title>Rides</title>
              {ROUTES.map((r) => (
                <g key={r.id} data-route style={{ opacity: 0 }}>
                  <path
                    className="casing"
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1}
                  />
                  <path
                    className="line"
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1}
                  />
                  <circle r={7} fill="#fff" />
                  <circle r={4.5} className="start" />
                </g>
              ))}
            </svg>
          </div>
          <div className="intro-scrim" />
        </div>
        <div className="intro-credit">© OpenStreetMap · Protomaps</div>

        <div className="intro-layer" aria-hidden="true" data-fx-root>
          <div
            className="fx"
            data-fx="sun"
            style={{ opacity: I(0, FX_INDEX.sun).toFixed(2) }}
          >
            <div
              className="round"
              style={{
                top: '-35vmax',
                right: '-25vmax',
                width: '75vmax',
                height: '75vmax',
                background:
                  'radial-gradient(closest-side,rgba(255,214,10,0.3),rgba(255,214,10,0))',
              }}
            />
            {BEAMS.map(([left, width]) => (
              <div
                key={left}
                data-beam
                style={{
                  top: '-30%',
                  left: `${left}%`,
                  width: `${width}vw`,
                  height: '170%',
                  transformOrigin: '50% 0',
                  transform: 'rotate(28deg) translateY(-70%)',
                  background:
                    'linear-gradient(180deg,rgba(255,196,10,0.32) 0%,rgba(255,214,10,0.08) 50%,rgba(255,214,10,0) 80%)',
                  filter: 'blur(6px)',
                }}
              />
            ))}
          </div>
          <div
            className="fx"
            data-fx="wind"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            {STREAKS.map((streak) => (
              <div
                key={streak.id}
                data-streak
                style={{
                  left: 0,
                  top: `${streak.top}%`,
                  width: `${streak.width}vw`,
                  height: 2,
                  borderRadius: 2,
                  background:
                    'linear-gradient(90deg,rgba(48,209,88,0),light-dark(rgba(36,138,61,0.5),rgba(48,209,88,0.6)),rgba(48,209,88,0))',
                }}
              />
            ))}
          </div>
          <div
            className="fx"
            data-fx="clouds"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            <div
              className="round"
              data-cloud="glow"
              style={{
                left: '50%',
                top: '50%',
                width: '70vmax',
                height: '70vmax',
                margin: '-35vmax 0 0 -35vmax',
                background:
                  'radial-gradient(closest-side,rgba(255,214,10,0.3),rgba(255,214,10,0))',
                opacity: 0,
              }}
            />
            {(['left', 'right'] as const).map((side) => (
              <div key={side} data-cloud={side} style={{ inset: 0 }}>
                {CLOUDS[side].map(([left, top, width, height]) => (
                  <div
                    key={left}
                    style={{
                      ...cloud,
                      position: 'absolute',
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}vw`,
                      height: `${height}vw`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div
            className="fx"
            data-fx="still"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            <div
              className="round"
              style={{
                left: '-15%',
                right: '-15%',
                top: '60%',
                height: '34vh',
                background:
                  'radial-gradient(closest-side,light-dark(rgba(90,130,190,0.2),rgba(160,200,255,0.15)),rgba(128,128,128,0))',
              }}
            />
            <div
              className="round"
              style={{
                left: '-25%',
                right: '5%',
                top: '14%',
                height: '22vh',
                background:
                  'radial-gradient(closest-side,light-dark(rgba(90,130,190,0.14),rgba(160,200,255,0.1)),rgba(128,128,128,0))',
              }}
            />
          </div>
          <div
            className="fx"
            data-fx="sunset"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            <div
              data-sunset="glow"
              style={{
                left: 0,
                right: 0,
                bottom: 0,
                height: '75%',
                background:
                  'linear-gradient(0deg,rgba(255,120,0,0.34),rgba(255,69,58,0.12) 50%,rgba(255,69,58,0))',
              }}
            />
            <div
              className="round"
              data-sunset="sun"
              style={{
                left: '50%',
                bottom: 0,
                width: '48vmin',
                height: '48vmin',
                marginLeft: '-24vmin',
                background:
                  'radial-gradient(closest-side,rgba(255,159,10,0.6),rgba(255,159,10,0))',
              }}
            />
          </div>
          <div
            className="fx"
            data-fx="dream"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            {SPARKS.map((spark) => (
              <div
                key={spark.id}
                data-spark
                style={{
                  left: `${spark.left}%`,
                  top: `${spark.top}%`,
                  fontSize: spark.size,
                  lineHeight: 1,
                  color: spark.color,
                }}
              >
                ✦
              </div>
            ))}
          </div>
          <div
            className="fx"
            data-fx="terms"
            style={{ opacity: 0, visibility: 'hidden' }}
          >
            {RINGS.map((ring) => (
              <div
                key={ring}
                className="round"
                data-ring
                style={{
                  left: '50%',
                  top: '50%',
                  width: '80vmin',
                  height: '80vmin',
                  margin: '-40vmin 0 0 -40vmin',
                  border: '2px solid light-dark(#248A3D,#30D158)',
                }}
              />
            ))}
          </div>
        </div>

        <div className="intro-text">
          <div className="intro-fit" data-fit suppressHydrationWarning>
            <h1>
              Ride on
              <span className="visually-hidden">
                {' '}
                for sunny days, tailwinds, dry roads, still mornings, warm
                evenings, dream days and perfect conditions
              </span>
            </h1>
            <div className="intro-list" aria-hidden="true">
              <div data-list>
                {WORDS.map((word, i) => (
                  <div
                    key={word.fx}
                    className="intro-row"
                    data-row={i}
                    style={{
                      opacity: rowOpacity(i, 0),
                      color: i === 0 ? 'var(--accent)' : undefined,
                    }}
                  >
                    <span className="intro-letters">
                      {SPLIT.has(word.fx)
                        ? LETTERS[i]?.map(({ letter, id }) => (
                            <span key={id} data-letter>
                              {letter}
                            </span>
                          ))
                        : word.text}
                    </span>
                    <span
                      className="intro-emoji"
                      data-emoji
                      style={
                        i === 0
                          ? undefined
                          : { filter: 'grayscale(1)', transform: 'scale(0.75)' }
                      }
                    >
                      {word.emoji}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string, written here */}
        <script dangerouslySetInnerHTML={{ __html: FIRST_FIT }} />
        <div className="intro-cue">Scroll</div>
      </div>
    </section>
  );
}
