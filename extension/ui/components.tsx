// Pieces shared by the popup and the Journeys page.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { onStateChange, readState, type State, send } from '../lib/state';
import type { NextWindow } from '../lib/types';
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
  viewOf,
} from './format';

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

export const useView = (): View | null => {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const stop = onStateChange(setState);
    readState().then((read) => setState((current) => current ?? read));
    return stop;
  }, []);
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

// A page tile's line, over a static placeholder bar in the same grid cell.
const Slot = (props: { class: string; children: ComponentChildren }) => (
  <div class={`ro-slot ${props.class}`}>
    {props.children}
    <i aria-hidden="true" />
  </div>
);

// 16-unit stroke icons from the design (11b).
const ICONS: Record<
  Chip['icon'] | 'clock' | 'route' | 'star',
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
      <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </>
  ),
  // The wet cloud, without its rain, dropped to the middle.
  cloud: (
    <path d="M4.5 12a3 3 0 0 1 .4-6 4 4 0 0 1 7.4 1.2A2.5 2.5 0 0 1 12 12z" />
  ),
  fog: <path d="M3 5h10M2 8h12M4 11h8" />,
};
const Icon = (props: { name: keyof typeof ICONS; size: number }) => (
  <svg
    width={props.size}
    height={props.size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
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

const untrack = (card: Card) => (
  <CloseButton
    title={`Stop tracking ${card.name}`}
    onClick={() => send({ type: 'untrack', routeId: card.routeId })}
  />
);

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
}) => {
  const { card, blank, view, medal } = props;
  const panel = medal !== undefined;
  const rank = medal ?? 3;
  // The Rides tab's heading has the date, unless the window spans days.
  const dated = !panel || (view.range?.length ?? 0) > 1;
  const notRecommended = card.score !== null && card.score < 50;
  return (
    <div
      class={`ro-ride ${panel ? (rank < 3 ? `ro-${MEDALS[rank].toLowerCase()}` : '') : tint(card)}`}
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
        {untrack(card)}
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
            {conditionChips(
              card.best.conditions,
              view.state.user?.settings.preferences.temperature,
              view.state.units,
              view.state.user?.settings.preferences.wind,
            ).map((chip) => (
              // Keyed by text: a changed chip fades in afresh.
              <li key={chip.text} aria-label={chip.label} data-warn={chip.warn}>
                <Icon name={chip.icon} size={16} />
                {chip.text}
              </li>
            ))}
          </ul>
        ) : (
          <span>{card.reason}</span>
        )}
      </Slot>
      {!blank && <Notes card={card} />}
      {blank || card.score !== null ? (
        <Meter score={card.score} blank={blank} change={props.change} />
      ) : (
        card.state === 'incomplete' && <span class="ro-no-score">No score</span>
      )}
    </div>
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
  const last = useRef<Omit<Seen, 'changes'>>(
    prior ?? { window: props.window, cards },
  );
  const before = useRef(new Map<string, DOMRect>());
  const tiles = () =>
    list.current?.querySelectorAll<HTMLElement>(':scope > [data-route]') ?? [];

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
  let scored = 0;
  return (
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
