// Pieces shared by the popup and the Journeys page.
import { type ComponentChildren, createContext } from 'preact';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks';
import { browser } from 'wxt/browser';
import { onStateChange, readState, type State, send } from '../lib/state';
import type { Departure, NextWindow, Outline } from '../lib/types';
import {
  type Banner,
  type Card,
  type CardState,
  type Chip,
  clock,
  conditionChips,
  dayMonth,
  ridden,
  shortDate,
  skyChip,
  viewOf,
} from './format';
import { DIAL, SKETCH, type WindSketch, windPanel } from './wind';

export const iconUrl = () => browser.runtime.getURL('/ride-on-icon.png');
export const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// @font-face is ignored inside shadow roots, so both surfaces declare the fonts on the document.
export const injectFonts = () => {
  const face = (family: string, url: string, weights: string) =>
    `@font-face{font-family:'${family}';src:url('${url}') format('woff2');font-weight:${weights};font-display:swap}`;
  const style = document.createElement('style');
  style.textContent =
    face(
      'RideOn Bricolage',
      browser.runtime.getURL('/fonts/bricolage-grotesque.woff2'),
      '200 800',
    ) +
    face(
      'RideOn Literata',
      browser.runtime.getURL('/fonts/literata.woff2'),
      '200 900',
    );
  document.head.append(style);
  return style;
};

export type View = { state: State } & ReturnType<typeof viewOf>;

export const useView = (poll = false): View | null => {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const stop = onStateChange(setState);
    readState().then((read) => setState((current) => current ?? read));
    if (!poll) return stop;
    // Safari's content scripts can't count on storage events (a copy it re-injects never gets
    // one), so they ask: the small stamp once a second while visible, the state when it moves.
    let stamp: unknown;
    const timer = setInterval(async () => {
      if (document.hidden || !browser.runtime?.id) return;
      const next = (await browser.storage.local.get('stamp')).stamp;
      if (next === stamp) return;
      stamp = next;
      setState(await readState());
    }, 1000);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [poll]);
  return state && { state, ...viewOf(state, new Date()) };
};

export type Option<T> = { value: T; label: string; disabled?: boolean };

