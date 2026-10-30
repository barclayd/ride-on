import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  DropletOff,
  LoaderCircle,
  Moon,
  Plus,
  Route,
  Search,
  Sparkles,
  Sun,
  Thermometer,
  TriangleAlert,
  Wind,
} from 'lucide-static';
import { clientEntry, type Handle, on, ref, unsafeHTML } from 'remix/component';
import { board } from './board.ts';
import { type IconName, panel, type Tone } from './view.ts';

const ICONS: Record<IconName, string> = {
  thermometer: Thermometer,
  wind: Wind,
  sun: Sun,
  cloudSun: CloudSun,
  cloud: Cloud,
  cloudFog: CloudFog,
  moon: Moon,
  cloudMoon: CloudMoon,
  dropletOff: DropletOff,
  cloudRain: CloudRain,
  cloudDrizzle: CloudDrizzle,
  cloudSnow: CloudSnow,
  cloudHail: CloudHail,
  cloudLightning: CloudLightning,
};
const TONES: Record<Tone, string> = {
  meets: CircleCheck,
  close: CircleAlert,
  low: TriangleAlert,
};

/** A lucide icon, inline so it takes the text colour. The SVGs are the package's own, never user input. */
const icon = (svg: string, extra = '') => (
  <i
    class={extra ? `icon ${extra}` : 'icon'}
    aria-hidden="true"
    innerHTML={unsafeHTML(svg)}
  />
);

/** The route's identity colour; panels use the tokens, which lift in Dark Mode. */
const colour = (id: string) => {
  const slot = board.slots.get(id);
  return slot === undefined
    ? 'var(--fill-secondary)'
    : `var(--route-${slot + 1})`;
};

/** Pointing at a row lifts its line on the map, and pointing at a line lights its row. */
const hover = (id: string) => [
  on<HTMLElement>('mouseenter', () => board.hover(id)),
  on<HTMLElement>('mouseleave', () => board.hover(null)),
];
const hovered = (id: string) => (board.hovered === id ? ' hover' : '');

