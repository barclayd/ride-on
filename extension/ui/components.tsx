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
import type {
  AlertTriggers,
  Departure,
  NextWindow,
  Outline,
  ScoreChange,
} from '../lib/types';
import {
  type Banner,
  type Card,
  type CardState,
  type Chip,
  clock,
  conditionChips,
  dayMonth,
  localDate,
  ridden,
  shortDate,
  skyChip,
  viewOf,
  weekday,
} from './format';
import { type Rain, rainPanel } from './rain';
import { type TemperaturePanel, temperaturePanel } from './temperature';
import {
  alertTimeline,
  asksPermission,
  SUMMARY_TIME,
  triggerRows,
} from './triggers';
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

// "Ride On is paused until Sun 18 Oct." and a link that turns it back on (handoff v6 §4).
export const PausedLine = ({ view }: { view: View }) => {
  const until = view.paused?.until;
  const [failed, setFailed] = useState(false);
  return (
    <div class="ro-paused">
      <span>Ride On is paused{until && ` until ${shortDate(until)}`}.</span>
      <button
        type="button"
        class="ro-link"
        onClick={() =>
          send({ type: 'resume' }).then((result) => setFailed(!!result.error))
        }
      >
        Turn back on
      </button>
      {failed && (
        <span class="ro-pause-error" role="alert">
          Couldn't turn it back on. Try again.
        </span>
      )}
    </div>
  );
};

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
// The open temperature, sky, wind or rain dropdown, by element id: opening one closes the rest.
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
  Chip['icon'] | 'clock' | 'route' | 'star' | 'chevron' | 'arrow' | 'drop',
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
  drop: <path d="M8 2.2C8 2.2 4 6.6 4 9.6a4 4 0 0 0 8 0C12 6.6 8 2.2 8 2.2z" />,
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
// The alerts dialog (v10, 29c), and the bell that opened it, which gets focus back. Change alerts
// (v11, 30c) opens it again for the ride that has them.
type Asking = { card: Card; from: HTMLElement | null; change?: boolean };
// What we're tracking (30c), and the pill or bell that opened it.
type Peek = { routeId: string; from: HTMLElement | null };
// The day and time a ride with alerts stays on (docs/extension-api-brief-v13.md).
export type FixedSlot = { departureAt: string; finishAt: string };

// Alerts on, against whatever has them now. With the time fixed, the tile shows the departure at once.
const startAlerts = async (
  routeId: string,
  recommendationRef: string,
  triggers?: AlertTriggers,
  departure?: Departure,
) => {
  const { tracker } = await readState();
  return send({
    type: 'setAlert',
    routeId,
    recommendationRef,
    triggers,
    departure,
    expectedTrackingVersion: tracker.version,
    replaceTrackedRideId: tracker.ride?.id ?? null,
  });
};
const stopAlerts = async (routeId: string) => {
  const { tracker } = await readState();
  if (tracker.ride?.routeId !== routeId) return {};
  return send({
    type: 'setAlert',
    routeId: null,
    expectedTrackingVersion: tracker.version,
    replaceTrackedRideId: tracker.ride.id,
  });
};

