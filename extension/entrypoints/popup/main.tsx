import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Planning, type Search, send, type Tab } from '../../lib/state';
import type { Climbing } from '../../lib/types';
import {
  AppleMark,
  Attribution,
  Banners,
  CoverageWarn,
  chooseAvailableDates,
  ErrorChip,
  Expired,
  GoogleMark,
  iconUrl,
  injectFonts,
  RideCard,
  Segmented,
  useView,
  type View,
} from '../../ui/components';
import {
  clock,
  convert,
  coverageText,
  type Draft,
  dayOfMonth,
  daySummary,
  draftFrom,
  draftLocal,
  draftPatch,
  hours,
  PRESETS,
  pickDay,
  providerIds,
  qualityColour,
  rideSummary,
  scaleMaxKm,
  searchDiffers,
  unitLabel,
  usualSearch,
  validateRange,
  weekday,
} from '../../ui/format';
import '../../ui/tokens.css';

const TABS: [Tab, string][] = [
  ['rides', 'Rides'],
  ['when', 'When'],
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

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const HOURS = Array.from({ length: 17 }, (_, i) => i + 5);
const decimal = (time: string) =>
  Number(time.slice(0, 2)) + Number(time.slice(3)) / 60;
const pct = (h: number) =>
  `${((Math.min(21, Math.max(5, h)) - 5) / 16) * 100}%`;
const width = (from: number, to: number) =>
  `${(Math.max(0, Math.min(21, to) - Math.max(5, from)) / 16) * 100}%`;

const WhenTab = ({ view }: { view: View }) => {
  const { planning, defaultPlanning, days } = view.state;
  const set = (change: Partial<Planning>) =>
    send({ type: 'setPlanning', planning: { ...planning, ...change } });
  if (!view.range)
    return (
      <Expired
        view={view}
        variant="when"
        onChoose={() => chooseAvailableDates(view)}
      />
    );
  const range = view.range;
  const coverage = coverageText(view.selected);
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
  return (
    <>
      <section class="ro-card">
        <div class="ro-card-head">
          <span class="ro-label">Days</span>
          <span class="ro-value">{view.datesText}</span>
        </div>
        <Segmented
          label="Days"
          wrap
          options={PRESETS.map(([value, label]) => ({ value, label }))}
          value={planning.days.kind === 'preset' ? planning.days.preset : null}
          onChange={(preset) => set({ days: { kind: 'preset', preset } })}
        />
        <fieldset class="ro-days" aria-label="Pick days">
          {view.strip.map((day, i) => {
            const summary = daySummary(days[day.date]);
            const morning = !!day.until && day.until <= '12:00';
            const quality =
              day.kind === 'none' || !summary
                ? 0
                : day.kind === 'partial'
                  ? summary.score / 2
                  : summary.score;
            return (
              <button
                key={day.date}
                type="button"
                class="ro-day"
                data-kind={day.kind}
                title={
                  day.kind === 'none'
                    ? 'Forecast not available yet'
                    : day.kind === 'partial'
                      ? morning
                        ? 'Morning forecast only'
                        : `Forecast up to ${day.until}`
                      : undefined
                }
                aria-pressed={day.date >= range[0] && day.date <= range[1]}
                onClick={() => set({ days: pickDay(range, day.date) })}
              >
                <span>{i === 0 ? 'Today' : weekday(day.date)}</span>
                <span>{dayOfMonth(day.date)}</span>
                <span>
                  {day.kind === 'none'
                    ? 'Not yet'
                    : day.kind === 'partial'
                      ? morning
                        ? 'AM only'
                        : `To ${day.until}`
                      : summary
                        ? `${summary.tempC}°`
                        : '–'}
                </span>
                <span class="ro-quality">
                  {summary && (
                    <span
                      style={{
                        width: `${quality}%`,
                        background: qualityColour(summary.score),
                      }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </fieldset>
        {coverage && <div class="ro-note">{coverage}</div>}
      </section>
      <section class="ro-card">
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
        type="button"
        class="ro-default"
        data-saved={saved}
        onClick={() => send({ type: 'saveDefaultPlanning' })}
      >
        <span aria-hidden="true">{saved ? '✓' : '+'}</span>
        {saved ? 'Saved as your default window' : 'Save as my default window'}
      </button>
    </>
  );
};

const RidesTab = ({ view, onChoose }: { view: View; onChoose: () => void }) => {
  let medal = 0;
  return (
    <>
      {!view.range && (
        <Expired view={view} variant="rides" onChoose={onChoose} />
      )}
      <Banners view={view} />
      {view.range && view.cards.length === 0 && (
        <span class="ro-empty">
          No rides under consideration. Add some from your cycle.travel Journeys
          page.
        </span>
      )}
      {view.cards.map((card) => (
        <RideCard
          key={card.routeId}
          card={card}
          medal={card.score !== null && medal < 3 ? medal++ : undefined}
        />
      ))}
      <CoverageWarn view={view} />
      <Attribution view={view} />
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

const PrefsTab = ({ view }: { view: View }) => {
  const { user, local } = view.state;
  // Edits sit on top of the synced profile until the background echoes them back.
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [windOpen, setWindOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  if (!user) return null;
  const draft = { ...draftFrom(user.settings.preferences, local), ...edits };
  // ponytail: a fallback chain shows as its first provider.
  const source = providerIds(user.settings.weather)[0];
  const listed = view.state.providers.filter(
    (p) => p.configured || p.id === source,
  );
  const sources = listed.some((p) => p.id === source)
    ? listed
    : [...listed, { id: source, name: source }];
  const edit = (change: Partial<Draft>) => {
    const next = { ...draft, ...change };
    setEdits((current) => ({ ...current, ...change }));
    send({ type: 'savePreferences', preferences: draftPatch(next) });
    send({ type: 'setLocal', local: draftLocal(next) });
  };
  const month = new Date().getMonth();
  const monthly = draft.floorMode === 'monthly';
  const limits = [
    {
      label: 'Colder than',
      on: draft.floorOn,
      toggle: () => edit({ floorOn: !draft.floorOn }),
      text: monthly ? 'Varies by month' : `${draft.floorFixedC}°C`,
      stepper: !monthly && (
        <Stepper
          label="colder than"
          text={`${draft.floorFixedC}°C`}
          value={draft.floorFixedC}
          min={-10}
          max={20}
          step={1}
          onChange={(floorFixedC) => edit({ floorFixedC })}
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
      text: `${draft.gustKph} km/h`,
      stepper: (
        <Stepper
          label="gusts above"
          text={`${draft.gustKph} km/h`}
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
            value={local.sunshine}
            onChange={(sunshine) =>
              send({ type: 'setLocal', local: { sunshine } })
            }
            options={[
              { value: "Don't mind", label: "Don't mind" },
              { value: 'Nice to have', label: 'Nice to have' },
              { value: 'Important', label: 'Important' },
            ]}
          />
        </div>
        <div class="ro-pref-group">
          <span class="ro-label">Rain</span>
          <Segmented
            label="Rain"
            value={local.rain}
            onChange={(rain) => send({ type: 'setLocal', local: { rain } })}
            options={[
              { value: "Don't mind", label: "Don't mind" },
              { value: 'Prefer dry', label: 'Prefer dry' },
              { value: 'Strongly prefer dry', label: 'Strongly prefer dry' },
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
              Headwind up to {draft.headKph} · crosswind up to {draft.crossKph}{' '}
              km/h
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {windOpen && (
          <div class="ro-divided">
            {(
              [
                ['Headwind comfort', 'headKph'],
                ['Crosswind comfort', 'crossKph'],
              ] as const
            ).map(([label, key]) => (
              <div key={key} class="ro-pref-group">
                <div class="ro-card-head">
                  <span class="ro-sublabel">{label}</span>
                  <span class="ro-value">up to {draft[key]} km/h</span>
                </div>
                <input
                  class="ro-range"
                  type="range"
                  min={5}
                  max={50}
                  value={draft[key]}
                  aria-label={label}
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
        <span class="ro-label">Minimum conditions</span>
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
                      title={`${MONTHS[m]}: ${v}°`}
                      data-now={m === month}
                    >
                      <span style={{ height: `${8 + (v + 5) * 1.6}px` }} />
                      {MONTHS[m][0]}
                    </div>
                  ))}
                </div>
                <div class="ro-card-head">
                  <span class="ro-hint">
                    {MONTHS[month]} {months[month]}° · {Math.min(...months)}° to{' '}
                    {Math.max(...months)}° across the year
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
                          text={`${v}°`}
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
        <Attribution view={view} />
      </section>
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
      <div class="ro-scroll ro-loading" data-loading={view.state.loading}>
        <div
          class="ro-stack"
          style={{ gap: tab === 'rides' ? '10px' : '12px' }}
        >
          {tab === 'rides' && (
            <RidesTab
              view={view}
              onChoose={() => {
                chooseAvailableDates(view);
                setTab('when');
              }}
            />
          )}
          {tab === 'when' && <WhenTab view={view} />}
          {tab === 'prefs' && <PrefsTab view={view} />}
        </div>
      </div>
      {tab === 'prefs' && <SyncFooter view={view} />}
    </div>
  );
};

injectFonts();
render(<App />, document.getElementById('app') as HTMLElement);