export const Segmented = <T extends string>(props: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) => (
  <fieldset class="ro-segmented" aria-label={props.label}>
    {props.options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === props.value}
        disabled={option.disabled}
        onClick={() => props.onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </fieldset>
);

export const CloseButton = (props: { title: string; onClick: () => void }) => (
  <button
    type="button"
    class="ro-close"
    title={props.title}
    aria-label={props.title}
    onClick={props.onClick}
  >
    ×
  </button>
);

export const riddenFor = (view: View, routeId: string) =>
  ridden(view.state.summaries[routeId], view.state.rides, routeId, view.today);

// "Ridden today" and "Last ridden 22 Sep", next to a route's name.
export const Tags = ({ view, routeId }: { view: View; routeId: string }) => {
  const ride = riddenFor(view, routeId);
  return (
    <>
      {ride.today && <span class="ro-tag">Ridden today</span>}
      {ride.last && (
        <span class="ro-tag ro-tag-last">
          Last ridden {dayMonth(ride.last, view.today)}
        </span>
      )}
    </>
  );
};

// No pill for a ride that meets the preferences: the score says it.
const STATES: Record<Exclude<CardState, 'meets'>, string> = {
  below: 'Below your minimums',
  nofit: "Doesn't fit your window",
  incomplete: 'Forecast incomplete',
  pending: 'Checking…',
};
const MEDALS = ['Gold', 'Silver', 'Bronze'];
// Called just before a tile is removed, so Ranked can slide the rest into place (21a).
const Leaving = createContext(() => {});
// The open sky or wind dropdown, by element id: opening one closes the rest.
const OpenPanel = createContext<
  [string | null, (id: string | null) => void] | null
>(null);

// A page tile's line, over a static placeholder bar in the same grid cell.
const Slot = (props: { class: string; children: ComponentChildren }) => (
  <div class={`ro-slot ${props.class}`}>
    {props.children}
    <i aria-hidden="true" />
  </div>
);

// 16-unit stroke icons from the design (11b).
const ICONS: Record<
  Chip['icon'] | 'clock' | 'route' | 'star' | 'chevron' | 'arrow',
  ComponentChildren
> = {
  route: (
    <>
      <circle cx="3.5" cy="12.5" r="1.6" />
      <circle cx="12.5" cy="3.5" r="1.6" />
      <path d="M5 12.5h4.5a2.5 2.5 0 0 0 0-5h-3a2.5 2.5 0 0 1 0-5H11" />
    </>
  ),
  // Filled, on the Best pick tab (the design's 12-unit star, scaled to 16).
  star: (
    <path
      d="M6 1l1.5 3.1 3.4.5-2.5 2.4.6 3.4L6 8.8 2.9 10.4l.6-3.4L1 4.6l3.4-.5z"
      fill="currentColor"
      stroke="none"
      transform="scale(1.333)"
    />
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  temperature: (
    <>
      <path d="M6.5 9.3V3.5a1.5 1.5 0 0 1 3 0v5.8a3 3 0 1 1-3 0z" />
      <path d="M8 7v4" />
    </>
  ),
  wind: (
    <>
      <path d="M2 6h8.5a2 2 0 1 0-2-2" />
      <path d="M2 9.5h11a2 2 0 1 1-2 2" />
    </>
  ),
  dry: (
    <>
      <path d="M8 2.2C8 2.2 4 6.6 4 9.6a4 4 0 0 0 8 0C12 6.6 8 2.2 8 2.2z" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  wet: (
    <>
      <path d="M4.5 9.5a3 3 0 0 1 .4-6 4 4 0 0 1 7.4 1.2A2.5 2.5 0 0 1 12 9.5z" />
      <path d="M5.5 11.5l-.7 2M8.5 11.5l-.7 2M11.5 11.5l-.7 2" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
    </>
  ),
  // Sun behind a cloud: any mix of sun and sunny intervals (handoff v4).
  sunCloud: (
    <>
      <path d="M4.2 7.4A2.3 2.3 0 1 1 8 5" />
      <path d="M5.8 1.4v1M1.6 5.6h1M2.8 2.6l.7.7M8.8 2.6l-.7.7" />
      <path d="M6.6 13.8h5.3a2.2 2.2 0 0 0 .2-4.4 3.1 3.1 0 0 0-5.9.9 1.8 1.8 0 0 0 .4 3.5z" />
    </>
  ),
  // The design's 12-unit chevron, scaled to 16.
  chevron: <path d="M3 4.5l3 3 3-3" transform="scale(1.333)" />,
  arrow: (
    <>
      <path d="M2 8h10" />
      <path d="M9 4.5L12.5 8 9 11.5" />
    </>
  ),
  // The wet cloud, without its rain, dropped to the middle.
  cloud: (
    <path d="M4.5 12a3 3 0 0 1 .4-6 4 4 0 0 1 7.4 1.2A2.5 2.5 0 0 1 12 12z" />
  ),
  fog: <path d="M3 5h10M2 8h12M4 11h8" />,
};
const Icon = (props: {
  name: keyof typeof ICONS;
  size: number;
  weight?: number;
  class?: string;
}) => (
  <svg
    class={props.class}
    width={props.size}
    height={props.size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width={props.weight ?? 1.5}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {ICONS[props.name]}
  </svg>
);

const tint = (card: Card) =>
  card.flag === 'Best pick'
    ? 'ro-flag-best'
    : card.flag
      ? 'ro-flag-available'
      : '';

// The flag, its opposite under 50, then any state but meeting the preferences (the score says that).
const Pills = ({ card, star }: { card: Card; star?: boolean }) => (
  <>
    {card.flag && (
      <span class="ro-pill ro-flag">
        {star && card.flag === 'Best pick' && <Icon name="star" size={11} />}
        {card.flag}
      </span>
    )}
    {card.score !== null && card.score < 50 && (
      <span class="ro-pill ro-not-recommended">Not recommended</span>
    )}
    {card.state !== 'meets' && (
      <span class={`ro-pill ro-${card.state}`}>{STATES[card.state]}</span>
    )}
  </>
);

const Notes = ({ card }: { card: Card }) => (
  <>
    {card.drawbacks.map((drawback) => (
      <span key={drawback} class="ro-drawback">
        {drawback}
      </span>
    ))}
    {card.trade.length > 0 && (
      <div class="ro-trades">
        {card.trade.map((trade) => (
          <span key={trade}>{trade}</span>
        ))}
      </div>
    )}
    {card.coverage && <span class="ro-coverage">{card.coverage}</span>}
  </>
);

// Alerts on one tracked ride, and Edit mode for removing rides (handoff v5). Each list has its own
// Edit mode and Undo message; which rides are tracked, and which has alerts, is shared state.
type Said = { text: string; undo?: () => void; at: number };
export type Tracking = ReturnType<typeof useTracking>;

export const useTracking = (view: View | null) => {
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false); // the pointer or focus is on the message
  const routeIds = view?.state.selection?.routeIds ?? [];
  const wanted = view?.state.alertRouteId ?? null;
  const alert = wanted && routeIds.includes(wanted) ? wanted : null;
  // Six seconds, held while the rider is on it; a new message starts the count again.
  useEffect(() => {
    if (!said || held) return;
    const timer = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(timer);
  }, [said, held]);
  const say = (text: string, undo?: () => void) => {
    setSaid({ text, undo, at: Date.now() });
    setShown(true);
  };
  const failed = (result: { error?: string }) =>
    result.error && say(result.error);
  const name = (id: string) =>
    view?.cards.find((c) => c.routeId === id)?.name ??
    view?.state.routes[id]?.name ??
    'your ride';
  return {
    editing,
    setEditing,
    alert,
    said,
    shown,
    setHeld,
    undo: () => {
      setShown(false);
      said?.undo?.();
    },
    // One ride at a time: turning on another moves the alerts.
    bell: (card: Card) => {
      const on = alert !== card.routeId;
      send({ type: 'setAlert', routeId: on ? card.routeId : null });
      say(
        !on
          ? `Alerts off for ${card.name}`
          : alert
            ? `Alerts moved from ${name(alert)} to ${card.name}`
            : `Alerts on for ${card.name}`,
        () => send({ type: 'setAlert', routeId: alert }),
      );
    },
    remove: (card: Card) => {
      const had = alert === card.routeId;
      const index = routeIds.indexOf(card.routeId);
      // The last ride gone, the list shows its empty state instead.
      if (routeIds.length <= 1) setEditing(false);
      say(
        had
          ? `Stopped tracking ${card.name}. Alerts off.`
          : `Stopped tracking ${card.name}`,
        () =>
          send({
            type: 'track',
            routeId: card.routeId,
            index,
            alert: had,
          }).then(failed),
      );
      send({ type: 'untrack', routeId: card.routeId }).then(failed);
    },
  };
};

// Edit / Done for a list of tracked rides (20c).
export const EditButton = ({ tracking }: { tracking: Tracking }) => (
  <button
    type="button"
    class="ro-edit"
    data-editing={tracking.editing}
    onClick={() => tracking.setEditing(!tracking.editing)}
  >
    {tracking.editing ? 'Done' : 'Edit'}
  </button>
);

// The Undo message (§4), under the list. The dock sticks to the bottom of the view while the list
// runs past it, so a removal near the top still shows its Undo.
export const Toast = ({ tracking }: { tracking: Tracking }) => {
  const { said, shown, setHeld } = tracking;
  return (
    <div class="ro-toast-dock">
      <div
        class="ro-toast"
        role="status"
        aria-live="polite"
        data-show={shown}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
      >
        {said && <span key={said.at}>{said.text}</span>}
        {said?.undo && (
          <button
            type="button"
            tabIndex={shown ? 0 : -1}
            aria-hidden={!shown || undefined}
            onClick={tracking.undo}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
};

// The handoff's bell (§1): outlined off, filled on.
const BellIcon = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 16 16"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M8 1.6v1.1" />
    <path
      class="ro-bell-body"
      d="M3.6 11.4V7.6a4.4 4.4 0 0 1 8.8 0v3.8l1.1 1.4H2.5z"
    />
    <path d="M6.4 14.3a1.7 1.7 0 0 0 3.2 0" fill="none" />
  </svg>
);

// A tile's one corner action: its bell, or in Edit mode an × that removes it (21a).
const TileAction = (props: {
  card: Card;
  tracking: Tracking;
  disabled: boolean; // no bell for dates that have passed, until new ones are scored
}) => {
  const { card, tracking } = props;
  const snap = useContext(Leaving);
  if (tracking.editing)
    return (
      <button
        type="button"
        class="ro-remove"
        title="Stop tracking"
        aria-label={`Stop tracking ${card.name}`}
        onClick={(event) => {
          // Focus moves on to the next ×, as the tile it was on goes.
          const all = [
            ...(event.currentTarget
              .closest('[data-route]')
              ?.parentElement?.querySelectorAll<HTMLElement>('.ro-remove') ??
              []),
          ];
          const i = all.indexOf(event.currentTarget);
          (all[i + 1] ?? all[i - 1])?.focus();
          snap();
          tracking.remove(card);
        }}
      >
        ×
      </button>
    );
  const on = tracking.alert === card.routeId;
  return (
    <button
      type="button"
      class="ro-bell"
      aria-pressed={on}
      aria-label={
        on
          ? `Alerts on for ${card.name}. Turn off alerts`
          : `Get alerts for ${card.name}`
      }
      title={on ? 'Alerts on. Click to turn off' : 'Get alerts for this ride'}
      disabled={props.disabled}
      onClick={() => tracking.bell(card)}
    >
      <BellIcon />
    </button>
  );
};

// Counts from the old score to the new one: 800ms, ease-in-out cubic.
const useCount = (to: number | null) => {
  const [value, setValue] = useState(to);
  const shown = useRef(value);
  shown.current = value;
  useEffect(() => {
    const from = shown.current;
    if (
      from === null ||
      to === null ||
      from === to ||
      reducedMotion() ||
      document.hidden
    ) {
      setValue(to);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / 800);
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return value;
};

// How far a score moved since the rider last looked (15a). It stays until newer scores replace it
// or the popup closes: a timer could hide it before it's read (WCAG 2.2.1).
export type Change = { by: number; at: number };

// The scores last on screen, so a return to the Rides tab, or a reopened popup (`remember`), badges what
// changed meanwhile. ±1 is forecast noise: no badge.
type Seen = {
  window: string;
  cards: Pick<Card, 'routeId' | 'score'>[];
  changes: Record<string, Change>;
};
let seen: Seen | undefined;
const recall = (): Seen | undefined => {
  try {
    // A closed popup's badges were seen.
    return {
      ...JSON.parse(localStorage.getItem('ro-seen') ?? ''),
      changes: {},
    };
  } catch {
    return undefined;
  }
};

const Meter = (props: {
  score: number | null;
  blank: boolean;
  change?: Change;
}) => {
  const shown = useCount(props.score);
  const { change } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the design's label row and bar; a native <meter> can't hold or style them.
    <div
      class="ro-meter"
      role="meter"
      aria-label="Conditions score"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.score ?? 0}
      aria-hidden={props.blank || undefined}
    >
      <span>
        <span>Conditions</span>
        {change && (
          <span key={change.at} class="ro-delta" data-down={change.by < 0}>
            {change.by < 0 ? `▼ ${-change.by}` : `▲ ${change.by}`}
          </span>
        )}
        <span>
          <strong>{shown ?? '–'}</strong>/100
        </span>
      </span>
      <div>
        <div style={{ width: `${props.blank ? 0 : (props.score ?? 0)}%` }} />
      </div>
    </div>
  );
};

// A ride: name, distance and time, chips, then the score. On the Journeys page (14a) flags sit on the
// top border so every tile has the same layout, and a blank tile keeps a scored tile's size with
// placeholders until scores arrive. On the Rides tab (15a) a medal marks the top three instead.
export const RouteTile = (props: {
  view: View;
  card: Card;
  href: string | null; // the page links each ride to its journey
  blank: boolean;
  index: number; // staggers the fade-in
  medal?: number | null; // the Rides tab: its place among the scored rides
  change?: Change;
  tracking: Tracking;
}) => {
  const { card, blank, view, medal, tracking } = props;
  const panel = medal !== undefined;
  const rank = medal ?? 3;
  // The Rides tab's heading has the date, unless the window spans days.
  const dated = !panel || (view.range?.length ?? 0) > 1;
  const notRecommended = card.score !== null && card.score < 50;
  // One dropdown open at a time across the grid; Ranked shares it, a lone tile keeps its own.
  const own = useState<string | null>(null);
  const [open, setOpen] = useContext(OpenPanel) ?? own;
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const sky =
    card.best &&
    skyChip(card.best, view.state.user?.preferenceLevels?.sunshine);
  const chips = card.best
    ? conditionChips(
        card.best.conditions,
        view.state.units,
        view.state.user?.settings.preferences,
        view.state.user?.preferenceLevels,
      )
    : [];
  const skyId = `ro-sky-${card.routeId}`;
  const windId = `ro-wind-${card.routeId}`;
  return (
    <div
      class={`ro-ride ${panel ? (rank < 3 ? `ro-${MEDALS[rank].toLowerCase()}` : '') : tint(card)}${tracking.alert === card.routeId ? ' ro-alert' : ''}`}
      data-state={card.state}
      data-route={card.routeId}
      data-blank={blank}
      style={{ '--ro-i': props.index }}
    >
      {!panel && (
        <div class="ro-flags">
          <Pills card={card} star />
        </div>
      )}
      <div class="ro-ride-head">
        {panel && (
          <span
            class="ro-medal"
            data-on={rank < 3}
            title={rank < 3 ? `Rank ${rank + 1}` : undefined}
            aria-hidden={rank >= 3 || undefined}
          >
            {rank < 3 && rank + 1}
          </span>
        )}
        <div class="ro-ride-title">
          {props.href ? (
            <a class="ro-name" href={props.href}>
              {card.name}
            </a>
          ) : (
            <span class="ro-name">{card.name}</span>
          )}
          <Tags view={view} routeId={card.routeId} />
          {card.recent && (
            <span class="ro-tag ro-tag-last">
              Similar roads recently ridden
            </span>
          )}
        </div>
        <TileAction card={card} tracking={tracking} disabled={blank} />
      </div>
      {panel && (notRecommended || card.state !== 'meets') && (
        <div class="ro-pills">
          <Pills card={{ ...card, flag: null }} />
        </div>
      )}
      <div class="ro-facts">
        <span>
          <Icon name="route" size={15} />
          {card.km} km
        </span>
        <Slot class="ro-when">
          {card.best ? (
            <span>
              <Icon name="clock" size={15} />
              {dated && (
                <>
                  {shortDate(card.best.date)}
                  <b aria-hidden="true">·</b>
                </>
              )}
              {`${clock(card.best.departureAt, view.timeZone)} → ~${clock(card.best.finishAt, view.timeZone)}`}
            </span>
          ) : (
            card.duration && (
              <span>
                <Icon name="clock" size={15} />
                {card.duration}
              </span>
            )
          )}
        </Slot>
      </div>
      <div class="ro-rule" />
      <Slot class="ro-conditions">
        {card.best ? (
          <ul class="ro-chips">
            {/* Temperature, sky, wind, rain (handoff v4); sky and wind open their dropdowns. */}
            {[chips[0], ...(sky ? [sky] : []), ...chips.slice(1)].map((chip) =>
              // Keyed by text: a changed chip fades in afresh.
              chip === sky && sky.segments ? (
                <li key={chip.text} class="ro-sky-chip">
                  <button
                    type="button"
                    aria-expanded={open === skyId}
                    aria-controls={skyId}
                    aria-label={`${sky.label}. Show expected conditions`}
                    data-partial={sky.partial}
                    onClick={() => toggle(skyId)}
                  >
                    <Icon name={chip.icon} size={16} />
                    {chip.text}
                    <Icon
                      name="chevron"
                      size={12}
                      weight={1.6}
                      class="ro-chevron"
                    />
                  </button>
                </li>
              ) : chip === chips[1] ? (
                <li key={chip.text} class="ro-wind-chip">
                  <button
                    type="button"
                    aria-expanded={open === windId}
                    aria-controls={windId}
                    aria-label={`${chip.label}${chip.warn ? ', costs points' : ''}. Show wind along the ride`}
                    data-warn={chip.warn}
                    onClick={() => toggle(windId)}
                  >
                    <Icon name={chip.icon} size={16} />
                    {chip.text}
                    <Icon
                      name="chevron"
                      size={12}
                      weight={1.6}
                      class="ro-chevron"
                    />
                  </button>
                </li>
              ) : (
                <li
                  key={chip.text}
                  aria-label={chip.label}
                  data-warn={chip.warn}
                >
                  <Icon name={chip.icon} size={16} />
                  {chip.text}
                </li>
              ),
            )}
          </ul>
        ) : (
          <span>{card.reason}</span>
        )}
      </Slot>
      {open === skyId && card.best && sky?.segments && sky.legend && (
        <div class="ro-sky" id={skyId}>
          <b>Expected conditions along the ride</b>
          <div class="ro-sky-bar" aria-hidden="true">
            {sky.segments.map((g, i) => (
              <span key={i} data-sky={g.kind} style={{ flex: g.share }} />
            ))}
          </div>
          <div class="ro-ends" aria-hidden="true">
            <span>{clock(card.best.departureAt, view.timeZone)}</span>
            <span>~{clock(card.best.finishAt, view.timeZone)}</span>
          </div>
          <ul>
            {sky.legend.map((l) => (
              <li key={l.kind}>
                <i data-sky={l.kind} />
                <span>{l.name}</span>
                <span>{l.share}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open === windId && card.best && (
        <WindPanel
          id={windId}
          best={card.best}
          outline={card.outline}
          view={view}
        />
      )}
      {!blank && <Notes card={card} />}
      {blank || card.score !== null ? (
        <Meter score={card.score} blank={blank} change={props.change} />
      ) : (
        card.state === 'incomplete' && <span class="ro-no-score">No score</span>
      )}
    </div>
  );
};

// "Wind along the ride" (wind board 7): the route sketch when the API sends one, then the bar, the
// legend and the gusts.
const WindPanel = (props: {
  id: string;
  best: Departure;
  outline: Outline | null;
  view: View;
}) => {
  const { best, view } = props;
  const wind = windPanel(
    best,
    props.outline,
    view.timeZone,
    view.state.units,
    view.state.user?.settings.preferences,
  );
  // Hovering (or touching) the bar puts a pointer on the route at that share of the distance.
  const [along, setAlong] = useState<number | null>(null);
  const point = (e: PointerEvent) => {
    const bar = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAlong(Math.min(1, Math.max(0, (e.clientX - bar.left) / bar.width)));
  };
  const leave = () => setAlong(null);
  return (
    <div class="ro-wind" id={props.id}>
      <b>Wind along the ride</b>
      {wind.sketch && <Sketch sketch={wind.sketch} along={along} />}
      <div
        class="ro-wind-bar"
        aria-hidden="true"
        data-points={!!wind.sketch}
        onPointerMove={wind.sketch ? point : undefined}
        onPointerDown={wind.sketch ? point : undefined}
        onPointerLeave={leave}
        onPointerCancel={leave}
      >
        {wind.blocks.map((g, i) => (
          <span
            key={i}
            data-wind={g.effect}
            // A 2px gap only between blocks wide enough to keep it: the API can send up to
            // 1,000 stretches, and gaps between slivers would crowd out their colours.
            data-apart={
              i > 0 && g.share >= 0.02 && wind.blocks[i - 1].share >= 0.02
            }
            style={{ flex: g.share }}
          >
            {g.label}
          </span>
        ))}
      </div>
      <div class="ro-ends" aria-hidden="true">
        <span>{clock(best.departureAt, view.timeZone)}</span>
        <span>~{clock(best.finishAt, view.timeZone)}</span>
      </div>
      <ul>
        {wind.legend.map((l) => (
          <li key={l.effect}>
            <i data-wind={l.effect} />
            <span>{l.name}</span>
            <span>{l.speed}</span>
            <span>{l.share}</span>
          </li>
        ))}
      </ul>
      {wind.gusts && (
        <div class="ro-gusts" data-warn={wind.gusts.warn}>
          <Icon name="wind" size={14} weight={1.6} />
          <div>
            <b>{wind.gusts.title}</b>
            <span>{wind.gusts.text}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// North up, no basemap (board 13): a grey ribbon coloured where the wind helps or hinders, and a
// compass left of it where the wind blows. Hovering the wind bar shows where and which way you ride.
const HEADING = 'M4.3 0L-3 -3L-1 0L-3 3Z';
const CARDINALS = ['N', 'E', 'S', 'W'];
// A compass needle drawn pointing north, then turned to where the wind blows: a red tip and a white
// tail, each with a lit and a shaded side, on a pivot.
const NEEDLE = { length: 12, width: 3.2 };
const NEEDLE_SIDES = (['tip', 'tail'] as const).flatMap((half) =>
  ([-1, 1] as const).map((side) => ({
    half,
    side,
    d: `M0 ${half === 'tip' ? -NEEDLE.length : NEEDLE.length}L${side * NEEDLE.width} 0H0Z`,
  })),
);
// The key's height under the compass: the gap, each line of words, then the speed and its descenders.
const keyHeight = (lines: number) => 2 * DIAL.r + 18.5 + lines * 11;
// A tick every 15°, with the letters in place of the four at N, E, S and W.
const TICKS = Array.from({ length: 24 }, (_, i) => i * 15)
  .filter((deg) => deg % 90)
  .map((deg) => {
    const [sin, cos] = [
      Math.sin((deg * Math.PI) / 180),
      -Math.cos((deg * Math.PI) / 180),
    ];
    const [outer, inner] = [DIAL.r - 1.4, DIAL.r - (deg % 45 ? 3.4 : 4.6)];
    const f = (n: number) => Math.round(n * 10) / 10;
    return `M${f(DIAL.x + sin * outer)} ${f(DIAL.y + cos * outer)}L${f(DIAL.x + sin * inner)} ${f(DIAL.y + cos * inner)}`;
  })
  .join('');
const Sketch = (props: { sketch: WindSketch; along: number | null }) => {
  const { sketch, along } = props;
  const { start, finish, wind } = sketch;
  const { x, y, r } = DIAL;
  const at =
    along === null
      ? null
      : sketch.track[Math.round(along * (sketch.track.length - 1))];
  const lines = y + r + 15;
  // The compass and its words sit in the middle of the box, however many lines there are.
  const centre =
    Math.round(
      ((SKETCH.height - keyHeight(wind.lines.length)) / 2 - (y - r)) * 10,
    ) / 10;
  return (
    <>
      <div class="ro-wind-map">
        <svg
          width="100%"
          viewBox={`0 0 ${SKETCH.width} ${SKETCH.height}`}
          aria-hidden="true"
        >
          <polyline class="ro-wind-halo" points={sketch.casing} />
          <polyline class="ro-wind-base" points={sketch.casing} />
          {sketch.runs.map((run, i) => (
            <polyline key={i} data-wind={run.effect} points={run.points} />
          ))}
          {finish && (
            <circle
              class="ro-wind-finish"
              cx={finish.x}
              cy={finish.y}
              r={3.6}
            />
          )}
          <circle class="ro-wind-start" cx={start.x} cy={start.y} r={3.6} />
          {[start.label, ...(finish ? [finish.label] : [])].map((l) => (
            <text key={l.text} x={l.x} y={l.y} text-anchor={l.anchor}>
              {l.text}
            </text>
          ))}
          {at && (
            <g
              class="ro-wind-pointer"
              transform={`translate(${at.x} ${at.y}) rotate(${at.angle})`}
            >
              <circle r={6.5} />
              <path d={HEADING} />
            </g>
          )}
          <g class="ro-wind-key" transform={`translate(0 ${centre})`}>
            <circle class="ro-wind-dial" cx={x} cy={y} r={r} />
            <path class="ro-wind-ticks" d={TICKS} />
            {CARDINALS.map((c, i) => {
              const deg = (i * Math.PI) / 2;
              return (
                <text
                  key={c}
                  class="ro-wind-cardinal"
                  data-north={c === 'N'}
                  x={x + Math.sin(deg) * (r - 4.2)}
                  y={y - Math.cos(deg) * (r - 4.2) + 2.3}
                  text-anchor="middle"
                >
                  {c}
                </text>
              );
            })}
            {wind.needle !== null ? (
              <g
                class="ro-wind-needle"
                transform={`translate(${x} ${y}) rotate(${wind.needle})`}
              >
                {NEEDLE_SIDES.map((n) => (
                  <path
                    key={`${n.half}${n.side}`}
                    d={n.d}
                    data-half={n.half}
                    data-shaded={n.side > 0}
                  />
                ))}
                <circle r={1.7} />
              </g>
            ) : (
              <circle class="ro-wind-calm" cx={x} cy={y} r={2.2} />
            )}
            {wind.lines.map((line, i) => (
              <text
                key={line}
                class="ro-wind-from"
                x={x}
                y={lines + i * 11}
                text-anchor="middle"
              >
                {line}
              </text>
            ))}
            <text
              class="ro-wind-speed"
              x={x}
              y={lines + wind.lines.length * 11 + 1}
              text-anchor="middle"
            >
              {wind.speed}
            </text>
          </g>
        </svg>
      </div>
      <p class="ro-sr">{sketch.sentence}</p>
    </>
  );
};

// A forecast update (15a): scores, bars and chips change in place, then 700ms later the cards slide to
// their new order (FLIP). The new DOM order is committed, so tab order and screen readers follow the screen.
// Without motion (reduced, or a hidden tab) it all changes at once.
export const Ranked = (props: {
  cards: Card[];
  window: string; // change badges compare forecasts for the same window only
  class: string;
  remember?: boolean; // keep what was seen across popup reopenings
  render: (
    card: Card,
    index: number,
    medal: number | null,
    change?: Change,
  ) => ComponentChildren;
}) => {
  const { cards } = props;
  const list = useRef<HTMLDivElement>(null);
  const [prior] = useState(() => {
    seen ??= props.remember ? recall() : undefined;
    return seen?.window === props.window ? seen : undefined;
  });
  // First paint shows the old order and scores, so returning animates the change like a refresh.
  const [order, setOrder] = useState(() => {
    const ids = cards.map((c) => c.routeId);
    const was = prior?.cards.map((c) => c.routeId) ?? [];
    return was.length === ids.length && ids.every((id) => was.includes(id))
      ? was
      : ids;
  });
  const [settled, setSettled] = useState(!prior);
  const [changes, setChanges] = useState(prior?.changes ?? {});
  const [said, setSaid] = useState('');
  const open = useState<string | null>(null);
  const last = useRef<Omit<Seen, 'changes'>>(
    prior ?? { window: props.window, cards },
  );
  const before = useRef(new Map<string, DOMRect>());
  const tiles = () =>
    list.current?.querySelectorAll<HTMLElement>(':scope > [data-route]') ?? [];
  // Where each tile sat in the list just before one was removed.
  const left = useRef<Map<string, DOMRect> | null>(null);
  const places = () => {
    const base = list.current?.getBoundingClientRect();
    return new Map(
      [...tiles()].map((tile) => {
        const r = tile.getBoundingClientRect();
        return [
          tile.dataset.route ?? '',
          new DOMRect(r.left - (base?.left ?? 0), r.top - (base?.top ?? 0)),
        ];
      }),
    );
  };

  useEffect(() => {
    const was = last.current;
    last.current = { window: props.window, cards };
    setSettled(true);
    const ids = cards.map((c) => c.routeId);
    // A route tracked or dropped: no motion.
    if (ids.length !== order.length || ids.some((id) => !order.includes(id))) {
      setOrder(ids);
      return;
    }
    const still = reducedMotion() || document.hidden;
    const moved = ids.some((id, i) => id !== order[i]);
    const old = new Map(was.cards.map((c) => [c.routeId, c.score]));
    const at = Date.now();
    const changed = Object.fromEntries(
      cards.flatMap((c) => {
        const from = old.get(c.routeId);
        return from != null && c.score !== null && Math.abs(c.score - from) > 1
          ? [[c.routeId, { by: c.score - from, at }]]
          : [];
      }),
    );
    const any = Object.keys(changed).length > 0;
    // New dates or times aren't a forecast change; a refresh that changed nothing keeps the badges.
    const next = was.window !== props.window ? {} : any ? changed : changes;
    setChanges(next);
    const scores = cards.map(({ routeId, score }) => ({ routeId, score }));
    seen = { window: props.window, cards: scores, changes: next };
    if (props.remember)
      try {
        localStorage.setItem(
          'ro-seen',
          JSON.stringify({ window: props.window, cards: scores }),
        );
      } catch {}
    if (still && (moved || any) && !document.hidden)
      list.current?.animate([{ opacity: 0.4 }, { opacity: 1 }], 150);
    const timers = moved
      ? [
          setTimeout(
            () => {
              if (!still)
                for (const tile of tiles())
                  before.current.set(
                    tile.dataset.route ?? '',
                    tile.getBoundingClientRect(),
                  );
              setOrder(ids);
            },
            still ? 0 : 700,
          ),
          setTimeout(
            () => {
              const [top, ...rest] = cards.map((c) => c.name);
              setSaid(
                `Forecast updated. ${top} is now top${rest.length ? `, then ${new Intl.ListFormat('en-GB').format(rest)}` : ''}.`,
              );
            },
            still ? 0 : 1350,
          ),
        ]
      : [];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [cards.map((c) => `${c.routeId}:${c.score}`).join()]);

  // FLIP: each card slides from where it was; those moving up pass over the rest.
  useLayoutEffect(() => {
    const from = before.current;
    if (!from.size) return;
    before.current = new Map();
    const old = [...from.keys()];
    tiles().forEach((tile, i) => {
      const id = tile.dataset.route ?? '';
      const was = from.get(id);
      if (!was) return;
      const now = tile.getBoundingClientRect();
      const [dx, dy] = [was.left - now.left, was.top - now.top];
      if (!dx && !dy) return;
      tile.style.zIndex = i < old.indexOf(id) ? '2' : '1';
      tile.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 650, easing: 'cubic-bezier(.65,0,.25,1)' },
      ).onfinish = () => {
        tile.style.zIndex = '';
      };
    });
  }, [order]);

  const byId = new Map(cards.map((c) => [c.routeId, c]));
  const old = new Map(prior?.cards.map((c) => [c.routeId, c.score]));
  const shown = [
    ...order.filter((id) => byId.has(id)),
    ...cards.map((c) => c.routeId).filter((id) => !order.includes(id)),
  ];
  // A removal (21a): the rest slide into the gap, 450ms, or move at once with reduced motion.
  useLayoutEffect(() => {
    const from = left.current;
    left.current = null;
    if (!from || [...from.keys()].every((id) => shown.includes(id))) return;
    const now = places();
    for (const tile of tiles()) {
      const [was, is] = [
        from.get(tile.dataset.route ?? ''),
        now.get(tile.dataset.route ?? ''),
      ];
      if (!was || !is || (was.x === is.x && was.y === is.y)) continue;
      tile.animate(
        [
          { transform: `translate(${was.x - is.x}px, ${was.y - is.y}px)` },
          { transform: 'none' },
        ],
        { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }, [shown.join()]);

  let scored = 0;
  return (
    <OpenPanel.Provider value={open}>
      <Leaving.Provider
        value={() => {
          if (!reducedMotion()) left.current = places();
        }}
      >
        <div ref={list} class={props.class}>
          {shown.map((id, i) => {
            const now = byId.get(id) as Card;
            const card = settled
              ? now
              : { ...now, score: old.get(id) ?? now.score };
            return props.render(
              card,
              i,
              card.score !== null ? scored++ : null,
              changes[id],
            );
          })}
          <span class="ro-sr" aria-live="polite">
            {said}
          </span>
        </div>
      </Leaving.Provider>
    </OpenPanel.Provider>
  );
};

const BANNERS: Record<Exclude<Banner, 'provider'>, string> = {
  nomatch:
    'Each of these rides goes past one of your limits. Here are the best available options.',
  incomplete:
    "We couldn't confirm a ride within your limits because some forecasts are unavailable.",
  distance:
    'None of your selected rides is within your preferred distance range. These are the best options at other distances.',
};

// The chosen provider returned nothing for these days: name it and offer the fix.
export const ProviderDown = (props: { view: View; onChange: () => void }) => (
  <>
    {props.view.provider} has no forecast for these days.{' '}
    <button type="button" class="ro-link" onClick={props.onChange}>
      Change forecast provider
    </button>
  </>
);

export const Banners = (props: { view: View; onProvider: () => void }) =>
  props.view.banners.map((banner) => (
    <div key={banner} class={`ro-banner ro-${banner}`} role="status">
      {banner === 'provider' ? (
        <ProviderDown view={props.view} onChange={props.onProvider} />
      ) : (
        BANNERS[banner]
      )}
    </div>
  ));

export const CoverageWarn = ({ view }: { view: View }) =>
  view.range && view.coverageWarn ? (
    <span class="ro-coverage ro-warn-below">
      Some forecasts don't cover your whole window.
    </span>
  ) : null;

// A suggested window: its day, at its times.
export const chooseWindow = (view: View, w: NextWindow) =>
  send({
    type: 'setPlanning',
    planning: {
      days: { kind: 'range', start: w.date, end: w.date },
      time:
        w.window === 'daylight'
          ? { ...view.state.planning.time, mode: 'daylight' }
          : { mode: 'custom', ...w.window },
    },
  });

// Never silently swap a passed search for new dates; the When tab moves them on where the rider can see it.
export const Expired = (props: { view: View; onChoose: () => void }) => (
  <div class="ro-expired" role="alert">
    <div>
      <span>These dates have passed</span>
      <span>{props.view.datesText}</span>
    </div>
    <button type="button" class="ro-primary" onClick={props.onChoose}>
      Choose available dates
    </button>
  </div>
);

// Keep the last results on screen and say how old they are.
export const ErrorChip = ({ view }: { view: View }) =>
  view.state.error ? (
    <span class="ro-warn-chip" role="status" title={view.state.error}>
      Forecast unavailable
      {view.state.recsAt &&
        ` — showing results from ${clock(view.state.recsAt, view.timeZone)}`}
    </span>
  ) : null;

export const GoogleMark = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export const AppleMark = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#fff"
      d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
    />
  </svg>
);