export const useTracking = (view: View | null) => {
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false); // the pointer or focus is on the message
  const [asking, setAsking] = useState<Asking | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [moving, setMoving] = useState(false);
  const routeIds = view?.state.selection?.routeIds ?? [];
  const wanted = view?.state.alertRouteId ?? null;
  const alert = wanted;
  const tracker = view?.state.tracker;
  // The ride alerts move from, when it's another ride.
  const active = tracker?.ride?.refresh.closed ? null : tracker?.ride;
  const movingFrom = (card: Card) =>
    active && active.routeId !== card.routeId
      ? (active.baseline.context.routes.find((r) => r.id === active.routeId)
          ?.name ??
        view?.state.routes[active.routeId]?.name ??
        'Your ride')
      : null;
  const close = () => {
    asking?.from?.focus();
    setAsking(null);
  };
  // Once the API keeps it (fixedDeparture), the ride with alerts stays on its day and time: the pinned
  // departure, or the marker's when the forecast can't score it.
  const slot = (card: Card): FixedSlot | null => {
    if (!tracker?.fixed || active?.routeId !== card.routeId) return null;
    if (card.best?.departureAt === active.departureAt) return card.best;
    if (card.fixed?.departureAt === active.departureAt) return card.fixed;
    return null;
  };
  // Closing puts focus back on the pill or bell, unless the rider has moved on.
  const unpeek = (focus = true) => {
    if (focus) peek?.from?.focus();
    setPeek(null);
  };
  // Focus goes on to the tile's pill, or its bell once alerts are off, as the button it was on goes.
  // The page or the Journeys page's shadow root: taken while the button is still on it.
  const rootOf = (at: Element | null | undefined) =>
    at?.getRootNode() as Document | ShadowRoot | undefined;
  const refocus = (
    root: Document | ShadowRoot | undefined,
    routeId: string,
    what: string,
  ) =>
    root
      ?.querySelector<HTMLElement>(`[data-route="${routeId}"] ${what}`)
      ?.focus();
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
  return {
    editing,
    setEditing,
    alert,
    departureAt: view?.state.tracker.ride?.departureAt ?? null,
    ready: view?.state.tracker.ready === true,
    said,
    shown,
    setHeld,
    undo: () => {
      setShown(false);
      said?.undo?.();
    },
    asking,
    movingFrom,
    close,
    slot,
    fixed: tracker?.fixed === true,
    edits: tracker?.edits === true,
    peeking: peek?.routeId ?? null,
    unpeek,
    moving,
    peekAt: (card: Card, from: HTMLElement | null) =>
      setPeek(
        peek?.routeId === card.routeId ? null : { routeId: card.routeId, from },
      ),
    // The selected recommendation pins the departure. An off bell asks which alerts first (29c);
    // an on bell turns them off straight away, or with the time fixed shows what we're tracking (30c).
    bell: async (card: Card, from: HTMLElement | null) => {
      if (slot(card))
        return setPeek(
          peek?.routeId === card.routeId
            ? null
            : { routeId: card.routeId, from },
        );
      if (!tracker?.ready || tracker.error)
        return say('Refresh to check your tracked ride first.');
      const ref = card.best?.recommendationRef;
      const on =
        alert !== card.routeId ||
        tracker.ride?.departureAt !== card.best?.departureAt;
      if (on) {
        if (!ref) return say('Refresh this ride before tracking it.');
        return setAsking({ card, from });
      }
      const result = await stopAlerts(card.routeId);
      if (result.error) return say(result.error);
      say(
        `Alerts off for ${card.name}`,
        ref
          ? () =>
              startAlerts(
                card.routeId,
                ref,
                view?.state.triggers[card.routeId],
              ).then(failed)
          : undefined,
      );
    },
    // Saves the switches and turns alerts on. The first time, the browser asks to notify first;
    // a page can't ask for the extension, so it opens the panel's Preferences after saving.
    confirm: async (triggers: AlertTriggers) => {
      const card = asking?.card;
      if (asking?.change && card) {
        close();
        const { tracker: now } = await readState();
        if (!now.ride) return;
        const result = await send({
          type: 'setTriggers',
          trackedRideId: now.ride.id,
          triggers,
          expectedTrackingVersion: now.version,
        });
        return say(result.error ?? `Alerts updated for ${card.name}`);
      }
      const ref = card?.best?.recommendationRef;
      if (!view || !card || !ref) return;
      const moving = movingFrom(card);
      const before = active;
      close();
      const { push, triggers: saved } = view.state;
      const ask = asksPermission(push);
      const panel = location.href.startsWith(browser.runtime.getURL('/'));
      const allowed =
        ask && panel && !import.meta.env.SAFARI
          ? await browser.permissions
              .request({ permissions: ['notifications'] })
              .catch(() => false)
          : null;
      const result = await startAlerts(card.routeId, ref, triggers);
      if (result.error) return say(result.error);
      // Undo puts back the ride that had alerts, while its departure is still on screen.
      const back = before
        ? view.cards.find(
            (c) =>
              c.routeId === before.routeId &&
              c.best?.departureAt === before.departureAt,
          )?.best?.recommendationRef
        : null;
      const undo = before
        ? back
          ? () =>
              startAlerts(before.routeId, back, saved[before.routeId]).then(
                failed,
              )
          : undefined
        : () => stopAlerts(card.routeId).then(failed);
      if (allowed === false || push.status === 'blocked')
        say('Notifications are blocked in your browser');
      else
        say(
          moving
            ? `Alerts moved from ${moving} to ${card.name}`
            : `Alerts on for ${card.name}`,
          undo,
        );
      if (!ask) return;
      if (!panel) return send({ type: 'openPopup', tab: 'prefs' });
      if (allowed === false) return;
      // Safari: the Ride On app opens and macOS asks.
      await send({ type: 'enablePush' });
    },
    // Change alerts: the 29c dialog again, with this ride's switches; saving keeps the slot.
    change: (card: Card) => {
      const from = peek?.from ?? null;
      setPeek(null);
      setAsking({ card, from, change: true });
    },
    // Turn off alerts: as an on bell does without a fixed time. The tile moves on the next refresh.
    turnOff: async (card: Card) => {
      const ref = card.best?.recommendationRef;
      const departure = card.best ?? undefined;
      const triggers = view?.state.triggers[card.routeId];
      refocus(rootOf(peek?.from), card.routeId, '.ro-bell');
      setPeek(null);
      const result = await stopAlerts(card.routeId);
      if (result.error) return say(result.error);
      say(
        `Alerts off for ${card.name}`,
        ref
          ? () =>
              startAlerts(card.routeId, ref, triggers, departure).then(failed)
          : undefined,
      );
    },
    // Move alerts (30c §4): a new plan on the better departure, with the same switches. Undo moves
    // them back while the old departure's reference is still good.
    move: async (card: Card, from: HTMLElement) => {
      const better = card.better;
      const ref = better?.recommendationRef;
      if (!view || !better || !ref || moving) return;
      const back = card.best;
      const backRef = back?.recommendationRef;
      const triggers = view.state.triggers[card.routeId];
      const root = rootOf(from);
      setMoving(true);
      const result = await startAlerts(
        card.routeId,
        ref,
        triggers,
        better,
      ).finally(() => setMoving(false));
      if (result.error) return say(result.error);
      refocus(root, card.routeId, '.ro-fixed');
      say(
        `Alerts moved to ${weekday(better.date)} ${clock(better.departureAt, view.timeZone)}`,
        back && backRef
          ? () =>
              startAlerts(card.routeId, backRef, triggers, back).then(failed)
          : undefined,
      );
    },
    remove: (card: Card) => {
      const index = routeIds.indexOf(card.routeId);
      // The last ride gone, the list shows its empty state instead.
      if (routeIds.length <= 1) setEditing(false);
      say(`Removed ${card.name} from your shortlist`, () =>
        send({
          type: 'track',
          routeId: card.routeId,
          index,
          alert: false,
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

// The Undo message (§4): in the window's bottom right corner on the Journeys page; in the panel,
// under the list, sticking to the bottom of the view so a removal near the top still shows its Undo.
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
export const BellIcon = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
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
        title="Remove from shortlist"
        aria-label={`Remove ${card.name} from shortlist`}
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
  // With the time fixed (30c) the bell shows what we're tracking instead of turning alerts off.
  if (!props.disabled && tracking.slot(card))
    return (
      <button
        type="button"
        class="ro-bell"
        data-fixed
        data-peek
        aria-haspopup="dialog"
        aria-expanded={tracking.peeking === card.routeId}
        aria-label={`Alerts on for ${card.name}. What we're tracking`}
        title="Alerts on. See what we're tracking"
        onClick={(event) => tracking.bell(card, event.currentTarget)}
      >
        <BellIcon />
      </button>
    );
  const on =
    tracking.alert === card.routeId &&
    tracking.departureAt === card.best?.departureAt;
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
      disabled={props.disabled || !tracking.ready}
      onClick={(event) => tracking.bell(card, event.currentTarget)}
    >
      <BellIcon />
    </button>
  );
};

// The fixed time on a ride with alerts (30c §1): a pill that opens what we're tracking, and under it a
// better departure when the API finds one (§4).
const FixedTime = (props: {
  view: View;
  card: Card;
  slot: FixedSlot;
  tracking: Tracking;
}) => {
  const { view, card, slot, tracking } = props;
  const open = tracking.peeking === card.routeId;
  const when = slotText(slot, view.timeZone);
  const better = card.better;
  return (
    <div class="ro-fixed-row">
      <div class="ro-fixed-anchor">
        <button
          type="button"
          class="ro-fixed"
          data-peek
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Alerts on for ${when.day}, ${when.dep} to ${when.fin}. What we're tracking for ${card.name}`}
          onClick={(event) => tracking.peekAt(card, event.currentTarget)}
        >
          <BellIcon size={15} />
          <span>{when.day}</span>
          <b aria-hidden="true">·</b>
          <span>{`${when.dep} → ~${when.fin}`}</span>
          <Icon name="chevron" size={12} />
        </button>
        {open && (
          <Tracked view={view} card={card} slot={slot} tracking={tracking} />
        )}
      </div>
      {better && (
        <div class="ro-better">
          <span>
            {`Better: ${shortDate(better.date)} · ${clock(better.departureAt, view.timeZone)} → ~${clock(better.finishAt, view.timeZone)} scores ${Math.round(better.score)}`}
          </span>
          <button
            type="button"
            aria-disabled={tracking.moving || undefined}
            onClick={(event) => tracking.move(card, event.currentTarget)}
          >
            Move alerts
          </button>
        </div>
      )}
    </div>
  );
};

const slotText = (slot: FixedSlot, timeZone: string) => ({
  day: shortDate(localDate(slot.departureAt, timeZone)),
  dep: clock(slot.departureAt, timeZone),
  fin: clock(slot.finishAt, timeZone),
});

// What we're tracking (30c §3): a popover under the pill, on a phone a card at the bottom. It closes on
// ×, Escape, a click outside or focus moving away, and focus goes back to what opened it.
const Tracked = (props: {
  view: View;
  card: Card;
  slot: FixedSlot;
  tracking: Tracking;
}) => {
  const { view, card, slot, tracking } = props;
  const { state, timeZone } = view;
  const box = useRef<HTMLDivElement>(null);
  const when = slotText(slot, timeZone);
  const triggers = state.triggers[card.routeId];
  const rows = triggerRows(
    state.user?.settings.preferences,
    state.units,
  ).filter((row) => triggers?.[row.key] !== false);
  const steps = alertTimeline(
    slot.departureAt,
    timeZone,
    new Date(),
    state.tracker.summaryTime ?? SUMMARY_TIME,
  );
  // Its pill and bell toggle it themselves.
  const ours = (node: EventTarget | null) =>
    node instanceof Element &&
    (box.current?.contains(node) ||
      node.closest(`[data-route="${card.routeId}"] [data-peek]`) !== null);
  useEffect(() => {
    box.current?.focus();
    const down = (event: PointerEvent) => {
      if (!event.composedPath().some(ours)) tracking.unpeek(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  return (
    <div
      ref={box}
      class="ro-tracked"
      role="dialog"
      aria-label={`Alerts for ${card.name}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        tracking.unpeek();
      }}
      onFocusOut={(event) => {
        if (event.relatedTarget && !ours(event.relatedTarget))
          tracking.unpeek(false);
      }}
    >
      <div class="ro-tracked-head">
        <div>
          <span>
            <BellIcon size={12} />
            Alerts on
          </span>
          <span>What we're tracking</span>
        </div>
        <button
          type="button"
          class="ro-tracked-close"
          aria-label="Close"
          onClick={() => tracking.unpeek()}
        >
          ×
        </button>
      </div>
      <div class="ro-tracked-slot">
        <span>{`${when.day} · ${when.dep} → ~${when.fin}`}</span>
        <span>
          This time is fixed while alerts are on. The tile won't move to another
          day or time.
        </span>
      </div>
      <div class="ro-tracked-part">
        <span>Tell me if</span>
        <ul>
          {rows.map((row) => (
            <li key={row.key}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke={row.colour}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d={row.path} />
              </svg>
              {row.label}
            </li>
          ))}
        </ul>
      </div>
      <div class="ro-tracked-part">
        <span>When you'll hear from us</span>
        <ol>
          {steps.map((step) => (
            <li key={step.text}>
              <i aria-hidden="true" style={{ background: step.dot }} />
              <span>
                <b>{step.at}</b>
                <span>{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div class="ro-tracked-actions">
        {tracking.edits && (
          <button
            type="button"
            class="ro-tracked-change"
            onClick={() => tracking.change(card)}
          >
            Change alerts
          </button>
        )}
        <button
          type="button"
          class="ro-tracked-off"
          onClick={() => tracking.turnOff(card)}
        >
          Turn off alerts
        </button>
      </div>
    </div>
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

// How far the score last moved for this plan (15a; docs/api.md, persistent score changes). The API
// keeps it until the score moves again, so refreshes and reopenings keep it too: a timer could hide it
// before it's read (WCAG 2.2.1). It fades in only when a new change arrives while the score is on screen.
const Meter = (props: {
  score: number | null;
  blank: boolean;
  change?: ScoreChange | null;
}) => {
  const shown = useCount(props.score);
  const change = props.blank ? null : props.change;
  const at = change?.changedAt ?? null;
  const badge = useRef<HTMLSpanElement>(null);
  const was = useRef<string | null>(); // the change on screen; undefined until there's a score
  useLayoutEffect(() => {
    if (props.blank) return;
    if (was.current !== undefined && at !== was.current && !reducedMotion())
      badge.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 400,
        easing: 'ease-out',
      });
    was.current = at;
  }, [at, props.blank]);
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
          <span ref={badge} class="ro-delta" data-down={change.by < 0}>
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
  const temp =
    card.best &&
    temperaturePanel(
      card.best,
      view.timeZone,
      view.state.units,
      view.state.user?.settings.preferences,
    );
  const rain = card.best && rainPanel(card.best, view.timeZone);
  const tempId = `ro-temp-${card.routeId}`;
  const skyId = `ro-sky-${card.routeId}`;
  const windId = `ro-wind-${card.routeId}`;
  const rainId = `ro-rain-${card.routeId}`;
  const drop = { open, toggle };
  const fixed = blank ? null : tracking.slot(card);
  // Paused (handoff v6 §4): name and distance in the plain style; Edit still removes it.
  if (view.paused)
    return (
      <div
        class="ro-ride"
        data-route={card.routeId}
        style={{ '--ro-i': props.index }}
      >
        <div class="ro-ride-head">
          <div class="ro-ride-title">
            {props.href ? (
              <a class="ro-name" href={props.href}>
                {card.name}
              </a>
            ) : (
              <span class="ro-name">{card.name}</span>
            )}
          </div>
          {tracking.editing && (
            <TileAction card={card} tracking={tracking} disabled={false} />
          )}
        </div>
        <div class="ro-facts">
          <span>
            <Icon name="route" size={15} />
            {card.km} km
          </span>
        </div>
      </div>
    );
  return (
    <div
      class={`ro-ride ${panel ? (rank < 3 ? `ro-${MEDALS[rank].toLowerCase()}` : '') : tint(card)}${tracking.alert === card.routeId ? ' ro-alert' : ''}`}
      data-state={card.state}
      data-route={card.routeId}
      data-blank={blank}
      data-peeking={tracking.peeking === card.routeId || undefined}
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
        {fixed ? (
          <FixedTime view={view} card={card} slot={fixed} tracking={tracking} />
        ) : (
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
        )}
      </div>
      <div class="ro-rule" />
      <Slot class="ro-conditions">
        {card.best ? (
          <ul class="ro-chips">
            {/* Temperature, sky, wind, rain (handoff v4); each opens its dropdown once there's data for it
                (v7). Keyed by text: a changed chip fades in afresh. */}
            {temp ? (
              <DropChip
                key={chips[0].text}
                {...drop}
                id={tempId}
                class="ro-temp-chip"
                chip={{ ...chips[0], label: temp.label, warn: temp.warn }}
              />
            ) : (
              <PlainChip key={chips[0].text} chip={chips[0]} />
            )}
            {sky &&
              (sky.segments ? (
                <DropChip
                  key={sky.text}
                  {...drop}
                  id={skyId}
                  class="ro-sky-chip"
                  chip={{
                    ...sky,
                    label: `${sky.label}. Show expected conditions`,
                    warn: false,
                  }}
                  partial={sky.partial}
                />
              ) : (
                <PlainChip key={sky.text} chip={sky} />
              ))}
            <DropChip
              key={chips[1].text}
              {...drop}
              id={windId}
              class="ro-wind-chip"
              chip={{
                ...chips[1],
                label: `${chips[1].label}${chips[1].warn ? ', costs points' : ''}. Show wind along the ride`,
              }}
            />
            {rain ? (
              <DropChip
                key={rain.text}
                {...drop}
                id={rainId}
                class="ro-rain-chip"
                chip={{
                  icon: rain.dry ? 'dry' : 'drop',
                  text: rain.text,
                  label: rain.label,
                  warn: false,
                }}
                wet={rain.wet}
              />
            ) : (
              <PlainChip key={chips[2].text} chip={chips[2]} />
            )}
          </ul>
        ) : (
          <span>{card.reason}</span>
        )}
      </Slot>
      {open === tempId && card.best && temp && (
        <TemperatureChart id={tempId} panel={temp} />
      )}
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
      {open === rainId && rain && <RainPanel id={rainId} rain={rain} />}
      {!blank && <Notes card={card} />}
      {blank || card.score !== null ? (
        <Meter
          score={card.score}
          blank={blank}
          change={card.best?.scoreChange}
        />
      ) : (
        card.state === 'incomplete' && <span class="ro-no-score">No score</span>
      )}
    </div>
  );
};

const PlainChip = (props: { chip: Chip }) => (
  <li aria-label={props.chip.label} data-warn={props.chip.warn}>
    <Icon name={props.chip.icon} size={16} />
    {props.chip.text}
  </li>
);

// A chip that opens its dropdown under the row, with a chevron that turns (handoff v4, v7).
const DropChip = (props: {
  id: string;
  class: string;
  chip: Omit<Chip, 'icon'> & { icon: keyof typeof ICONS };
  open: string | null;
  toggle: (id: string) => void;
  partial?: boolean;
  wet?: boolean;
}) => (
  <li class={props.class}>
    <button
      type="button"
      aria-expanded={props.open === props.id}
      aria-controls={props.id}
      aria-label={props.chip.label}
      data-warn={props.chip.warn}
      data-partial={props.partial}
      data-wet={props.wet}
      onClick={() => props.toggle(props.id)}
    >
      <Icon name={props.chip.icon} size={16} />
      {props.chip.text}
      <Icon name="chevron" size={12} weight={1.6} class="ro-chevron" />
    </button>
  </li>
);

// "Temperature along the ride" (24a, axis 26b): when it feels outside the rider's range, then air and
// feels like against that range, shaded, on a 5° grid that fits them, with the usual band behind them.
const TemperatureChart = (props: { id: string; panel: TemperaturePanel }) => {
  const t = props.panel;
  const at = (x: number, y: number) => ({ left: `${x}%`, top: `${y}%` });
  return (
    <div class="ro-temp" id={props.id}>
      <b>Temperature along the ride</b>
      <div class="ro-temp-head">
        <strong data-tone={t.tone}>{t.headline}</strong>
        {t.usual && <span>{t.usual.sub}</span>}
      </div>
      <div class="ro-temp-chart" aria-hidden="true">
        <div class="ro-temp-plot">
          <i
            class="ro-temp-block"
            style={{ top: `${t.high.y}%`, height: `${t.low.y - t.high.y}%` }}
          />
          {t.ticks.map((g) => (
            <i key={g.label} class="ro-temp-grid" style={{ top: `${g.y}%` }} />
          ))}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {t.usual && <path d={t.usual.band} class="ro-temp-band" />}
            {t.feels && <path d={t.feels} class="ro-temp-feels" />}
            <path d={t.air} class="ro-temp-air" />
          </svg>
          {t.ends.map((e) => (
            <i key={`${e.end}`} class="ro-temp-dot" style={at(e.x, e.y)} />
          ))}
          {t.ends.map((e) => (
            <span
              key={`${e.end}`}
              class="ro-temp-end"
              data-above={e.above}
              data-end={e.end}
              style={at(e.x, e.y)}
            >
              {e.label}
            </span>
          ))}
          {t.mark && (
            <i
              class="ro-temp-mark"
              data-cool={t.mark.cool}
              style={at(t.mark.x, t.mark.y)}
            />
          )}
        </div>
        <div class="ro-temp-gutter">
          {t.ticks.map((g) => (
            <span key={g.label} style={{ top: `${g.y}%` }}>
              {g.label}
            </span>
          ))}
          {[t.high, t.low].map((e) => (
            <span key={e.y} data-edge style={{ top: `${e.y}%` }}>
              {e.label}
            </span>
          ))}
        </div>
      </div>
      <div class="ro-ends ro-temp-ends" aria-hidden="true">
        <span>{t.from}</span>
        <span>{t.to}</span>
      </div>
      <ul class="ro-key">
        <li>
          <i data-key="air" />
          Temperature
        </li>
        {t.feels && (
          <li>
            <i data-key="feels" />
            Feels like
          </li>
        )}
        {t.usual && (
          <li>
            <i data-key="usual" />
            Usual in {t.usual.month}
          </li>
        )}
        <li>
          <i data-key="range" />
          {t.range}
        </li>
      </ul>
    </div>
  );
};

// "Rain along the ride" (25b): one card per ride hour with its chance and amount side by side.
const RainPanel = (props: { id: string; rain: Rain }) => {
  const { rain } = props;
  return (
    <div class="ro-rain" id={props.id}>
      <b>Rain along the ride</b>
      <strong data-wet={rain.wet}>{rain.headline}</strong>
      <p>{rain.sentence}</p>
      <ol class="ro-rain-hours">
        {rain.hours.map((h) => (
          <li key={h.time} data-wet={h.chance >= 40}>
            <span>{h.time}</span>
            <b>{h.chance}%</b>
            <i>
              <i style={{ width: `${h.chance}%` }} />
            </i>
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              stroke-width="1.4"
              stroke-linejoin="round"
              aria-hidden="true"
              data-level={h.level}
            >
              <path d="M8 2.2C8 2.2 4 6.6 4 9.6a4 4 0 0 0 8 0C12 6.6 8 2.2 8 2.2z" />
            </svg>
            <em data-level={h.level}>{h.word}</em>
            <small>{h.mm} mm</small>
          </li>
        ))}
      </ol>
      <ul class="ro-key">
        <li>
          <i data-key="chance" />
          Chance of rain
        </li>
        <li>
          <i data-level="1" />
          Light
        </li>
        <li>
          <i data-level="2" />
          Moderate
        </li>
        <li>
          <i data-level="3" />
          Heavy
        </li>
      </ul>
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

// A forecast update (15a): scores, bars, chips and badges change in place, then 700ms later the cards slide to
// their new order (FLIP). The new DOM order is committed, so tab order and screen readers follow the screen.
// Without motion (reduced, or a hidden tab) it all changes at once.
export const Ranked = (props: {
  cards: Card[];
  class: string;
  render: (
    card: Card,
    index: number,
    medal: number | null,
  ) => ComponentChildren;
}) => {
  const { cards } = props;
  const list = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState(() => cards.map((c) => c.routeId));
  const [said, setSaid] = useState('');
  const open = useState<string | null>(null);
  const last = useRef(cards);
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
    last.current = cards;
    const ids = cards.map((c) => c.routeId);
    // A route tracked or dropped: no motion.
    if (ids.length !== order.length || ids.some((id) => !order.includes(id))) {
      setOrder(ids);
      return;
    }
    const still = reducedMotion() || document.hidden;
    const moved = ids.some((id, i) => id !== order[i]);
    const old = new Map(
      was.map((c) => [c.routeId, c.best?.scoreChange?.changedAt]),
    );
    const changed = cards.some(
      (c) =>
        c.best?.scoreChange &&
        c.best.scoreChange.changedAt !== old.get(c.routeId),
    );
    if (still && (moved || changed) && !document.hidden)
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
  }, [
    cards
      .map((c) => `${c.routeId}:${c.score}:${c.best?.scoreChange?.changedAt}`)
      .join(),
  ]);

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
            const card = byId.get(id) as Card;
            return props.render(card, i, card.score !== null ? scored++ : null);
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