/** The panel's header and list (SPEC §6.1): best pick, shortlist, routes that don't fit, library. */
export const Panel = clientEntry(
  '/assets/panel.js#Panel',
  function Panel(handle: Handle) {
    let query = '';
    // Browser only: the board is a module singleton, so it must never load or subscribe on the server.
    handle.queueTask(() => {
      board.addEventListener('change', () => handle.update(), {
        signal: handle.signal,
      });
      board.load();
    });

    return () => {
      const { library } = board;
      const view =
        library &&
        panel({
          routes: library.routes,
          shortlist: board.shortlist,
          recs: board.recs,
          checking: board.checking,
          recsFailed: board.recsFailed,
          query,
        });
      return (
        <>
          <div class="panel-h">
            <label class="search">
              {icon(Search)}
              <input
                type="search"
                placeholder="Search routes"
                aria-label="Search routes"
                value={query}
                mix={on('input', (event) => {
                  query = event.currentTarget.value;
                  handle.update();
                })}
              />
            </label>
          </div>
          <div class="panel-s">
            {!view ? (
              // ponytail: the designed loading and error states are 2.6 (SPEC §7.8).
              <p class="hint">
                {board.failed
                  ? "Couldn't load your routes."
                  : 'Loading your routes…'}
              </p>
            ) : (
              <>
                {view.best && (
                  <div
                    class={`card${hovered(view.best.id)}`}
                    mix={hover(view.best.id)}
                  >
                    <span class="pill">
                      {icon(Sparkles)}Best pick · {view.best.day}
                    </span>
                    <div class="hero">
                      <div class="f1 minw0">
                        <h2>{view.best.name}</h2>
                        <div class="dep">{view.best.dep}</div>
                        <div class="facts">{view.best.facts}</div>
                      </div>
                      <div class="hero-score">
                        <b>{view.best.score}</b>
                        <span
                          class="bar rline"
                          style={{ background: colour(view.best.id) }}
                        />
                        <span>{view.best.word}</span>
                      </div>
                    </div>
                    <div class="chips">
                      {view.best.chips.map((chip) => (
                        <span key={chip.icon} class="chip">
                          {icon(ICONS[chip.icon])}
                          {chip.text}
                        </span>
                      ))}
                    </div>
                    <div class={`verdict ${view.best.verdict.tone}`}>
                      {icon(TONES[view.best.verdict.tone])}
                      {view.best.verdict.text}
                    </div>
                  </div>
                )}
                <div>
                  <div class="section-h">
                    <h3>Shortlist</h3>
                    <span>{view.count}</span>
                  </div>
                  {view.rows.length ? (
                    <div class="list">
                      {view.rows.map((row) => (
                        <div
                          key={row.id}
                          class={`row${hovered(row.id)}`}
                          mix={hover(row.id)}
                        >
                          <div class="score">
                            <b>{row.score}</b>
                            <span
                              class="bar rline"
                              style={{ background: colour(row.id) }}
                            />
                          </div>
                          <div class="f1 minw0">
                            <div class="nl">
                              <span class="name">{row.name}</span>
                              <span class="delta">{row.delta}</span>
                            </div>
                            <div class="sub">{row.l1}</div>
                            <div class="sub">{row.l2}</div>
                            {row.below && (
                              <div class="sub warn">
                                {icon(TriangleAlert)}
                                {row.below}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !board.shortlist.length && (
                      <p class="hint">
                        Add routes from your library to see when to ride them.
                      </p>
                    )
                  )}
                </div>
                {view.doesntFit.length > 0 && (
                  <div>
                    <div class="section-h">
                      <h3>Doesn't Fit Your Window</h3>
                    </div>
                    <div class="list">
                      {view.doesntFit.map((row) => (
                        <div
                          key={row.id}
                          class={`row${hovered(row.id)}`}
                          mix={hover(row.id)}
                        >
                          <div class="score">
                            {icon(Clock)}
                            <span
                              class="bar rline"
                              style={{ background: colour(row.id) }}
                            />
                          </div>
                          <div class="f1 minw0">
                            <div class="name">{row.name}</div>
                            <div class="sub">{row.facts}</div>
                            <div class="sub">{row.reason}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {view.library.length > 0 && (
                  <div>
                    <div class="section-h">
                      <h3>Library</h3>
                      <span>{view.libraryCount}</span>
                    </div>
                    <div class="list">
                      {view.library.map((row) => (
                        <div
                          key={row.id}
                          class={`row lib${hovered(row.id)}`}
                          mix={hover(row.id)}
                        >
                          <div class="thumb">{icon(Route)}</div>
                          <div class="f1 minw0">
                            <div class="name">{row.name}</div>
                            <div class="sub">{row.facts}</div>
                            <div class="sub">{row.src}</div>
                          </div>
                          <button
                            class="add"
                            type="button"
                            aria-label={`Add ${row.name} to your shortlist`}
                            mix={on('click', (event) => {
                              event.stopPropagation();
                              board.add(row.id);
                            })}
                          >
                            {icon(Plus)}Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {view.footer && (
                  <div class="footer">
                    {view.footer.updated}
                    {view.footer.attribution.map(({ text, url }) => (
                      <>
                        <br />
                        <a href={url} target="_blank" rel="noreferrer">
                          {text}
                        </a>
                      </>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      );
    };
  },
);

/**
 * What floats over the map, outside the panel because the panel clips: the forecast pill, the
 * full-shortlist sheet and the swap's undo toast (design/up/Prototype.dc.html).
 */
export const Overlays = clientEntry(
  '/assets/panel.js#Overlays',
  function Overlays(handle: Handle) {
    handle.queueTask(() => {
      board.addEventListener('change', () => handle.update(), {
        signal: handle.signal,
      });
    });

    return () => {
      const { pop, toast, recs } = board;
      const ranking = (id: string) =>
        recs?.rankings.find((r) => r.routeId === id) ??
        recs?.unranked.find((r) => r.routeId === id);
      return (
        <>
          {board.asking && (
            <div class="checkpill glass" role="status">
              {icon(LoaderCircle, 'spin')}Checking the forecast…
            </div>
          )}
          {pop && (
            <div
              class="pop glass"
              role="dialog"
              aria-label="Your shortlist is full"
              mix={on('keydown', (event) => {
                if (event.key === 'Escape') board.cancel();
              })}
            >
              <div class="pop-h">
                <h3>Your shortlist is full</h3>
                <div class="sub">
                  Choose one to swap out for {board.name(pop.add)}. A shortlist
                  holds 12.
                </div>
              </div>
              {/* Native radios, so arrow keys move the choice; the dot is drawn by .radio. */}
              <div class="pop-l">
                {board.shortlist.map((id) => {
                  const r = ranking(id);
                  const picked = id === pop.out;
                  return (
                    <label key={id} class={`pop-r${picked ? ' on' : ''}`}>
                      <input
                        class="sr"
                        type="radio"
                        name="swap-out"
                        value={id}
                        checked={picked}
                        mix={on('change', () => board.choose(id))}
                      />
                      <span class={`radio${picked ? ' on' : ''}`}>
                        {picked && icon(Check)}
                      </span>
                      <span class="name">{board.name(id)}</span>
                      {r?.best ? (
                        <>
                          <b>{Math.round(r.best.score)}</b>
                          <span
                            class="bar rline"
                            style={{ background: colour(id) }}
                          />
                        </>
                      ) : (
                        <span class="sub">
                          {r?.verdict.status === 'doesnt_fit'
                            ? "Doesn't fit"
                            : '–'}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div class="pop-a">
                <button
                  class="btn"
                  type="button"
                  mix={on('click', () => board.cancel())}
                >
                  Cancel
                </button>
                <button
                  class="btn tint"
                  type="button"
                  mix={[
                    on('click', () => board.swap()),
                    ref((node) => (node as HTMLElement).focus()),
                  ]}
                >
                  Swap
                </button>
              </div>
            </div>
          )}
          {toast && (
            <div class="toast glass" role="status">
              <span>{toast.text}</span>
              {toast.undo && (
                <button
                  class="btn"
                  type="button"
                  mix={on('click', () => board.undo())}
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </>
      );
    };
  },
);
