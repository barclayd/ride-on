// The alerts dialog (handoff v10, 29c): an off bell asks which changes to hear about first.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AlertTriggers } from '../lib/types';
import { BellIcon, type Tracking, type View } from './components';
import { clock, shortDate } from './format';
import {
  ALL_TRIGGERS,
  asksPermission,
  confirmLabel,
  SUMMARY_TIME,
  timingLine,
  triggerRows,
} from './triggers';

export const AlertsDialog = (props: { view: View; tracking: Tracking }) =>
  props.tracking.asking && (
    <Dialog key={props.tracking.asking.card.routeId} {...props} />
  );

const Dialog = ({ view, tracking }: { view: View; tracking: Tracking }) => {
  const { state, timeZone } = view;
  // biome-ignore lint/style/noNonNullAssertion: AlertsDialog renders it only while asking
  const { card } = tracking.asking!;
  const best = card.best;
  const [triggers, setTriggers] = useState<AlertTriggers>(
    () => state.triggers[card.routeId] ?? ALL_TRIGGERS,
  );
  const box = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);
  if (!best) return null;
  const rows = triggerRows(state.user?.settings.preferences, state.units);
  const on = rows.filter((row) => triggers[row.key]).length;
  const moving = tracking.movingFrom(card);
  const score = card.score ?? Math.round(best.score);
  // Focus stays in the dialog; Escape closes it.
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      return tracking.close();
    }
    if (event.key !== 'Tab' || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>('button')];
    const root = box.current.getRootNode() as Document | ShadowRoot;
    const edge = event.shiftKey ? all[0] : all.at(-1);
    if (root.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? all.at(-1) : all[0])?.focus();
  };
  return (
    <>
      <div class="ro-alerts-dim" onClick={tracking.close} aria-hidden="true" />
      <div
        ref={box}
        class="ro-alerts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ro-alerts-title"
        onKeyDown={keys}
      >
        <div class="ro-alerts-head">
          <span class="ro-alerts-icon">
            <BellIcon size={20} />
          </span>
          <div>
            <span id="ro-alerts-title">Get alerts for this ride</span>
            <span>
              We keep checking the forecast and tell you if anything changes
              before you leave.
            </span>
          </div>
          <button
            type="button"
            class="ro-alerts-close"
            aria-label="Close"
            onClick={tracking.close}
          >
            ×
          </button>
        </div>
        <div class="ro-alerts-ride">
          <div>
            <span>{card.name}</span>
            <span>
              {`${shortDate(best.date)} · ${clock(best.departureAt, timeZone)} → ~${clock(best.finishAt, timeZone)}`}
            </span>
          </div>
          <div>
            <span>
              <strong>{score}</strong>/100
            </span>
            <span class="ro-alerts-bar">
              <span style={{ width: `${score}%` }} />
            </span>
          </div>
        </div>
        {moving && (
          <div class="ro-alerts-move">
            <BellIcon size={15} />
            <span>
              {moving} has alerts now. Only one ride can have alerts, so they
              move to {card.name}.
            </span>
          </div>
        )}
        <div class="ro-alerts-when">
          <span>Tell me if</span>
          <ul>
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={triggers[row.key]}
                  onClick={() =>
                    setTriggers({ ...triggers, [row.key]: !triggers[row.key] })
                  }
                >
                  <svg
                    width="18"
                    height="18"
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
                  <span>{row.label}</span>
                  <span class="ro-switch" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p>
          {timingLine(
            best.departureAt,
            timeZone,
            new Date(),
            state.tracker.summaryTime ?? SUMMARY_TIME,
          )}
        </p>
        {asksPermission(state.push) && (
          <p>Your browser will ask you to allow notifications from Ride On.</p>
        )}
        <div class="ro-alerts-actions">
          <button
            ref={primary}
            type="button"
            class="ro-alerts-go"
            aria-disabled={on === 0 || undefined}
            onClick={() => on > 0 && tracking.confirm(triggers)}
          >
            {confirmLabel(on, !!moving)}
          </button>
          <button
            type="button"
            class="ro-alerts-later"
            onClick={tracking.close}
          >
            Not now
          </button>
        </div>
      </div>
    </>
  );
};
