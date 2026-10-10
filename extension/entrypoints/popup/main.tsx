import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { send, type Tab } from '../../lib/state';
import { MAX_TRACKED } from '../../lib/types';
import {
  AppleMark,
  CardLines,
  CloseButton,
  DayPresets,
  ErrorChip,
  GoogleMark,
  iconUrl,
  injectFonts,
  Rank,
  Score,
  Segmented,
  useView,
  type View,
} from '../../ui/components';
import {
  type Draft,
  dayOfMonth,
  daysLabel,
  draftFromUser,
  hours,
  pickDay,
  preferencesPatch,
  qualityColour,
  resolveDays,
  timeLabel,
  weekday,
} from '../../ui/format';
import '../../ui/tokens.css';

const TABS: [Tab, string][] = [
  ['when', 'When'],
  ['rides', 'Rides'],
  ['prefs', 'Preferences'],
];

const SignedOut = ({ view }: { view: View }) => {
  const { auth, signingInWith, signInError } = view.state;
  const busy = auth === 'signing-in';
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
                disabled={busy}
                onClick={() => send({ type: 'signIn', provider: id })}
              >
                <Mark />
              </button>
            ))}
          </div>
          {signInError && (
            <span class="ro-warn-chip" role="alert">
              {signInError}
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

const TIME_PRESETS = [
  { value: '06:00-12:00', label: 'Morning' },
  { value: '12:00-18:00', label: 'Afternoon' },
  { value: '06:00-20:00', label: 'All day' },
];
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const pct = (h: number) => `${((h - 5) / 16) * 100}%`;

const WhenTab = ({ view }: { view: View }) => {
  const { planning, horizon, today } = view;
  const recs = view.state.recs;
  const range = resolveDays(planning.days, horizon);
  const setWindow = (start: string, end: string) =>
    send({
      type: 'setPlanning',
      planning: { ...planning, window: { start, end } },
    });
  const start = Number(planning.window.start.slice(0, 2));
  const end = Number(planning.window.end.slice(0, 2));
  const daylight = recs?.days?.find((d) => d.date === range?.[0])?.daylight;
  const best = view.cards.slice(0, 3);
  return (
    <>
      <div class="ro-stack" style={{ flex: 'none', paddingBottom: 0 }}>
        <section class="ro-card">
          <div class="ro-card-head">
            <span class="ro-label">Days</span>
            <span class="ro-value">
              {daysLabel(planning.days, horizon, today)}
            </span>
          </div>
          <DayPresets view={view} />
          <fieldset
            class="ro-days"
            style={{ '--ro-day-count': horizon.length }}
            aria-label="Pick days"
          >
            {horizon.map((date) => {
              const day = recs?.days?.find((d) => d.date === date);
              return (
                <button
                  key={date}
                  type="button"
                  class="ro-day"
                  aria-pressed={!!range && date >= range[0] && date <= range[1]}
                  onClick={() =>
                    send({
                      type: 'setPlanning',
                      planning: { ...planning, days: pickDay(range, date) },
                    })
                  }
                >
                  <span>{date === today ? 'Today' : weekday(date)}</span>
                  <span>{dayOfMonth(date)}</span>
                  <span>
                    {day?.temperatureMaxC == null
                      ? ''
                      : `${Math.round(day.temperatureMaxC)}°`}
                  </span>
                  <span class="ro-quality">
                    {day?.quality != null && (
                      <span
                        style={{
                          width: `${day.quality}%`,
                          background: qualityColour(day.quality),
                        }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </fieldset>
        </section>
        <section class="ro-card">
          <div class="ro-card-head">
            <span class="ro-label">Time</span>
            <span class="ro-value">{timeLabel(planning)}</span>
          </div>
          <Segmented
            label="Time"
            options={TIME_PRESETS}
            value={`${planning.window.start}-${planning.window.end}`}
            onChange={(value) => {
              const [s, e] = value.split('-');
              setWindow(s, e);
            }}
          />
          <div class="ro-timeline" aria-hidden="true">
            <div class="ro-timeline-bar">
              {daylight && (
                <div
                  class="ro-daylight"
                  style={{
                    left: pct(
                      Math.max(5, hours(daylight.sunrise, view.timeZone)),
                    ),
                    right: `calc(100% - ${pct(Math.min(21, hours(daylight.sunset, view.timeZone)))})`,
                  }}
                />
              )}
              <div
                class="ro-selected"
                style={{ left: pct(start), right: `calc(100% - ${pct(end)})` }}
              />
            </div>
            <div class="ro-axis">
              {['05', '09', '13', '17', '21'].map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
          </div>
          <div class="ro-times">
            <select
              class="ro-select"
              aria-label="Start"
              value={start}
              onChange={(e) => {
                const s = Number(e.currentTarget.value);
                setWindow(hour(s), hour(Math.max(end, s + 1)));
              }}
            >
              {Array.from({ length: 15 }, (_, i) => i + 5).map((h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
            –
            <select
              class="ro-select"
              aria-label="End"
              value={end}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                setWindow(hour(Math.min(start, v - 1)), hour(v));
              }}
            >
              {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
      <div class="ro-scroll ro-loading" data-loading={view.state.loading}>
        <div class="ro-stack" style={{ gap: '8px' }}>
          <span class="ro-eyebrow">Best in window</span>
          {best.length === 0 && (
            <span class="ro-empty">
              Consider rides on your cycle.travel Journeys page.
            </span>
          )}
          {best.map((card) => (
            <div key={card.routeId} class="ro-best">
              <Rank card={card} />
              <div class="ro-col">
                <span class="ro-name">{card.name}</span>
                {card.state === 'ok' ? (
                  <span class="ro-when">
                    {card.day} · {card.window}
                  </span>
                ) : (
                  <span class="ro-when" style={{ color: '#8a4b17' }}>
                    {card.state === 'pending'
                      ? 'Checking the forecast…'
                      : 'No good window'}
                  </span>
                )}
              </div>
              <Score card={card} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

const RidesTab = ({ view }: { view: View }) => (
  <div class="ro-scroll ro-loading" data-loading={view.state.loading}>
    <div class="ro-stack" style={{ gap: '10px' }}>
      {view.cards.length === 0 && (
        <span class="ro-empty">
          No rides under consideration. Add some from your cycle.travel Journeys
          page.
        </span>
      )}
      {view.cards.map((card) => (
        <div key={card.routeId} class="ro-ride">
          <Rank card={card} />
          <div class="ro-col">
            <span class="ro-name">{card.name}</span>
            <CardLines card={card}>No window meets your minimums.</CardLines>
          </div>
          <Score card={card} />
          <CloseButton
            title="Stop considering"
            onClick={() => send({ type: 'untrack', routeId: card.routeId })}
          />
        </div>
      ))}
      <span class="ro-count">
        {view.cards.length} / {MAX_TRACKED}
      </span>
    </div>
  </div>
);

const Stepper = (props: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) => (
  <div class="ro-stepper-row">
    {props.label}
    <div class="ro-stepper">
      <button
        type="button"
        aria-label={`Lower ${props.label.toLowerCase()}`}
        disabled={props.value <= props.min}
        onClick={() =>
          props.onChange(Math.max(props.min, props.value - props.step))
        }
      >
        −
      </button>
      <output>
        {props.value} {props.unit}
      </output>
      <button
        type="button"
        aria-label={`Raise ${props.label.toLowerCase()}`}
        disabled={props.value >= props.max}
        onClick={() =>
          props.onChange(Math.min(props.max, props.value + props.step))
        }
      >
        +
      </button>
    </div>
  </div>
);

const PrefsTab = ({ view }: { view: View }) => {
  const user = view.state.user;
  // Edits sit on top of the saved profile, so untouched fields follow the server.
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const base = draftFromUser(user, view.today);
  const draft = { ...base, ...edits };
  const patch = preferencesPatch(base, draft);
  const dirty = Object.keys(patch).length > 0;
  const edit = (change: Partial<Draft>) => {
    setError(null);
    setEdits((current) => ({ ...current, ...change }));
  };
  const save = async () => {
    setSaving(true);
    const result = await send({ type: 'savePreferences', patch });
    setSaving(false);
    if (result.error) setError(result.error);
    else setEdits({});
  };
  return (
    <>
      <div class="ro-scroll">
        <div class="ro-stack">
          <section class="ro-card">
            <div class="ro-card-head">
              <span class="ro-label">Ideal temperature</span>
              <span class="ro-value" style={{ fontSize: '14px' }}>
                {draft.comfortMinC}° – {draft.comfortMaxC}°C
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
                onInput={(e) => {
                  const v = Number(e.currentTarget.value);
                  edit({
                    comfortMaxC: v,
                    comfortMinC: Math.min(draft.comfortMinC, v),
                  });
                }}
              />
            </div>
          </section>
          <section class="ro-card" style={{ gap: '14px' }}>
            <div class="ro-pref-group">
              <span class="ro-label">Sunshine</span>
              <Segmented
                label="Sunshine"
                value={draft.sunshine}
                onChange={(sunshine) => edit({ sunshine })}
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
                value={draft.rain}
                onChange={(rain) => edit({ rain })}
                options={[
                  { value: 'avoid', label: 'Avoid any' },
                  { value: 'light-ok', label: 'Light is fine' },
                  { value: 'dont-mind', label: "Don't mind" },
                ]}
              />
            </div>
            <div class="ro-pref-group">
              <span class="ro-label">Climbing</span>
              <Segmented
                label="Climbing"
                value={draft.climbing}
                onChange={(climbing) => edit({ climbing })}
                options={[
                  { value: 'flatter', label: 'Flatter' },
                  { value: 'neutral', label: 'No preference' },
                  { value: 'hillier', label: 'Hillier' },
                ]}
              />
            </div>
          </section>
          <section class="ro-card">
            <div class="ro-card-head">
              <span class="ro-label">Comfortable wind</span>
              <span class="ro-value">up to {draft.windKph} km/h</span>
            </div>
            <input
              class="ro-range"
              type="range"
              min={5}
              max={50}
              value={draft.windKph}
              aria-label="Comfortable wind"
              onInput={(e) => edit({ windKph: Number(e.currentTarget.value) })}
            />
          </section>
          <section class="ro-card" style={{ gap: '4px' }}>
            <span class="ro-label" style={{ paddingBottom: '6px' }}>
              Minimum conditions
            </span>
            <Stepper
              label="Colder than"
              unit="°C"
              min={-10}
              max={20}
              step={1}
              value={draft.colderThanC}
              onChange={(colderThanC) => edit({ colderThanC })}
            />
            <Stepper
              label="Rain chance above"
              unit="%"
              min={0}
              max={100}
              step={10}
              value={draft.rainAbovePct}
              onChange={(rainAbovePct) => edit({ rainAbovePct })}
            />
            <Stepper
              label="Gusts above"
              unit="km/h"
              min={10}
              max={80}
              step={5}
              value={draft.gustsAboveKph}
              onChange={(gustsAboveKph) => edit({ gustsAboveKph })}
            />
          </section>
          <button
            type="button"
            class="ro-sign-out"
            onClick={() => send({ type: 'signOut' })}
          >
            Sign out
          </button>
        </div>
      </div>
      <div class="ro-save">
        <span role="status" style={error ? { color: '#8a4b17' } : undefined}>
          {error ??
            (saving
              ? 'Saved · rankings updating'
              : dirty
                ? 'Unsaved changes'
                : 'Synced with your Ride On profile')}
        </span>
        <button
          type="button"
          class="ro-primary"
          disabled={!dirty || saving}
          onClick={save}
        >
          Save preferences
        </button>
      </div>
    </>
  );
};

const App = () => {
  const view = useView();
  const [tab, setTab] = useState<Tab>('when');
  const requested = view?.state.popupTab;
  // The page asked for a tab (time button, sign-in strip): honour it once.
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
  const { planning, horizon, today } = view;
  return (
    <div class="ro-root ro-panel">
      <header class="ro-panel-head">
        <div class="ro-brand">
          <img src={iconUrl()} alt="" />
          <div class="ro-brand-text">
            <span>Ride On</span>
            <span>for cycle.travel</span>
          </div>
          <button
            type="button"
            class="ro-window-badge"
            onClick={() => setTab('when')}
          >
            {daysLabel(planning.days, horizon, today)} · {timeLabel(planning)}
          </button>
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
      {tab === 'when' && <WhenTab view={view} />}
      {tab === 'rides' && <RidesTab view={view} />}
      {tab === 'prefs' && <PrefsTab view={view} />}
    </div>
  );
};

injectFonts();
render(<App />, document.getElementById('app') as HTMLElement);
