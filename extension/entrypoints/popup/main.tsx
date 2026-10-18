import { Fragment, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { API_URL } from '../../lib/api';
import {
  type Message,
  type Planning,
  type Provider,
  type Search,
  send,
  type Tab,
} from '../../lib/state';
import type { Climbing } from '../../lib/types';
import {
  AppleMark,
  Banners,
  CloseButton,
  CoverageWarn,
  chooseWindow,
  EditButton,
  ErrorChip,
  Expired,
  GoogleMark,
  iconUrl,
  injectFonts,
  PausedLine,
  ProviderDown,
  Ranked,
  RouteTile,
  reducedMotion,
  Segmented,
  Toast,
  type Tracking,
  useTracking,
  useView,
  type View,
} from '../../ui/components';
import {
  addDays,
  checkinDay,
  clock,
  convert,
  coverageText,
  DEFAULT_LEVELS,
  type Draft,
  dayOfMonth,
  degrees,
  draftFrom,
  draftLocal,
  draftPatch,
  hours,
  monthLabel,
  newest,
  qualityColour,
  rainText,
  rankText,
  rideLine,
  rideSummary,
  scaleMaxKm,
  searchDiffers,
  shortDate,
  speed,
  tempText,
  toggleDay,
  type Units,
  unitLabel,
  updatedText,
  usualSearch,
  validateRange,
  weekday,
  windowBest,
  windowLabel,
  windowName,
  windowWhen,
} from '../../ui/format';
import '../../ui/tokens.css';

const TABS: [Tab, string][] = [
  ['rides', 'Rides'],
  ['when', 'When'],
  ['prefs', 'Preferences'],
  ['history', 'History'],
];

const SignedOut = ({ view }: { view: View }) => {
  const { auth, signingInWith, signInError } = view.state;
  const busy = auth === 'signing-in';
  const [denied, setDenied] = useState(false);
  const signIn = async (provider: Provider) => {
    // Safari grants hosts per site; ask while the click still counts as a gesture.
    if (import.meta.env.SAFARI) {
      const origins = [`${API_URL}/*`, 'https://cycle.travel/*'];
      const granted = await browser.permissions
        .request({ origins })
        .catch(() => false);
      setDenied(!granted);
      if (!granted) return;
    }
    send({ type: 'signIn', provider });
  };
  const error = denied
    ? `Ride On needs access to cycle.travel and ${new URL(API_URL).host} to sign in.`
    : signInError;
  const providers = [
    { id: 'google', name: 'Google', Mark: GoogleMark },
    { id: 'apple', name: 'Apple', Mark: AppleMark },
  ] as const;
  return (
    <>
      <div class="ro-signed-out-head">
        <img src={iconUrl()} alt="" />
        Ride On
      </div>
      <div class="ro-signed-out">
        <img class="ro-hero" src={iconUrl()} alt="" />
        <div class="ro-hero-text">
          <span>Ride On</span>
          <span>
            Pick the best of your saved cycle.travel routes, and the best time
            to ride it.
          </span>
        </div>
        <div class="ro-providers">
          <span class="ro-divider">
            {busy && signingInWith
              ? `Signing in with ${signingInWith === 'google' ? 'Google' : 'Apple'}…`
              : 'Continue with'}
          </span>
          <div class="ro-provider-grid">
            {providers.map(({ id, name, Mark }) => (
              <button
                key={id}
                type="button"
                class={`ro-provider ro-${id}${busy && signingInWith !== id ? ' ro-faded' : ''}`}
                aria-label={`Continue with ${name}`}
                title={`Continue with ${name}`}
                // Safari's sign-in tab can be left open; let the rider start again.
                disabled={busy && !import.meta.env.SAFARI}
                onClick={() => signIn(id)}
              >
                <Mark />
              </button>
            ))}
          </div>
          {error && (
            <span class="ro-warn-chip" role="alert">
              {error}
            </span>
          )}
        </div>
        {/* ponytail: no Terms or Privacy pages exist yet; link them when they do. */}
        <p class="ro-legal">
          By continuing you agree to the <a href="#terms">Terms</a> and{' '}
          <a href="#privacy">Privacy Policy</a>.
        </p>
      </div>
    </>
  );
};

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const HOURS = Array.from({ length: 17 }, (_, i) => i + 5);
const decimal = (time: string) =>
  Number(time.slice(0, 2)) + Number(time.slice(3)) / 60;
const pct = (h: number) =>
  `${((Math.min(21, Math.max(5, h)) - 5) / 16) * 100}%`;
const width = (from: number, to: number) =>
  `${(Math.max(0, Math.min(21, to) - Math.max(5, from)) / 16) * 100}%`;

const toPrefs = () => send({ type: 'setTab', tab: 'prefs' });

// Tap days on and off. Days that have passed show in amber, then move on to tomorrow.
const Days = (props: {
  view: View;
  set: (change: Partial<Planning>) => void;
}) => {
  const { view, set } = props;
  const [moved, setMoved] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const stale = !view.range;
  const dates = view.range ?? view.passed;

  // Passed days stay up for a moment, then move on to tomorrow, or the first day the forecast covers.
  useEffect(() => {
    if (!stale) return;
    const timer = setTimeout(
      () => {
        const later = view.strip.slice(1);
        const day = later.find((d) => d.kind !== 'none');
        if (!day) return;
        setMoved(view.datesText);
        setSaid(
          `${view.datesText} has passed. Showing ${shortDate(day.date)}.`,
        );
        set({
          days:
            day === later[0]
              ? { kind: 'preset', preset: 'tomorrow' }
              : { kind: 'range', start: day.date, end: day.date },
        });
      },
      reducedMotion() ? 0 : 1600,
    );
    return () => clearTimeout(timer);
  }, [stale]);

  return (
    <>
      <div class="ro-card-head">
        <span class="ro-label">Days</span>
        {stale ? (
          <span class="ro-value ro-days-warn">
            {view.passed?.at(-1) === view.today
              ? 'Too late today'
              : 'Dates passed'}
          </span>
        ) : (
          <span class="ro-value">
            {moved && <s>{moved}</s>} {view.datesText}
          </span>
        )}
      </div>
      <span class="ro-sr" aria-live="polite">
        {said}
      </span>
      <fieldset class="ro-days" aria-label="Pick days" data-stale={stale}>
        {view.strip.map((day, i) => (
          <button
            key={day.date}
            type="button"
            class="ro-day"
            data-kind={day.kind}
            title={day.title}
            aria-pressed={!!dates?.includes(day.date)}
            onClick={() => {
              const days = toggleDay(view.range, day.date);
              if (!days) return;
              setMoved(null);
              set({ days });
            }}
          >
            <span>{i === 0 ? 'Today' : weekday(day.date)}</span>
            <span>{dayOfMonth(day.date)}</span>
            <span>{day.label}</span>
            <span class="ro-quality">
              {day.quality !== null && (
                <span
                  style={{
                    // A partial day's bar is halved: its best ride may be missing.
                    width: `${day.kind === 'partial' ? day.quality / 2 : day.quality}%`,
                    background: qualityColour(day.quality),
                  }}
                />
              )}
            </span>
          </button>
        ))}
      </fieldset>
    </>
  );
};

type Return = '3' | '7' | 'choose';

// Hides forecasts, scores and alerts until the day it turns back on (handoff v6 §1).
const PauseCard = ({ view }: { view: View }) => {
  const { paused, today } = view;
  const until = paused?.until ?? null;
  // A write that fails puts the last choice back; this says why the switch moved.
  const [failed, setFailed] = useState(false);
  const save = (message: Message) =>
    send(message).then((result) => setFailed(!!result.error));
  // The date is stored, not the option; one a day or more old matches neither.
  const option: Return | null = !paused
    ? null
    : until === null
      ? 'choose'
      : until === addDays(today, 3)
        ? '3'
        : until === addDays(today, 7)
          ? '7'
          : null;
  return (
    <section class="ro-card ro-pause" data-paused={!!paused}>
      <div class="ro-pause-top">
        <div class="ro-pause-text">
          <span>Pause Ride On</span>
          <span>
            Hide forecasts, scores and alerts. Your rides stay listed.
          </span>
        </div>
        <Switch
          on={!!paused}
          label="Pause Ride On"
          onClick={() =>
            save(
              paused
                ? { type: 'resume' }
                : { type: 'pause', until: addDays(today, 7) },
            )
          }
        />
      </div>
      {failed && (
        <span class="ro-pause-error" role="alert">
          Couldn't save that. Check your connection and try again.
        </span>
      )}
      {paused && (
        <div class="ro-pause-return">
          <span class="ro-pause-label">Turn back on</span>
          <Segmented<Return>
            label="Turn back on"
            options={[
              { value: '3', label: 'After 3 days' },
              { value: '7', label: 'After a week' },
              { value: 'choose', label: 'When I choose' },
            ]}
            value={option}
            onChange={(value) =>
              save({
                type: 'pause',
                until: value === 'choose' ? null : addDays(today, +value),
              })
            }
          />
          <span class="ro-pause-when">
            {until
              ? `Back on ${shortDate(until)}.`
              : 'Stays paused until you switch it off here.'}
          </span>
        </div>
      )}
    </section>
  );
};

const WhenTab = ({ view }: { view: View }) => {
  const { planning, defaultPlanning } = view.state;
  const set = (change: Partial<Planning>) =>
    send({ type: 'setPlanning', planning: { ...planning, ...change } });
  const coverage = coverageText(view.selected, view.timeZone);
  const { time } = planning;
  const custom = time.mode === 'custom';
  const tz = view.timeZone;
  const sun = view.daylight && [
    hours(view.daylight.start, tz),
    hours(view.daylight.end, tz),
  ];
  const chosen = custom ? [decimal(time.start), decimal(time.end)] : sun;
  const shown =
    chosen && sun
      ? [Math.max(chosen[0], sun[0]), Math.min(chosen[1], sun[1])]
      : chosen;
  const saved = JSON.stringify(defaultPlanning) === JSON.stringify(planning);
  // Paused: the rider's days and times stay as they are, greyed out (handoff v6 §2).
  const dim = { 'data-dim': !!view.paused, inert: !!view.paused };
  return (
    <>
      <section {...dim} class="ro-card ro-dims">
        <Days view={view} set={set} />
        {view.banners.includes('provider') && (
          <div class="ro-note">
            <ProviderDown view={view} onChange={toPrefs} />
          </div>
        )}
        {coverage && <div class="ro-note">{coverage}</div>}
      </section>
      <section {...dim} class="ro-card ro-dims">
        <div class="ro-card-head">
          <span class="ro-label">Time</span>
          <span class="ro-value">{view.timeText}</span>
        </div>
        <Segmented
          label="Time"
          options={[
            { value: 'daylight', label: 'Daylight hours' },
            { value: 'custom', label: 'Choose times' },
          ]}
          value={time.mode}
          onChange={(mode) => set({ time: { ...time, mode } })}
        />
        {custom && (
          <div class="ro-times">
            <label>
              Earliest start
              <select
                class="ro-select"
                value={Number(time.start.slice(0, 2))}
                onChange={(e) => {
                  const start = Number(e.currentTarget.value);
                  const end = Math.max(decimal(time.end), start + 1);
                  set({
                    time: { ...time, start: hour(start), end: hour(end) },
                  });
                }}
              >
                {HOURS.slice(0, -1).map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Latest finish
              <select
                class="ro-select"
                value={Number(time.end.slice(0, 2))}
                onChange={(e) => {
                  const end = Number(e.currentTarget.value);
                  const start = Math.min(decimal(time.start), end - 1);
                  set({
                    time: { ...time, start: hour(start), end: hour(end) },
                  });
                }}
              >
                {HOURS.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div class="ro-timeline" aria-hidden="true">
          <div class="ro-timeline-bar">
            {sun && (
              <div
                class="ro-daylight"
                title="Daylight"
                style={{ left: pct(sun[0]), width: width(sun[0], sun[1]) }}
              />
            )}
            {shown && (
              <div
                class="ro-selected"
                style={{
                  left: pct(shown[0]),
                  width: width(shown[0], shown[1]),
                }}
              />
            )}
          </div>
          <div class="ro-axis">
            {['05', '09', '13', '17', '21'].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>
        {custom &&
          view.daylight &&
          sun &&
          chosen &&
          (chosen[0] < sun[0] || chosen[1] > sun[1]) && (
            <span class="ro-hint">
              Rides are kept within daylight, {clock(view.daylight.start, tz)}–
              {clock(view.daylight.end, tz)}.
            </span>
          )}
      </section>
      <button
        {...dim}
        type="button"
        class="ro-default ro-dims"
        data-saved={saved}
        onClick={() => send({ type: 'saveDefaultPlanning' })}
      >
        <span aria-hidden="true">{saved ? '✓' : '+'}</span>
        {saved ? 'Saved as your default window' : 'Save as my default window'}
      </button>
    </>
  );
};

const km = (m: number) => Math.round(m / 1000);

// "Did you ride …?" for the window that just ended. Slides to a route picker and on to a confirmation.
const CheckIn = ({ view }: { view: View }) => {
  const { checkin, routes, selection } = view.state;
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!checkin || view.paused) return null; // asked again once it turns back on
  const tz = view.timeZone;
  // Asked about the ride that had alerts (19c), else the top pick.
  const alert = checkin.picks.find((p) => p.routeId === checkin.alert);
  const top = alert ?? checkin.picks[0];
  const routeId = chosen ?? top.routeId;
  const name = (id: string) => routes[id]?.name ?? 'your route';
  const answer = async (
    message:
      | { answer: 'yes'; routeId: string }
      | { answer: 'no' | 'undo' | 'updated' },
  ) => {
    setBusy(true);
    await send({ type: 'checkin', ...message });
    setBusy(false);
    if (message.answer === 'undo') setChosen(null);
  };
  const done = checkin.status === 'done' && checkin.routeId;
  const pane = done ? 'done' : picking ? 'pick' : 'ask';
  const conflict = checkin.status === 'conflict' && checkin.routeId;
  const c = top.conditions;
  return (
    <section class="ro-checkin" data-pane={pane} aria-label="Ride check-in">
      <div class="ro-checkin-track">
        <div class="ro-ask" aria-hidden={pane !== 'ask'} inert={pane !== 'ask'}>
          <span class="ro-checkin-day">{checkinDay(top, view.today, tz)}</span>
          <h2>Did you ride {name(routeId)}?</h2>
          <p>
            {conflict
              ? `${name(conflict)} has changed since this plan.`
              : routeId === top.routeId
                ? `${alert ? 'You had alerts on for it' : `It was ${rankText(top.rank)}`}: ${km(routes[routeId]?.distanceM ?? 0)} km, leave ${clock(top.departureAt, tz)}, ${tempText(c, view.state.units)} and ${rainText(c)}.`
                : `${km(routes[routeId]?.distanceM ?? 0)} km · instead of ${name(top.routeId)}, ${rankText(top.rank)}`}
          </p>
          <div class="ro-checkin-actions">
            {conflict ? (
              <button
                type="button"
                class="ro-primary"
                disabled={busy}
                onClick={() => answer({ answer: 'updated' })}
              >
                Log the updated route
              </button>
            ) : (
              <button
                type="button"
                class="ro-primary"
                disabled={busy}
                onClick={() => answer({ answer: 'yes', routeId })}
              >
                Yes, I rode it
              </button>
            )}
            <button
              type="button"
              class="ro-secondary"
              disabled={busy}
              onClick={() => answer({ answer: 'no' })}
            >
              Not this time
            </button>
          </div>
          <button
            type="button"
            class="ro-link"
            disabled={busy}
            onClick={() => setPicking(true)}
          >
            I rode a different route ›
          </button>
        </div>
        <div
          class="ro-pick"
          aria-hidden={pane !== 'pick'}
          inert={pane !== 'pick'}
        >
          <div class="ro-pick-head">
            <button
              type="button"
              class="ro-back"
              aria-label="Back"
              onClick={() => setPicking(false)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M10 3 5 8l5 5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <h2>Which route did you ride?</h2>
          </div>
          <fieldset class="ro-pick-list" aria-label="Your tracked routes">
            {(selection?.routeIds ?? []).map((id) => (
              <label key={id}>
                <input
                  type="radio"
                  name="ro-ridden-route"
                  checked={id === routeId}
                  onChange={() => {
                    setChosen(id);
                    setTimeout(() => setPicking(false), 260);
                  }}
                />
                <span>{name(id)}</span>
                <span>{km(routes[id]?.distanceM ?? 0)} km</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div
          class="ro-done"
          aria-hidden={pane !== 'done'}
          inert={pane !== 'done'}
        >
          <div>
            <span>
              Nice ride on {name(checkin.routeId ?? routeId)}. Saved to History.
            </span>
          </div>
          <button
            type="button"
            class="ro-link"
            disabled={busy}
            onClick={() => answer({ answer: 'undo' })}
          >
            Undo
          </button>
        </div>
      </div>
    </section>
  );
};

// The API's recommended window is "Best"; the order stays tomorrow, same weekday, best in the next days.
const NextWindows = ({ view }: { view: View }) => {
  const { next, expired } = view.state;
  if (!next || !expired) return null;
  const { windows } = next;
  return (
    <>
      <h2 class="ro-next-head">When's your next ride?</h2>
      {windows.length === 0 && (
        <span class="ro-empty">No forecast covers your next windows yet.</span>
      )}
      {windows.map((w) => {
        const score = Math.round(w.best.score);
        const best = w.kind === next.recommendedKind;
        // ponytail: route warnings mix GPX ingestion codes (ASCENT_IS_UNSMOOTHED_ESTIMATE) with
        // sentences; show the first sentence, map codes to copy if one ever needs saying.
        const note = w.warnings.find((x) => !/^[A-Z_]+$/.test(x));
        return (
          <button
            key={w.kind}
            type="button"
            class="ro-next"
            data-best={best}
            onClick={() => chooseWindow(view, w)}
          >
            <span class="ro-next-top">
              <span>{windowName(w)}</span>
              {w.recommendationKind === 'best_available' && (
                <span class="ro-pill ro-below">Best available</span>
              )}
              <span>{best ? `Best · ${score}` : score}</span>
            </span>
            <span class="ro-next-when">
              {windowWhen(
                w,
                expired.dates.at(-1) ?? view.today,
                view.today,
                view.timeZone,
              )}
            </span>
            <span class="ro-next-best">
              {windowBest(w, view.timeZone, view.state.units)}
            </span>
            {note && <span class="ro-next-when">{note}</span>}
          </button>
        );
      })}
    </>
  );
};

// The window, how fresh its forecast is, and a refresh button (15a).
const WindowHeading = (props: {
  view: View;
  range: string[];
  tracking: Tracking;
}) => {
  const { view, range } = props;
  const [asked, setAsked] = useState(false);
  const busy = asked || view.state.loading;
  // Two turns per loop; it stops at the end of a loop once the data is in.
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    if (busy && !reducedMotion()) setSpin(true);
  }, [busy]);
  const { recsAt } = view.state;
  return (
    <div class="ro-heading">
      <div>
        <span>{windowLabel(view.state.planning, range, view.today)}</span>
        {/* ponytail: "Updated … ago" moves on at the next render, not on a timer. */}
        <span>
          {[
            view.datesText,
            view.timeText,
            busy
              ? 'Updating forecast…'
              : recsAt && updatedText(recsAt, new Date()),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      {/* ponytail: the handoff's suggested Edit mode for the Rides tab (v5 §6), not yet designed. */}
      {view.cards.length > 0 && <EditButton tracking={props.tracking} />}
      <button
        type="button"
        class="ro-refresh"
        aria-label="Refresh forecast"
        title="Refresh forecast"
        disabled={busy || spin}
        onClick={() => {
          setAsked(true);
          send({ type: 'refresh', force: true }).finally(() => setAsked(false));
        }}
      >
        <svg
          class={spin ? 'ro-spin' : undefined}
          onAnimationIteration={() => !busy && setSpin(false)}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M13.2 6.2A5.5 5.5 0 0 0 3 5" />
          <path d="M2.8 9.8A5.5 5.5 0 0 0 13 11" />
          <path d="M13.5 2.5v3.8H9.7" />
          <path d="M2.5 13.5V9.7h3.8" />
        </svg>
      </button>
    </div>
  );
};

const RidesTab = ({ view, onChoose }: { view: View; onChoose: () => void }) => {
  const tracking = useTracking(view);
  // Paused: the status line only; every ride card is a score.
  if (view.paused) return <PausedLine view={view} />;
  if (view.state.expired)
    return (
      <>
        <CheckIn view={view} />
        <NextWindows view={view} />
        <button type="button" class="ro-link ro-choose" onClick={onChoose}>
          Choose my own dates ›
        </button>
      </>
    );
  return (
    <>
      <CheckIn view={view} />
      {view.range ? (
        <WindowHeading view={view} range={view.range} tracking={tracking} />
      ) : (
        <Expired view={view} onChoose={onChoose} />
      )}
      <Banners view={view} onProvider={toPrefs} />
      {view.range && view.cards.length === 0 && (
        <span class="ro-empty">
          No tracked routes yet. Track some from your cycle.travel Journeys
          page.
        </span>
      )}
      {view.cards.length > 0 && (
        <Ranked
          cards={view.cards}
          class="ro-rides"
          render={(card, _, medal) => (
            <RouteTile
              key={card.routeId}
              view={view}
              card={card}
              href={null}
              blank={false}
              index={0}
              medal={medal}
              tracking={tracking}
            />
          )}
        />
      )}
      <CoverageWarn view={view} />
      {(view.cards.length > 0 || tracking.said) && (
        <Toast tracking={tracking} />
      )}
    </>
  );
};

const Switch = (props: { on: boolean; label: string; onClick: () => void }) => (
  <button
    type="button"
    class="ro-switch"
    role="switch"
    aria-checked={props.on}
    aria-label={props.label}
    onClick={props.onClick}
  >
    <span />
  </button>
);

const Stepper = (props: {
  label: string;
  text: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) => (
  <div class="ro-stepper">
    <button
      type="button"
      aria-label={`Lower ${props.label}`}
      disabled={props.value <= props.min}
      onClick={() =>
        props.onChange(Math.max(props.min, props.value - props.step))
      }
    >
      −
    </button>
    <output>{props.text}</output>
    <button
      type="button"
      aria-label={`Raise ${props.label}`}
      disabled={props.value >= props.max}
      onClick={() =>
        props.onChange(Math.min(props.max, props.value + props.step))
      }
    >
      +
    </button>
  </div>
);

const CLIMBING: { value: Climbing; label: string }[] = [
  { value: 'flatter', label: 'Flatter' },
  { value: 'neutral', label: 'No preference' },
  { value: 'hillier', label: 'Hillier' },
];

// Edits apply to this search; "Save as usual preferences" writes them to the profile.
const DistanceCard = ({ view }: { view: View }) => {
  const { state } = view;
  const { unit } = state;
  const prefs = state.user?.settings.preferences;
  const [search, setSearch] = useState<Search | null>(state.search);
  if (!prefs) return null;
  const usual = usualSearch(prefs, unit);
  const current = search ?? usual;
  const differs = searchDiffers(current, usual, unit);
  const apply = (next: Search, nextUnit = unit) => {
    const keep = searchDiffers(next, usualSearch(prefs, nextUnit), nextUnit);
    setSearch(keep ? next : null);
    send({ type: 'setSearch', search: keep ? next : null });
  };
  const ranged = current.mode === 'range';
  const check = validateRange(current.from, current.to, unit);
  const km = ranged ? check.km : null;
  const max = scaleMaxKm(km);
  const at = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  const routes = (state.selection?.routeIds ?? []).flatMap((id) =>
    state.routes[id] ? [state.routes[id]] : [],
  );
  const summary = rideSummary(current, unit);
  const field = (key: 'from' | 'to', label: string, error: string | null) => (
    <label>
      {label}
      <div class="ro-field" data-invalid={!!error}>
        <input
          type="text"
          inputMode="decimal"
          autocomplete="off"
          value={current[key]}
          aria-invalid={!!error}
          aria-describedby={error ? `ro-${key}-error` : undefined}
          onChange={(e) => apply({ ...current, [key]: e.currentTarget.value })}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
  return (
    <section class="ro-card ro-search" data-differs={differs}>
      <div class="ro-card-head">
        <span class="ro-label">Distance and climbing</span>
        <span class="ro-scope">
          {differs ? 'For this search' : 'Your usual preferences'}
        </span>
      </div>
      {summary && <span class="ro-summary">{summary}</span>}
      <div class="ro-pref-group">
        <span class="ro-sublabel">Preferred distance</span>
        <Segmented
          label="Preferred distance"
          options={[
            { value: 'none', label: 'No preference' },
            { value: 'range', label: 'Choose a range' },
          ]}
          value={current.mode}
          onChange={(mode) => apply({ ...current, mode })}
        />
        {ranged && (
          <>
            <div class="ro-range-row">
              {field('from', 'From', check.fromError)}
              {field('to', 'To', check.toError)}
              <div class="ro-col ro-sublabel" style={{ gap: '4px' }}>
                Units
                <Segmented
                  label="Units"
                  options={[
                    { value: 'km', label: 'km' },
                    { value: 'mi', label: 'mi' },
                  ]}
                  value={unit}
                  onChange={(next) => {
                    if (next === unit) return;
                    send({ type: 'setUnit', unit: next });
                    apply(
                      {
                        ...current,
                        from: convert(current.from, unit, next),
                        to: convert(current.to, unit, next),
                      },
                      next,
                    );
                  }}
                />
              </div>
            </div>
            {check.fromError && (
              <span id="ro-from-error" class="ro-error" role="alert">
                From: {check.fromError}
              </span>
            )}
            {check.toError && (
              <span id="ro-to-error" class="ro-error" role="alert">
                To: {check.toError}
              </span>
            )}
            <div class="ro-scale" aria-hidden="true">
              <div>
                {km && (
                  <span
                    class="ro-band"
                    style={{
                      left: at(km[0]),
                      width: `calc(${at(km[1])} - ${at(km[0])})`,
                    }}
                  />
                )}
                {routes.map((route) => {
                  const x = route.distanceM / 1000;
                  return (
                    <span
                      key={route.id}
                      class="ro-dot"
                      data-in={!!km && x >= km[0] && x <= km[1]}
                      title={`${route.name} · ${unitLabel(x, unit)}`}
                      style={{ left: at(x) }}
                    />
                  );
                })}
              </div>
              <div class="ro-axis">
                <span>0</span>
                <span>{unitLabel(max / 2, unit)}</span>
                <span>{unitLabel(max, unit)}</span>
              </div>
            </div>
            <span class="ro-hint">
              Rides within this range are equally suitable. We'll still consider
              other distances when their conditions are better.
            </span>
          </>
        )}
      </div>
      <div class="ro-pref-group">
        <span class="ro-sublabel">Climbing</span>
        <Segmented
          label="Climbing"
          options={CLIMBING}
          value={current.climbing}
          onChange={(climbing) => apply({ ...current, climbing })}
        />
      </div>
      {differs && (
        <div class="ro-search-actions">
          <button
            type="button"
            class="ro-secondary"
            disabled={ranged && !check.km}
            onClick={() => {
              setSearch(null);
              send({ type: 'saveUsual', search: current });
            }}
          >
            Save as usual preferences
          </button>
          <button
            type="button"
            class="ro-link"
            onClick={() => {
              setSearch(null);
              send({ type: 'setSearch', search: null });
            }}
          >
            Use usual
          </button>
        </div>
      )}
    </section>
  );
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Native radios like the Days control: arrow keys move between the two units.
const UnitSwitch = <K extends keyof Units>(props: {
  label: string;
  name: K;
  value: Units[K];
  options: Units[K][];
}) => (
  <div class="ro-unit-row">
    {props.label}
    <div
      class="ro-unit-switch"
      role="radiogroup"
      aria-label={`${props.label} unit`}
    >
      {props.options.map((option) => (
        <label key={option}>
          <input
            type="radio"
            name={`ro-unit-${props.name}`}
            checked={option === props.value}
            onChange={() =>
              send({ type: 'setUnits', units: { [props.name]: option } })
            }
          />
          {option}
        </label>
      ))}
    </div>
  </div>
);

const PrefsTab = ({ view }: { view: View }) => {
  const { user, local, units: u } = view.state;
  const levels = user?.preferenceLevels ?? DEFAULT_LEVELS;
  // Edits sit on top of the synced profile until the background echoes them back.
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [windOpen, setWindOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  if (!user) return null;
  const draft = { ...draftFrom(user.settings.preferences, local), ...edits };
  // Not the technical settings.weather: both saved Met Office products are one choice.
  const source = user.weatherProviderId ?? '';
  const listed = view.state.providers.filter(
    (p) => p.configured || p.id === source,
  );
  // A custom policy has no choice: show it rather than overwrite it.
  const sources = listed.some((p) => p.id === source)
    ? listed
    : [...listed, { id: source, name: source || 'Custom' }];
  const edit = (change: Partial<Draft>) => {
    const next = { ...draft, ...change };
    setEdits((current) => ({ ...current, ...change }));
    send({ type: 'savePreferences', preferences: draftPatch(next) });
    send({ type: 'setLocal', local: draftLocal(next) });
  };
  const temp = (c: number) => `${degrees(c, u)}${u.temperature}`;
  const month = new Date().getMonth();
  const monthly = draft.floorMode === 'monthly';
  const limits = [
    {
      label: 'Colder than',
      on: draft.floorOn,
      toggle: () => edit({ floorOn: !draft.floorOn }),
      text: monthly ? 'Varies by month' : temp(draft.floorFixedC),
      stepper: !monthly && (
        <Stepper
          label="colder than"
          text={temp(draft.floorFixedC)}
          value={draft.floorFixedC}
          min={-10}
          max={20}
          step={1}
          onChange={(floorFixedC) => edit({ floorFixedC })}
        />
      ),
    },
    {
      label: 'Hotter than',
      on: draft.heatOn,
      toggle: () => edit({ heatOn: !draft.heatOn }),
      text: temp(draft.heatC),
      stepper: (
        <Stepper
          label="hotter than"
          text={temp(draft.heatC)}
          value={draft.heatC}
          min={15}
          max={40}
          step={1}
          onChange={(heatC) => edit({ heatC })}
        />
      ),
    },
    {
      label: 'Rain chance above',
      on: draft.rainOn,
      toggle: () => edit({ rainOn: !draft.rainOn }),
      text: `${draft.rainPct}%`,
      stepper: (
        <Stepper
          label="rain chance above"
          text={`${draft.rainPct}%`}
          value={draft.rainPct}
          min={0}
          max={100}
          step={10}
          onChange={(rainPct) => edit({ rainPct })}
        />
      ),
    },
    {
      label: 'Gusts above',
      on: draft.gustOn,
      toggle: () => edit({ gustOn: !draft.gustOn }),
      text: speed(draft.gustKph, u),
      stepper: (
        <Stepper
          label="gusts above"
          text={speed(draft.gustKph, u)}
          value={draft.gustKph}
          min={10}
          max={80}
          step={5}
          onChange={(gustKph) => edit({ gustKph })}
        />
      ),
    },
  ];
  const months = draft.floorMonthsC;
  const setMonth = (i: number, value: number) =>
    edit({ floorMonthsC: months.map((v, j) => (j === i ? value : v)) });
  return (
    <>
      <DistanceCard view={view} />
      <RecentlyRiddenCard view={view} />
      <section class="ro-card">
        <div class="ro-card-head">
          <span class="ro-label">Ideal temperature</span>
          <span class="ro-value" style={{ fontSize: '14px' }}>
            {degrees(draft.comfortMinC, u)}° – {temp(draft.comfortMaxC)}
          </span>
        </div>
        <div class="ro-temp-sliders">
          From
          <input
            class="ro-range"
            type="range"
            min={-5}
            max={30}
            value={draft.comfortMinC}
            aria-label="Ideal temperature from"
            aria-describedby="ro-temperature-help"
            aria-valuetext={temp(draft.comfortMinC)}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              edit({
                comfortMinC: v,
                comfortMaxC: Math.max(draft.comfortMaxC, v),
              });
            }}
          />
          To
          <input
            class="ro-range"
            type="range"
            min={0}
            max={35}
            value={draft.comfortMaxC}
            aria-label="Ideal temperature to"
            aria-describedby="ro-temperature-help"
            aria-valuetext={temp(draft.comfortMaxC)}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              edit({
                comfortMaxC: v,
                comfortMinC: Math.min(draft.comfortMinC, v),
              });
            }}
          />
        </div>
        <p id="ro-temperature-help" class="ro-help">
          All temperatures in this range are equally comfortable.
        </p>
      </section>
      <section class="ro-card" style={{ gap: '14px' }}>
        <div class="ro-pref-group">
          <span class="ro-label">Sunshine</span>
          <Segmented
            label="Sunshine"
            value={levels.sunshine === 'custom' ? null : levels.sunshine}
            onChange={(sunshine) =>
              send({ type: 'setLevels', levels: { sunshine } })
            }
            options={[
              { value: 'dont-mind', label: "Don't mind" },
              { value: 'nice', label: 'Nice to have' },
              { value: 'important', label: 'Important' },
            ]}
          />
        </div>
        <div class="ro-pref-group">
          <span class="ro-label">Rain</span>
          <Segmented
            label="Rain"
            // ponytail: 'Strongly prefer dry' (avoid) was dropped from the design; it shows as Prefer dry.
            value={
              levels.rain === 'custom'
                ? null
                : levels.rain === 'dont-mind'
                  ? 'dont-mind'
                  : 'light-ok'
            }
            onChange={(rain) => send({ type: 'setLevels', levels: { rain } })}
            options={[
              { value: 'dont-mind', label: "Don't mind" },
              { value: 'light-ok', label: 'Prefer dry' },
            ]}
          />
        </div>
      </section>
      <section class="ro-card" style={{ gap: '12px' }}>
        <button
          type="button"
          class="ro-expander"
          aria-expanded={windOpen}
          onClick={() => setWindOpen(!windOpen)}
        >
          <span class="ro-col">
            <span class="ro-label">Wind preferences</span>
            <span class="ro-hint">
              {draft.preferTailwind ? 'Prefer a tailwind' : 'Prefer calm'} ·
              headwind up to {speed(draft.headKph, u)} · crosswind up to{' '}
              {speed(draft.crossKph, u)} · gusts up to{' '}
              {speed(draft.gustComfortKph, u)}
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {windOpen && (
          <div class="ro-divided">
            <div class="ro-pref-group">
              <span class="ro-sublabel">Ideal wind</span>
              <div
                class="ro-unit-switch"
                role="radiogroup"
                aria-label="Ideal wind"
              >
                {(
                  [
                    [false, 'Calm'],
                    [true, 'Tailwind'],
                  ] as const
                ).map(([preferTailwind, label]) => (
                  <label key={label}>
                    <input
                      type="radio"
                      name="ro-ideal-wind"
                      checked={draft.preferTailwind === preferTailwind}
                      onChange={() => edit({ preferTailwind })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <span class="ro-hint">
                {draft.preferTailwind
                  ? "Rides with the wind behind you rank higher, even when it's breezier."
                  : "Rides with the least wind rank highest. A tailwind doesn't earn extra points."}
              </span>
            </div>
            {(
              [
                ['Headwind comfort', 'headKph'],
                ['Crosswind comfort', 'crossKph'],
                ['Gust comfort', 'gustComfortKph'],
              ] as const
            ).map(([label, key]) => (
              <div key={key} class="ro-pref-group">
                <div class="ro-card-head">
                  <span class="ro-sublabel">{label}</span>
                  <span class="ro-value">up to {speed(draft[key], u)}</span>
                </div>
                <input
                  class="ro-range"
                  type="range"
                  min={5}
                  max={key === 'gustComfortKph' ? 100 : 50}
                  value={draft[key]}
                  aria-label={label}
                  aria-valuetext={speed(draft[key], u)}
                  onInput={(e) =>
                    edit({ [key]: Number(e.currentTarget.value) })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>
      <section class="ro-card ro-limits">
        <span class="ro-label">Skip rides when</span>
        {limits.map((limit, i) => (
          <div key={limit.label} class="ro-limit">
            <div class="ro-switch-row">
              <span>{limit.label}</span>
              <span class="ro-limit-value" data-on={limit.on}>
                {limit.on ? limit.text : 'No limit'}
              </span>
              <Switch
                on={limit.on}
                label={`${limit.on ? 'Remove' : 'Set'} limit: ${limit.label}`}
                onClick={limit.toggle}
              />
            </div>
            {limit.on && i === 0 && (
              <Segmented
                label="Temperature limit"
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'monthly', label: 'Varies by month' },
                ]}
                value={draft.floorMode}
                onChange={(floorMode) => edit({ floorMode })}
              />
            )}
            {limit.on && limit.stepper}
            {limit.on && i === 0 && monthly && (
              <>
                <div class="ro-months" aria-hidden="true">
                  {months.map((v, m) => (
                    <div
                      key={MONTHS[m]}
                      title={`${MONTHS[m]}: ${degrees(v, u)}°`}
                      data-now={m === month}
                    >
                      <span style={{ height: `${8 + (v + 5) * 1.6}px` }} />
                      {MONTHS[m][0]}
                    </div>
                  ))}
                </div>
                <div class="ro-card-head">
                  <span class="ro-hint">
                    {MONTHS[month]} {degrees(months[month], u)}° ·{' '}
                    {degrees(Math.min(...months), u)}° to{' '}
                    {degrees(Math.max(...months), u)}° across the year
                  </span>
                  <button
                    type="button"
                    class="ro-small"
                    onClick={() => setMonthsOpen(!monthsOpen)}
                  >
                    {monthsOpen ? 'Done' : 'Edit months'}
                  </button>
                </div>
                {monthsOpen && (
                  <div class="ro-month-grid">
                    {months.map((v, m) => (
                      <div key={MONTHS[m]} data-now={m === month}>
                        {MONTHS[m]}
                        <Stepper
                          label={MONTHS[m]}
                          text={`${degrees(v, u)}°`}
                          value={v}
                          min={-10}
                          max={20}
                          step={1}
                          onChange={(value) => setMonth(m, value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </section>
      <section class="ro-card">
        <span class="ro-label">Weather data</span>
        <label class="ro-sublabel ro-col" style={{ gap: '4px' }}>
          Forecast provider
          <select
            class="ro-select"
            value={source}
            disabled={view.state.syncing}
            onChange={(e) =>
              send({ type: 'setWeather', providerId: e.currentTarget.value })
            }
          >
            {sources.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div class="ro-retrieved">
          <span />
          Forecast retrieved
          <span>{view.retrieved ? `${view.retrieved} today` : '—'}</span>
        </div>
      </section>
      <section class="ro-card ro-units">
        <span class="ro-label">Units</span>
        <UnitSwitch
          label="Temperature"
          name="temperature"
          value={u.temperature}
          options={['°C', '°F']}
        />
        <UnitSwitch
          label="Wind speed"
          name="wind"
          value={u.wind}
          options={['km/h', 'mph']}
        />
      </section>
      <PauseCard view={view} />
      <button
        type="button"
        class="ro-sign-out"
        onClick={() => send({ type: 'signOut' })}
      >
        Sign out
      </button>
    </>
  );
};

// Newest first, by month. A removed ride collapses with Undo; the background deletes it once the undo window passes.
const HistoryTab = ({ view }: { view: View }) => {
  const { rides, ridesCursor, pendingDeletes } = view.state;
  const list = [...rides].sort(newest);
  if (!list.length)
    return (
      <span class="ro-empty">
        No rides yet. When a window you planned ends, Ride On asks whether you
        rode it.
      </span>
    );
  const labelled = new Set<string>();
  return (
    <>
      {list.map((ride) => {
        const month = monthLabel(ride.riddenOn, view.today);
        const label = !labelled.has(month) && labelled.add(month);
        const gone = pendingDeletes.some((d) => d.id === ride.id);
        return (
          <Fragment key={ride.id}>
            {label && <span class="ro-month">{month}</span>}
            {gone ? (
              <div class="ro-history ro-removed">
                <span>Ride removed</span>·
                <button
                  type="button"
                  class="ro-link"
                  onClick={() => send({ type: 'undoDelete', id: ride.id })}
                >
                  Undo
                </button>
              </div>
            ) : (
              <article class="ro-history">
                <div class="ro-history-head">
                  <span class="ro-history-name">{ride.route.name}</span>
                  {ride.riddenOn === view.today && (
                    <span class="ro-tag">Ridden today</span>
                  )}
                  <CloseButton
                    title="Remove ride"
                    onClick={() => send({ type: 'deleteRide', id: ride.id })}
                  />
                </div>
                <span class="ro-history-line">{rideLine(ride)}</span>
              </article>
            )}
          </Fragment>
        );
      })}
      {ridesCursor && (
        <button
          type="button"
          class="ro-link ro-choose"
          onClick={() => send({ type: 'moreRides' })}
        >
          Show older rides
        </button>
      )}
    </>
  );
};

const RecentlyRiddenCard = ({ view }: { view: View }) => {
  const { user } = view.state;
  if (!user) return null;
  const recent = user.settings.preferences.recentRides;
  const days = recent?.lookbackDays ?? 28;
  return (
    <section class="ro-card ro-recent">
      <span class="ro-label">Recently ridden routes</span>
      <Segmented
        label="Recently ridden routes"
        options={[
          { value: 'neutral', label: 'Happy to repeat' },
          { value: 'prefer-variety', label: 'Prefer variety' },
        ]}
        value={recent?.mode ?? 'neutral'}
        onChange={(next) =>
          send({
            type: 'savePreferences',
            preferences: { recentRides: { mode: next } },
          })
        }
      />
      <p class="ro-help">
        Routes that share roads with rides from{' '}
        {days === 28 ? 'the last 4 weeks' : `the last ${days} days`} score a
        little lower. The effect fades as the ride gets older.
      </p>
    </section>
  );
};

const SyncFooter = ({ view }: { view: View }) => {
  const { syncing, syncedAt, syncError } = view.state;
  return (
    <div
      class="ro-sync"
      role="status"
      title={
        syncError ??
        (syncedAt
          ? `Last synced Today, ${clock(syncedAt, view.timeZone)}`
          : undefined)
      }
    >
      {syncError ? null : syncing ? (
        <span class="ro-sync-dot" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="7" fill="#7ba62a" />
          <path
            d="M4 7.2l2 2 4-4.4"
            fill="none"
            stroke="#fff"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      )}
      {syncError ? 'Not synced' : syncing ? 'Syncing…' : 'Synced'}
    </div>
  );
};

const App = () => {
  const view = useView();
  const [tab, setTab] = useState<Tab>('rides');
  const requested = view?.state.popupTab;
  // The page asked for a tab (window button, sign-in strip): honour it once.
  useEffect(() => {
    if (!requested) return;
    setTab(requested);
    send({ type: 'setTab', tab: null });
  }, [requested]);
  useEffect(() => {
    send({ type: 'refresh' });
  }, []);
  if (!view) return null;
  if (view.state.auth !== 'signed-in')
    return (
      <div class="ro-root ro-panel">
        <SignedOut view={view} />
      </div>
    );
  return (
    <div class="ro-root ro-panel">
      <header class="ro-panel-head">
        <div class="ro-brand">
          <img src={iconUrl()} alt="" />
          <div class="ro-brand-text">
            <span>Ride On</span>
            <span>for cycle.travel</span>
          </div>
          {view.paused && (
            <span class="ro-paused-pill">
              {view.paused.until
                ? `Paused until ${weekday(view.paused.until)} ${dayOfMonth(view.paused.until)}`
                : 'Paused'}
            </span>
          )}
        </div>
        <div class="ro-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {view.state.error && (
        <div style={{ padding: '10px 14px 0', flex: 'none' }}>
          <ErrorChip view={view} />
        </div>
      )}
      <div class="ro-scroll">
        <div
          class="ro-stack"
          style={{ gap: tab === 'rides' ? '10px' : '12px' }}
        >
          {tab === 'rides' && (
            <RidesTab view={view} onChoose={() => setTab('when')} />
          )}
          {tab === 'when' && <WhenTab view={view} />}
          {tab === 'prefs' && <PrefsTab view={view} />}
          {tab === 'history' && <HistoryTab view={view} />}
        </div>
      </div>
      {tab === 'prefs' && <SyncFooter view={view} />}
    </div>
  );
};

injectFonts();
render(<App />, document.getElementById('app') as HTMLElement);
