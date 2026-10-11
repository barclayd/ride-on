// Pieces shared by the popup and the Journeys page.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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

// Popup card; medals on its top three scored rides.
export const RideCard = (props: { view: View; card: Card; medal?: number }) => {
  const { card, medal } = props;
  return (
    <div
      class={`ro-ride ${medal !== undefined ? `ro-${MEDALS[medal].toLowerCase()}` : tint(card)}`}
      data-state={card.state}
      data-route={card.routeId}
    >
      <div class="ro-ride-head">
        <div class="ro-pills">
          {medal !== undefined && (
            <span class="ro-medal" title={MEDALS[medal]}>
              {medal + 1}
            </span>
          )}
          <Pills card={card} />
        </div>
        {untrack(card)}
      </div>
      <div class="ro-ride-title">
        <span class="ro-name">{card.name}</span>
        <Tags view={props.view} routeId={card.routeId} />
        {card.recent && (
          <span class="ro-tag ro-tag-last">Similar roads recently ridden</span>
        )}
      </div>
      {(card.when ?? card.duration) && (
        <span class="ro-when">{card.when ?? card.duration}</span>
      )}
      {card.weather && <span class="ro-conditions">{card.weather}</span>}
      {card.reason && <span class="ro-conditions">{card.reason}</span>}
      <Notes card={card} />
      {card.score !== null ? (
        <div class="ro-score">
          <span>Conditions {card.score}/100</span>
          <div>
            <div style={{ width: `${card.score}%` }} />
          </div>
        </div>
      ) : (
        card.state === 'incomplete' && <span class="ro-no-score">No score</span>
      )}
    </div>
  );
};

// Journeys page tile (14a): name, distance and time, chips, then the score. Flags sit on the top border,
// so every tile has the same layout. A blank tile keeps a scored tile's size: placeholders until scores arrive.
export const RouteTile = (props: {
  view: View;
  card: Card;
  href: string | null; // the page links each ride to its journey
  blank: boolean;
  index: number; // staggers the fade-in
}) => {
  const { card, blank, view } = props;
  return (
    <div
      class={`ro-ride ${tint(card)}`}
      data-state={card.state}
      data-route={card.routeId}
      data-blank={blank}
      style={{ '--ro-i': props.index }}
    >
      <div class="ro-flags">
        <Pills card={card} star />
      </div>
      <div class="ro-ride-head">
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
      <div class="ro-facts">
        <span>
          <Icon name="route" size={15} />
          {card.km} km
        </span>
        <Slot class="ro-when">
          {card.best ? (
            <span>
              <Icon name="clock" size={15} />
              {shortDate(card.best.date)}
              <b aria-hidden="true">·</b>
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
            ).map((chip) => (
              <li key={chip.icon} aria-label={chip.label} data-warn={chip.warn}>
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
        // biome-ignore lint/a11y/useSemanticElements: the design's label row and bar; a native <meter> can't hold or style them.
        <div
          class="ro-meter"
          role="meter"
          aria-label="Conditions score"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={card.score ?? 0}
          aria-hidden={blank || undefined}
        >
          <span>
            Conditions
            <span>
              <strong>{card.score ?? '–'}</strong>/100
            </span>
          </span>
          <div>
            <div style={{ width: `${blank ? 0 : card.score}%` }} />
          </div>
        </div>
      ) : (
        card.state === 'incomplete' && <span class="ro-no-score">No score</span>
      )}
    </div>
  );
};

const BANNERS: Record<Exclude<Banner, 'provider'>, string> = {
  nomatch:
    'None of these rides meets all your minimum conditions. Here are the best available options.',
  incomplete:
    "We couldn't confirm a ride that meets your minimum conditions because some forecasts are unavailable.",
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

// Required wherever a provider's data shows (Apple: trademark logo, legal link, derived-data notice).
// ponytail: light logo only; use logo.darkUrl if a dark theme lands.
export const Attribution = ({ view }: { view: View }) =>
  view.attributions.length > 0 ? (
    <div class="ro-attribution">
      {view.attributions.map((a) => (
        <span key={a.url}>
          <a href={a.url} target="_blank" rel="noreferrer">
            {a.logo ? <img src={a.logo.lightUrl} alt={a.text} /> : a.text}
          </a>
          {a.notice && <span>{a.notice}</span>}
        </span>
      ))}
    </div>
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
