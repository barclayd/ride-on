// Pieces shared by the popup and the Journeys page.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { onStateChange, readState, type State, send } from '../lib/state';
import { DEFAULT_PLANNING, type Planning, type Preset } from '../lib/types';
import {
  buildCards,
  type Card,
  clock,
  horizonDates,
  localDate,
  presetAvailable,
} from './format';

export const iconUrl = () => browser.runtime.getURL('/ride-on-icon.png');

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
};

export type View = {
  state: State;
  timeZone: string;
  today: string;
  planning: Planning;
  horizon: string[];
  cards: Card[];
};

export const useView = (): View | null => {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const stop = onStateChange(setState);
    readState().then((read) => setState((current) => current ?? read));
    return stop;
  }, []);
  if (!state) return null;
  const timeZone =
    state.user?.settings.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDate(new Date(), timeZone);
  return {
    state,
    timeZone,
    today,
    planning: state.user?.settings.planning ?? DEFAULT_PLANNING,
    horizon: horizonDates(state.recs, today),
    cards: buildCards(
      state.selection?.routeIds ?? [],
      state.routes,
      state.recs,
      timeZone,
      today,
    ),
  };
};

export type Option<T> = { value: T; label: string; disabled?: boolean };

export const Segmented = <T extends string>(props: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  inline?: boolean;
}) => (
  <fieldset
    class={props.inline ? 'ro-segmented ro-inline' : 'ro-segmented'}
    aria-label={props.label}
  >
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

export const DayPresets = ({
  view,
  inline,
}: {
  view: View;
  inline?: boolean;
}) => {
  const { planning, horizon } = view;
  const presets: [Preset, string][] = [
    ['today', 'Today'],
    ['tomorrow', 'Tomorrow'],
    ['weekend', 'Weekend'],
    ['next', inline ? `Next ${horizon.length} days` : `${horizon.length} days`],
  ];
  return (
    <Segmented
      label="Days"
      inline={inline}
      value={planning.days.kind === 'preset' ? planning.days.preset : null}
      options={presets.map(([value, label]) => ({
        value,
        label,
        disabled: !presetAvailable(value, horizon),
      }))}
      onChange={(preset) =>
        send({
          type: 'setPlanning',
          planning: { ...planning, days: { kind: 'preset', preset } },
        })
      }
    />
  );
};

const rankClass = (card: Card) =>
  card.state === 'ok'
    ? card.top
      ? 'ro-top'
      : ''
    : card.state === 'no-ride'
      ? 'ro-no-ride'
      : 'ro-pending';

export const Badge = ({ card }: { card: Card }) => (
  <span class={`ro-badge ${rankClass(card)}`}>{card.rankLabel}</span>
);

export const Rank = ({ card }: { card: Card }) => (
  <span class={`ro-rank ${rankClass(card)}`}>{card.n}</span>
);

export const Pips = ({ level }: { level: number }) => (
  <span class="ro-pips" title="Forecast confidence">
    {[5, 8, 11].map((height, i) => (
      <span
        key={height}
        class={i < level ? 'ro-on' : ''}
        style={{ height: `${height}px` }}
      />
    ))}
  </span>
);

export const Score = ({ card }: { card: Card }) => (
  <span class="ro-score">{card.score ?? '—'}</span>
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

export const When = ({ card }: { card: Card }) =>
  card.state === 'ok' ? (
    <span class="ro-when">
      {card.day} · {card.window}
    </span>
  ) : null;

export const CardLines = (props: {
  card: Card;
  children?: ComponentChildren;
}) => {
  const { card } = props;
  return card.state === 'ok' ? (
    <>
      <When card={card} />
      <span class="ro-conditions">{card.conditions}</span>
      {card.drawback && <span class="ro-drawback">{card.drawback}</span>}
    </>
  ) : card.state === 'no-ride' ? (
    <span class="ro-drawback">
      {props.children} {card.reason}
    </span>
  ) : (
    <span class="ro-conditions">Checking the forecast…</span>
  );
};

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
