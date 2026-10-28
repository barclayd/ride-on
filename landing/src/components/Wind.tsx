import { useRef } from 'react';
import { bezier, clamp } from '../lib/math';
import { sticky, useScrollProgress } from '../lib/scroll';

type Point = readonly [number, number];
type Segment = {
  name: string;
  color: string;
  km: number;
  from: number;
  to: number;
  note: string;
  d: string;
  points: readonly [Point, Point, Point, Point];
};

const SEGMENTS: Segment[] = [
  {
    name: 'Tailwind',
    color: '#30D158',
    km: 21,
    from: 0,
    to: 21,
    note: 'The wind behind you on the way out.',
    d: 'M40,160 C40,90 90,40 150,40',
    points: [
      [40, 160],
      [40, 90],
      [90, 40],
      [150, 40],
    ],
  },
  {
    name: 'Crosswind',
    color: '#FFD60A',
    km: 13,
    from: 21,
    to: 34,
    note: 'Side-on along the top of the loop.',
    d: 'M150,40 C220,40 260,80 260,120',
    points: [
      [150, 40],
      [220, 40],
      [260, 80],
      [260, 120],
    ],
  },
  {
    name: 'Headwind',
    color: '#FF453A',
    km: 12,
    from: 34,
    to: 46,
    note: 'Into it on the climb back.',
    d: 'M260,120 C260,170 210,180 170,170',
    points: [
      [260, 120],
      [260, 170],
      [210, 180],
      [170, 170],
    ],
  },
  {
    name: 'Crosswind',
    color: '#FFD60A',
    km: 5,
    from: 46,
    to: 51,
    note: 'Easing off for the last few kilometres.',
    d: 'M170,170 C130,160 100,190 40,160',
    points: [
      [170, 170],
      [130, 160],
      [100, 190],
      [40, 160],
    ],
  },
];
const LOOP = SEGMENTS.map((segment, i) =>
  i ? segment.d.replace(/^M[\d,]+ /, '') : segment.d,
).join(' ');
const ELEVATION =
  'M0,100 L60,92 L120,72 L180,80 L240,42 L300,20 L360,48 L420,60 L480,86 L540,76 L600,100';
const LEGEND = [
  ['Tailwind', '#30D158', 21],
  ['Crosswind', '#FFD60A', 18],
  ['Headwind', '#FF453A', 12],
] as const;

/** A loop drawn section by section as the page scrolls, each coloured by the wind you'd face on it. */
export default function Wind() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref, sticky);
  const along = progress * 4.2;
  const index = Math.min(SEGMENTS.length - 1, Math.floor(along));
  const current = SEGMENTS[index] as Segment;
  const [dotX, dotY] = bezier(current.points, clamp(along - index));
  const moving = progress > 0.005 && progress < 0.995;

  return (
    <section ref={ref} id="wind" className="wind">
      <div className="wind-stage">
        <div className="wrap split wind-split">
          <div className="copy">
            <div className="eyebrow">Wind on your route</div>
            <h2 className="h2" style={{ textWrap: 'balance' }}>
              We follow you round the route.
            </h2>
            <p className="lede">
              Every section, every hour, the way you'll be facing.
            </p>
            <div className="wind-readout tabular">
              <div className="wind-readout-km">
                km {current.from}–{current.to}
              </div>
              <div className="wind-readout-name">
                <span
                  className="swatch"
                  style={{ background: current.color }}
                />
                {current.name}
              </div>
              <div className="wind-readout-note">{current.note}</div>
            </div>
          </div>
          <div className="wind-card">
            <div className="wind-map">
              <svg
                viewBox="0 0 300 210"
                role="img"
                aria-labelledby="wind-map-title"
              >
                <title id="wind-map-title">
                  A 51 km loop: tailwind out, crosswind across the top, headwind
                  on the climb back
                </title>
                <path
                  d={LOOP}
                  fill="none"
                  stroke="#8E8E93"
                  strokeOpacity={0.35}
                  strokeWidth={6}
                  strokeLinecap="round"
                />
                {SEGMENTS.map((segment, i) => {
                  const offset = 1 - clamp(along - i);
                  return (
                    <g
                      key={segment.d}
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray="1 1"
                      strokeDashoffset={offset}
                    >
                      <path
                        d={segment.d}
                        pathLength={1}
                        stroke="#fff"
                        strokeWidth={7}
                      />
                      <path
                        d={segment.d}
                        pathLength={1}
                        stroke={segment.color}
                        strokeWidth={4.5}
                      />
                    </g>
                  );
                })}
                <circle cx={40} cy={160} r={6} fill="#fff" />
                <circle cx={40} cy={160} r={3.5} fill="#30D158" />
                <text
                  x={50}
                  y={178}
                  fill="#8E8E93"
                  fontSize={9}
                  fontFamily="-apple-system,sans-serif"
                >
                  Start
                </text>
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={5}
                  fill="#fff"
                  opacity={moving ? 1 : 0}
                />
              </svg>
              <div className="compass">
                <div className="compass-dial" aria-hidden="true">
                  ↑
                </div>
                From SW
              </div>
            </div>
            <div className="wind-detail">
              <div className="wind-detail-head">
                <span>Along the Route</span>
                <span className="tabular">640 m climb</span>
              </div>
              <div className="elevation">
                <svg
                  viewBox="0 0 600 120"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d={`${ELEVATION} L600,120 L0,120Z`}
                    fill="rgba(48,209,88,0.18)"
                  />
                  <path
                    d={ELEVATION}
                    fill="none"
                    stroke="#30D158"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="scrub" style={{ left: `${progress * 100}%` }} />
              </div>
              <div className="wind-strip" aria-hidden="true">
                {SEGMENTS.map((segment, i) => (
                  <div key={segment.d} style={{ flex: segment.km }}>
                    <div
                      style={{
                        width: `${clamp(along - i) * 100}%`,
                        height: '100%',
                        background: segment.color,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="legend tabular">
                {LEGEND.map(([name, color, km]) => (
                  <span key={name}>
                    <span className="swatch" style={{ background: color }} />
                    {name} {km} km
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
