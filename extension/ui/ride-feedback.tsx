// Ride feedback and Tailored Rides in the popup: the check-in invite, the feedback form, the
// summary on each History ride and the card in Preferences. Copy and rules live in feedback.ts.
import { Fragment } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { send, type Tab, type WriteFailure } from '../lib/state';
import type {
  FeedbackFactor,
  LearningFactor,
  LearningProfile,
  Ride,
  RideExperience,
} from '../lib/types';
import { Segmented, Switch, type View } from './components';
import {
  COMFORT,
  checkTiming,
  ENJOYMENT,
  FACTOR_NAMES,
  FOLLOWED,
  feedbackLine,
  LEVELS,
  level,
  MAX_REASONS,
  NEEDED,
  REASONS,
  reasonLabel,
  resetWhen,
  rideDuration,
  rides,
  thisRide,
  weatherCheck,
} from './feedback';
import { clock, localDate, shortDate } from './format';

type Saved = NonNullable<Ride['experience']>;
type Timing = NonNullable<RideExperience['timing']>;
type Reason = NonNullable<RideExperience['feedback']>['reasons'][number];

const goTo = (tab: Tab) => send({ type: 'setTab', tab });
// Preact renders after a microtask, so focus moves once the element exists.
const later = (fn: () => void) => setTimeout(fn, 0);

// Loads the Tailored Rides profile when nothing has it yet; failed if that load didn't work.
const useLearning = (learning: LearningProfile | null, wanted = true) => {
  const [failed, setFailed] = useState(false);
  const load = () =>
    send({ type: 'loadLearning' })
      .then((result) => setFailed(!!result.error))
      .catch(() => setFailed(true));
  useEffect(() => {
    if (wanted && !learning) void load();
  }, [learning, wanted]);
  return { failed, retry: load };
};

// Clears a short status line after four seconds.
const useToast = () => {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setText(''), 4000);
    return () => clearTimeout(timer);
  }, [text]);
  return [text, setText] as const;
};

const Arrow = ({ up }: { up: boolean }) => (
  <svg class="ro-fb-arrow" viewBox="0 0 24 24" aria-hidden="true">
    <path d={up ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'} />
  </svg>
);

const Tick = () => (
  <svg class="ro-fb-tick" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const Problem = (props: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) => (
  <div class="ro-banner ro-nomatch ro-fb-problem" role="alert">
    <strong>{props.title}</strong>
    <span>{props.text}</span>
    <button type="button" class="ro-link" onClick={props.onAction}>
      {props.action}
    </button>
  </div>
);

// An inline confirmation. Cancel takes focus, so Enter or Escape never destroys anything.
const Confirm = (props: {
  title: string;
  text: string;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      class="ro-fb-confirm"
      role="alertdialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        props.onCancel();
      }}
    >
      <strong id={`${id}-t`}>{props.title}</strong>
      <span id={`${id}-d`}>{props.text}</span>
      <div class="ro-fb-actions">
        <button type="button" class="ro-fb-danger" onClick={props.onConfirm}>
          {props.confirm}
        </button>
        <button
          type="button"
          class="ro-secondary"
          ref={cancel}
          onClick={props.onCancel}
        >
          {props.cancel}
        </button>
      </div>
    </div>
  );
};

// Five numbered dots as one radio group. In the form arrows choose, as radios do; on the
// invite they only move focus, because choosing there opens the form.
const Dots = (props: {
  labelledBy: string;
  words: string[];
  value: number | null;
  onPick: (value: number) => void;
  arrowsPick?: boolean;
}) => {
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent, v: number) => {
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(5, v + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(1, v - 1)
          : e.key === 'Home'
            ? 1
            : e.key === 'End'
              ? 5
              : null;
    if (next === null) return;
    e.preventDefault();
    if (props.arrowsPick && next !== props.value) props.onPick(next);
    dots.current[next - 1]?.focus();
  };
  return (
    <div
      class="ro-fb-dots"
      role="radiogroup"
      aria-labelledby={props.labelledBy}
    >
      {[1, 2, 3, 4, 5].map((v) => (
        // biome-ignore lint/a11y/useSemanticElements: a native radio can't be cleared by tapping it again, and ratings are optional.
        <button
          key={v}
          type="button"
          role="radio"
          class="ro-fb-dot"
          aria-checked={props.value === v}
          aria-label={`${v} of 5, ${props.words[v]}`}
          tabIndex={v === (props.value ?? 1) ? 0 : -1}
          ref={(el) => {
            dots.current[v - 1] = el;
          }}
          onClick={() => props.onPick(v)}
          onKeyDown={(e) => key(e, v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
};

// A rating that can be left out: tapping the chosen dot again, or Clear, unrates it.
const Rating = (props: {
  label: string;
  words: string[];
  value: number | null;
  onChange: (value: number | null) => void;
  foot?: string;
}) => {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  return (
    <div class="ro-fb-rating" ref={box}>
      <div class="ro-fb-rating-head">
        <span id={id} class="ro-fb-label">
          {props.label}
        </span>
        <span class="ro-fb-word" aria-live="polite">
          {props.value === null
            ? 'Not rated'
            : `${props.value} · ${props.words[props.value]}`}
        </span>
        {props.value !== null && (
          <button
            type="button"
            class="ro-link"
            aria-label={`Clear ${props.label}`}
            onClick={() => {
              props.onChange(null);
              later(() =>
                box.current
                  ?.querySelector<HTMLElement>('[role="radio"]')
                  ?.focus(),
              );
            }}
          >
            Clear
          </button>
        )}
      </div>
      <Dots
        labelledBy={id}
        words={props.words}
        value={props.value}
        arrowsPick
        onPick={(v) => props.onChange(props.value === v ? null : v)}
      />
      {props.foot && <p class="ro-help">{props.foot}</p>}
    </div>
  );
};

const IMPACTS: [Reason['impact'], string][] = [
  ['positive', 'Helped'],
  ['negative', 'Spoiled It'],
];

// Up to two reasons, each marked as helping or spoiling the ride. A chip opens a small menu
// after its row of three; with two chosen the others dim rather than replacing one.
const Reasons = (props: {
  value: Reason[];
  onChange: (value: Reason[]) => void;
}) => {
  const [menu, setMenu] = useState<FeedbackFactor | null>(null);
  const chips = useRef<Partial<Record<FeedbackFactor, HTMLButtonElement>>>({});
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const two = props.value.length >= MAX_REASONS;
  const chosen = props.value.find((r) => r.factor === menu);
  const close = (refocus = true) => {
    if (refocus && menu) chips.current[menu]?.focus();
    setMenu(null);
  };
  useEffect(() => {
    if (!menu) return;
    items.current[chosen?.impact === 'negative' ? 1 : 0]?.focus();
    // A tap anywhere else closes it. Safari doesn't focus buttons on click, so blur can't.
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  const choose = (impact: Reason['impact']) => {
    if (!menu) return;
    props.onChange(
      chosen
        ? props.value.map((r) => (r.factor === menu ? { ...r, impact } : r))
        : [...props.value, { factor: menu, impact }],
    );
    close();
  };
  const open = REASONS.findIndex((r) => r.factor === menu);
  const rowEnd =
    open < 0 ? -1 : Math.min(REASONS.length - 1, open - (open % 3) + 2);
  const menuKey = (e: KeyboardEvent) => {
    const all = items.current.filter((el): el is HTMLButtonElement => !!el);
    const at = all.indexOf(e.target as HTMLButtonElement);
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') setMenu(null);
    else if (step) {
      e.preventDefault();
      all[(at + step + all.length) % all.length]?.focus();
    }
  };
  return (
    <fieldset class="ro-fb-group">
      <legend class="ro-fb-label">What Made the Difference?</legend>
      <div class="ro-fb-chips" ref={box}>
        {REASONS.map((r, i) => {
          const picked = props.value.find((x) => x.factor === r.factor);
          const off = !picked && two;
          return (
            <Fragment key={r.factor}>
              <button
                type="button"
                class="ro-fb-chip"
                data-impact={picked?.impact}
                data-open={menu === r.factor || undefined}
                aria-haspopup="menu"
                aria-expanded={menu === r.factor}
                aria-disabled={off || undefined}
                aria-label={
                  r.label +
                  (picked
                    ? picked.impact === 'positive'
                      ? ', helped'
                      : ', spoiled the ride'
                    : off
                      ? ', unavailable, two reasons chosen'
                      : '')
                }
                ref={(el) => {
                  chips.current[r.factor] = el ?? undefined;
                }}
                onClick={() => {
                  if (!off) setMenu(menu === r.factor ? null : r.factor);
                }}
              >
                {picked && <Arrow up={picked.impact === 'positive'} />}
                {r.label}
              </button>
              {i === rowEnd && menu && (
                <div
                  class="ro-fb-menu"
                  role="menu"
                  aria-label={reasonLabel(menu)}
                  onKeyDown={menuKey}
                >
                  {IMPACTS.map(([impact, label], n) => (
                    <button
                      key={impact}
                      type="button"
                      role="menuitemradio"
                      aria-checked={chosen?.impact === impact}
                      class="ro-fb-menu-item"
                      data-impact={impact}
                      ref={(el) => {
                        items.current[n] = el;
                      }}
                      onClick={() => choose(impact)}
                    >
                      <Arrow up={impact === 'positive'} />
                      {label}
                    </button>
                  ))}
                  {chosen && (
                    <button
                      type="button"
                      role="menuitem"
                      class="ro-fb-menu-item"
                      ref={(el) => {
                        items.current[2] = el;
                      }}
                      onClick={() => {
                        props.onChange(
                          props.value.filter((r) => r.factor !== menu),
                        );
                        close();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <p class="ro-help" aria-live="polite">
        {two
          ? 'Two chosen. Tap one to change or remove it.'
          : 'Choose up to two. Tap a reason, then say whether it helped or spoiled the ride.'}
      </p>
    </fieldset>
  );
};

// What the form would save, in a fixed shape so a saved copy compares equal.
const snapshot = (e: RideExperience | null | undefined) =>
  JSON.stringify([
    e?.timing
      ? [
          e.timing.startTime,
          e.timing.durationMinutes,
          e.timing.precision,
          e.timing.routeFollowed,
        ]
      : null,
    e?.feedback
      ? [
          e.feedback.enjoyment,
          e.feedback.weatherComfort,
          e.feedback.reasons.map((r) => [r.factor, r.impact]),
          e.feedback.includeInLearning,
        ]
      : null,
  ]);

type FormProps = {
  ride: Ride;
  learning: LearningProfile | null;
  blank?: boolean; // the saved feedback is waiting to be removed, so start empty
  enjoyment?: number | null; // chosen on the invite
  timesOpen?: boolean; // opened from the summary's ride times Add
  loaded?: boolean; // just reloaded after a conflict
  onLoadLatest: () => Promise<boolean>;
  onSaved: () => void;
  onClose: () => void;
};

// Everything is optional. Planned times are offered, never filled in: the API keeps them apart.
const FeedbackForm = (props: FormProps) => {
  const { ride, learning } = props;
  const route = ride.route.name;
  const saved = props.blank ? null : ride.experience;
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const addTimes = useRef<HTMLButtonElement>(null);
  const notNow = useRef<HTMLButtonElement>(null);
  const [enjoyment, setEnjoyment] = useState(
    props.enjoyment ?? saved?.feedback?.enjoyment ?? null,
  );
  const [comfort, setComfort] = useState(
    saved?.feedback?.weatherComfort ?? null,
  );
  const [reasons, setReasons] = useState<Reason[]>(
    saved?.feedback?.reasons ?? [],
  );
  const [timesOpen, setTimesOpen] = useState(
    !!props.timesOpen || !!saved?.timing,
  );
  const savedMinutes = saved?.timing?.durationMinutes;
  const [start, setStart] = useState(saved?.timing?.startTime ?? '');
  const [hours, setHours] = useState(
    savedMinutes == null ? '' : String(Math.floor(savedMinutes / 60)),
  );
  const [minutes, setMinutes] = useState(
    savedMinutes == null ? '' : String(savedMinutes % 60),
  );
  const [precision, setPrecision] = useState<Timing['precision']>(
    saved?.timing?.precision ?? 'approximate',
  );
  const [followed, setFollowed] = useState<Timing['routeFollowed']>(
    saved?.timing?.routeFollowed ?? 'unknown',
  );
  const [include, setInclude] = useState(
    saved?.feedback?.includeInLearning ?? true,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WriteFailure | 'loaded' | null>(
    props.loaded ? 'loaded' : null,
  );
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (props.timesOpen) startInput.current?.focus();
    else heading.current?.focus();
  }, []);

  const t = checkTiming(
    timesOpen
      ? { start, hours, minutes }
      : { start: '', hours: '', minutes: '' },
    ride,
  );
  const partial = t.any && !t.complete;
  const rated = enjoyment !== null || comfort !== null || reasons.length > 0;
  const experience: RideExperience = {
    timing: t.complete
      ? {
          startTime: start,
          durationMinutes: t.minutes,
          precision,
          routeFollowed: followed,
        }
      : null,
    feedback: rated
      ? {
          enjoyment,
          weatherComfort: comfort,
          reasons,
          includeInLearning: include,
        }
      : null,
  };
  const canSave = (rated || t.complete) && !partial && !t.future;
  const dirty = partial || snapshot(experience) !== snapshot(saved);
  const paused = !!learning && !learning.enabled;
  const planned = ride.plan
    ? clock(ride.plan.departureAt, ride.timeZone)
    : null;
  const editTimes = (change: () => void) => {
    change();
    if (error === 'timing') setError(null);
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    // Saving over feedback that's waiting to be removed replaces it, so drop the removal.
    if (props.blank)
      await send({ type: 'undoRemoveExperience', id: ride.id }).catch(
        () => undefined,
      );
    const result = await send({
      type: 'saveRideExperience',
      id: ride.id,
      expectedVersion: ride.experienceVersion ?? 0,
      expectedRideVersion: ride.version,
      experience,
    }).catch(() => ({ error: 'offline', failure: 'offline' as const }));
    setSaving(false);
    if (result.error) setError(result.failure ?? 'offline');
    else props.onSaved();
  };
  const cancel = () => {
    if (saving) return;
    if (dirty) setDiscard(true);
    else props.onClose();
  };

  const includeFoot = !include
    ? 'This ride won’t be used to tailor your rides. Your ratings are still saved.'
    : !t.complete
      ? `Counts once you add ride times and confirm you followed ${route}.`
      : followed !== 'yes'
        ? `Only counts when you followed ${route}, so the forecast matches where you rode.`
        : comfort === null
          ? 'Counts once you rate how the weather felt.'
          : learning?.resetAt &&
              saved &&
              saved.firstSubmittedAt <= learning.resetAt
            ? 'You started afresh after this feedback was first given, so this ride won’t be used.'
            : 'Counts towards tailoring your rides. This is still being tested, so your recommendations don’t change yet.';
  const timesError = t.future
    ? `That ends at ${t.endClock}, after now. Check when you started and how long you rode.`
    : error === 'timing'
      ? 'Ride On couldn’t use that time. Check when you started and how long you rode.'
      : null;

  return (
    <form
      class="ro-fb-form"
      aria-labelledby={`${id}-h`}
      aria-busy={saving || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="ro-fb-head">
        <h3 id={`${id}-h`} class="ro-fb-title" tabIndex={-1} ref={heading}>
          How Was It?
        </h3>
        <span class="ro-help">
          {route} · {shortDate(ride.riddenOn)}
        </span>
      </div>
      {error === 'offline' && (
        <Problem
          title="Couldn’t Save Feedback"
          text="Check your connection and try again. Your ride is still logged."
          action="Try Again"
          onAction={save}
        />
      )}
      {error === 'conflict' && (
        <Problem
          title="Changed on Another Device"
          text="This feedback was updated somewhere else. Load the latest version, then make your changes again."
          action="Load Latest"
          onAction={() =>
            props.onLoadLatest().then((ok) => ok || setError('offline'))
          }
        />
      )}
      {error === 'loaded' && (
        <p class="ro-banner ro-fb-note" role="status">
          Showing the latest version. Make your changes again, then save.
        </p>
      )}
      <Rating
        label="Enjoyment"
        words={ENJOYMENT}
        value={enjoyment}
        onChange={setEnjoyment}
      />
      <Rating
        label="Weather Comfort"
        words={COMFORT}
        value={comfort}
        onChange={setComfort}
        foot="How the weather felt to ride in, whatever else happened."
      />
      <Reasons value={reasons} onChange={setReasons} />
      {timesOpen ? (
        <fieldset class="ro-fb-times">
          <legend class="ro-fb-label">Ride Times</legend>
          <div class="ro-fb-field">
            <label for={`${id}-start`}>Started</label>
            <input
              id={`${id}-start`}
              type="time"
              ref={startInput}
              value={start}
              onInput={(e) => {
                const value = e.currentTarget.value;
                editTimes(() => setStart(value));
              }}
            />
          </div>
          {!start && planned && (
            <div class="ro-fb-suggest">
              <span>You planned to leave at {planned}</span>
              <button
                type="button"
                class="ro-fb-pill"
                onClick={() => {
                  editTimes(() => setStart(planned));
                  startInput.current?.focus();
                }}
              >
                Use {planned}
              </button>
            </div>
          )}
          <div class="ro-fb-field">
            <span>Duration</span>
            <span class="ro-fb-duration">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={24}
                aria-label="Duration, hours"
                value={hours}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  editTimes(() => setHours(value));
                }}
              />
              <span aria-hidden="true">h</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                aria-label="Duration, minutes"
                value={minutes}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  editTimes(() => setMinutes(value));
                }}
              />
              <span aria-hidden="true">min</span>
            </span>
          </div>
          {timesError ? (
            <p class="ro-fb-error" role="alert">
              {timesError}
            </p>
          ) : (
            <p class="ro-help" aria-live="polite">
              {partial
                ? 'Add a start time and a duration, or remove ride times to save without them.'
                : 'Duration is the whole ride, including stops.'}
            </p>
          )}
          <div class="ro-fb-stack">
            <span>Times Are</span>
            <Segmented<Timing['precision']>
              label="Times Are"
              options={[
                { value: 'confirmed', label: 'Exact' },
                { value: 'approximate', label: 'Approximate' },
              ]}
              value={precision}
              onChange={setPrecision}
            />
          </div>
          <div class="ro-fb-stack ro-fb-followed">
            <span>Followed {route}?</span>
            <Segmented<Timing['routeFollowed']>
              label={`Followed ${route}?`}
              options={FOLLOWED}
              value={followed}
              onChange={setFollowed}
            />
          </div>
          <button
            type="button"
            class="ro-link ro-fb-danger-link"
            onClick={() => {
              setTimesOpen(false);
              setStart('');
              setHours('');
              setMinutes('');
              setPrecision('approximate');
              setFollowed('unknown');
              if (error === 'timing') setError(null);
              later(() => addTimes.current?.focus());
            }}
          >
            Remove Ride Times
          </button>
        </fieldset>
      ) : (
        <button
          type="button"
          class="ro-fb-disclosure"
          ref={addTimes}
          onClick={() => {
            setTimesOpen(true);
            later(() => startInput.current?.focus());
          }}
        >
          <span>
            <span>Add Ride Times</span>
            <span>When you started, how long, and the route</span>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      <div class="ro-setting ro-fb-include">
        <div class="ro-setting-text">
          <span id={`${id}-inc`}>Use to Tailor My Rides</span>
          <span aria-live="polite">
            {paused ? (
              <>
                Tailoring is paused, so this ride won’t be used.{' '}
                <button
                  type="button"
                  class="ro-link"
                  onClick={() => goTo('prefs')}
                >
                  Change in Preferences
                </button>
              </>
            ) : (
              includeFoot
            )}
          </span>
        </div>
        <Switch
          on={include && !paused}
          labelledBy={`${id}-inc`}
          inactive={paused}
          onClick={() => setInclude(!include)}
        />
      </div>
      {discard ? (
        <Confirm
          title="Discard your feedback?"
          text="Your ride stays logged in History."
          confirm="Discard Changes"
          cancel="Keep Editing"
          onConfirm={props.onClose}
          onCancel={() => {
            setDiscard(false);
            later(() => notNow.current?.focus());
          }}
        />
      ) : (
        <div class="ro-fb-actions">
          <button
            type="submit"
            class="ro-primary"
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            class="ro-secondary"
            ref={notNow}
            disabled={saving}
            onClick={cancel}
          >
            Not Now
          </button>
        </div>
      )}
      <p class="ro-help">
        Feedback is optional. Your ride stays in History either way.
      </p>
    </form>
  );
};

// Reloads the ride after a conflict and remounts the form, so it starts from what's saved now.
// The version is in the key too, because the new copy can land just after the reply.
const useReload = (ride: Ride) => {
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const reload = () =>
    send({ type: 'loadRide', id: ride.id })
      .then((result) => {
        if (result.error) return false;
        setReloads((n) => n + 1);
        setLoaded(true);
        return true;
      })
      .catch(() => false);
  return {
    key: `${reloads}:${reloads ? (ride.experienceVersion ?? 0) : 0}`,
    loaded,
    reload,
    done: () => setLoaded(false),
  };
};

// After the check-in: one tap on a dot opens the form with that rating chosen.
export const FeedbackInvite = ({ ride, view }: { ride: Ride; view: View }) => {
  const [step, setStep] = useState<'invite' | 'form' | 'saved' | 'closed'>(
    ride.experience ? 'closed' : 'invite',
  );
  const [picked, setPicked] = useState<number | null>(null);
  const id = useId();
  const details = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const form = useReload(ride);
  useLearning(view.state.learning, step === 'form');
  if (step === 'closed') return null;
  if (step === 'saved')
    return (
      <div class="ro-card ro-fb-saved">
        <p role="status">
          <Tick />
          <span aria-hidden="true">Feedback Saved</span>
          <span class="ro-sr">Feedback saved for {ride.route.name}.</span>
        </p>
        <button
          type="button"
          class="ro-secondary"
          ref={viewButton}
          onClick={() => goTo('history')}
        >
          View
        </button>
      </div>
    );
  if (step === 'form')
    return (
      <div class="ro-card ro-fb-card">
        <FeedbackForm
          key={form.key}
          ride={ride}
          learning={view.state.learning}
          enjoyment={picked}
          loaded={form.loaded}
          onLoadLatest={form.reload}
          onSaved={() => {
            form.done();
            setStep('saved');
            later(() => viewButton.current?.focus());
          }}
          onClose={() => {
            form.done();
            setPicked(null);
            setStep('invite');
            later(() => details.current?.focus());
          }}
        />
      </div>
    );
  return (
    <section class="ro-card ro-fb-invite" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} class="ro-fb-title">
        How was {ride.route.name}?
      </h3>
      <span id={`${id}-r`} class="ro-fb-label">
        Enjoyment
      </span>
      <Dots
        labelledBy={`${id}-r`}
        words={ENJOYMENT}
        value={null}
        onPick={(v) => {
          setPicked(v);
          setStep('form');
        }}
      />
      <div class="ro-fb-ends" aria-hidden="true">
        <span>{ENJOYMENT[1]}</span>
        <span>{ENJOYMENT[5]}</span>
      </div>
      <div class="ro-fb-actions">
        <button
          type="button"
          class="ro-primary"
          ref={details}
          onClick={() => setStep('form')}
        >
          Add Details
        </button>
        <button
          type="button"
          class="ro-secondary"
          onClick={() => setStep('closed')}
        >
          Not Now
        </button>
      </div>
    </section>
  );
};

const RatingRow = (props: {
  label: string;
  value: number | null;
  words: string[];
}) => (
  <div class="ro-fb-row">
    <dt>{props.label}</dt>
    <dd>
      {props.value === null ? (
        'Not rated'
      ) : (
        <>
          <span class="ro-fb-pips" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} data-on={n <= (props.value ?? 0)} />
            ))}
          </span>
          <span class="ro-sr">{props.value} of 5, </span>
          {props.words[props.value]}
        </>
      )}
    </dd>
  </div>
);

const STATUS = {
  included: 'Included',
  'not-used': 'Not Used',
  off: 'Off',
  paused: 'Paused',
};
const WEATHER = {
  waiting: 'Waiting',
  done: 'Done',
  unavailable: 'Unavailable',
};
const weatherText = (check: keyof typeof WEATHER, route: string) =>
  check === 'waiting'
    ? `Ride On is fetching the weather along ${route} at the time you rode. This usually takes under an hour.`
    : check === 'done'
      ? `Compared with the weather along ${route} while you rode.`
      : 'Weather for this ride couldn’t be found, so it won’t be used to tailor your rides. Your ratings are still saved.';

const Summary = (props: {
  ride: Ride;
  experience: Saved;
  learning: LearningProfile | null;
  failure: WriteFailure | null;
  status: string;
  focusKey: number;
  onEdit: (times?: boolean) => void;
  onRemoved: () => void;
}) => {
  const { ride, experience } = props;
  const { feedback, timing } = experience;
  const route = ride.route.name;
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (props.focusKey) heading.current?.focus();
  }, [props.focusKey]);
  const remove = async () => {
    setConfirm(false);
    setRemoving(true);
    await send({
      type: 'removeRideExperience',
      id: ride.id,
      expectedVersion: ride.experienceVersion ?? 0,
      expectedRideVersion: ride.version,
    }).catch(() => undefined);
    setRemoving(false);
    props.onRemoved();
  };
  const counts = thisRide(experience, props.learning);
  const check = weatherCheck(ride.weatherEnrichment?.status);
  const foot =
    counts.status === 'included'
      ? check === 'unavailable'
        ? weatherText(check, route)
        : `${weatherText(check, route)} Still being tested, so your recommendations don’t change yet.`
      : counts.status === 'off'
        ? 'You chose not to use this ride. Turn it on from Edit Feedback.'
        : counts.status === 'not-used'
          ? counts.why === 'timing'
            ? `Add ride times and confirm you followed ${route} for this ride to count.`
            : counts.why === 'comfort'
              ? 'Rate how the weather felt for this ride to count.'
              : 'You started afresh after this feedback was given, so it isn’t used.'
          : null;
  return (
    <section class="ro-fb-summary" aria-labelledby={`${id}-h`}>
      <div class="ro-fb-head ro-fb-head-row">
        <h3 id={`${id}-h`} class="ro-fb-title" tabIndex={-1} ref={heading}>
          Your Feedback
        </h3>
        <button
          type="button"
          class="ro-link"
          aria-label="Edit Feedback"
          onClick={() => props.onEdit()}
        >
          Edit
        </button>
      </div>
      <p class="ro-fb-status" role="status">
        {props.status && (
          <>
            <Tick />
            {props.status}
          </>
        )}
      </p>
      {props.failure === 'conflict' ? (
        <Problem
          title="Changed on Another Device"
          text="This feedback was updated somewhere else. Load the latest version, then try again."
          action="Load Latest"
          onAction={() => send({ type: 'loadRide', id: ride.id })}
        />
      ) : (
        props.failure && (
          <Problem
            title="Couldn’t Remove Feedback"
            text="Check your connection and try again. Nothing has changed."
            action="Try Again"
            onAction={remove}
          />
        )
      )}
      <dl class="ro-fb-rows">
        {feedback && (
          <>
            <RatingRow
              label="Enjoyment"
              value={feedback.enjoyment}
              words={ENJOYMENT}
            />
            <RatingRow
              label="Weather Comfort"
              value={feedback.weatherComfort}
              words={COMFORT}
            />
            {feedback.reasons.length > 0 && (
              <div class="ro-fb-row">
                <dt>What Made the Difference</dt>
                <dd>
                  <ul class="ro-fb-tags">
                    {feedback.reasons.map((r) => (
                      <li key={r.factor} data-impact={r.impact}>
                        <Arrow up={r.impact === 'positive'} />
                        {reasonLabel(r.factor)}
                        <span class="ro-sr">
                          {r.impact === 'positive'
                            ? ', helped'
                            : ', spoiled the ride'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </>
        )}
        {timing ? (
          <>
            <div class="ro-fb-row">
              <dt>Started</dt>
              <dd>
                {timing.startTime} ·{' '}
                {timing.precision === 'confirmed' ? 'Exact' : 'Approximate'}
              </dd>
            </div>
            <div class="ro-fb-row">
              <dt>Duration</dt>
              <dd>{rideDuration(timing.durationMinutes)}</dd>
            </div>
            <div class="ro-fb-row">
              <dt>Followed {route}</dt>
              <dd>
                {FOLLOWED.find((f) => f.value === timing.routeFollowed)?.label}
              </dd>
            </div>
          </>
        ) : (
          <div class="ro-fb-row">
            <dt>Ride Times</dt>
            <dd>
              <button
                type="button"
                class="ro-link"
                aria-label="Add Ride Times"
                onClick={() => props.onEdit(true)}
              >
                Add
              </button>
            </dd>
          </div>
        )}
      </dl>
      <div class="ro-fb-section">
        <span class="ro-fb-label">Tailored Rides</span>
        <dl class="ro-fb-rows">
          <div class="ro-fb-row">
            <dt>This Ride</dt>
            <dd data-status={counts.status}>{STATUS[counts.status]}</dd>
          </div>
          {counts.status === 'included' && (
            <div class="ro-fb-row">
              <dt>Weather Check</dt>
              <dd data-status={check}>{WEATHER[check]}</dd>
            </div>
          )}
        </dl>
        <p class="ro-help">
          {foot ?? (
            <>
              Tailoring is paused for all your rides.{' '}
              <button
                type="button"
                class="ro-link"
                onClick={() => goTo('prefs')}
              >
                Change in Preferences
              </button>
            </>
          )}
        </p>
      </div>
      {confirm ? (
        <Confirm
          title="Remove Feedback?"
          text="Your ride stays in History. Its ratings, reasons and ride times are removed and won’t be used to tailor your rides."
          confirm="Remove Feedback"
          cancel="Cancel"
          onConfirm={remove}
          onCancel={() => {
            setConfirm(false);
            later(() => removeButton.current?.focus());
          }}
        />
      ) : (
        <div class="ro-fb-remove">
          <button
            type="button"
            class="ro-link ro-fb-danger-link"
            ref={removeButton}
            disabled={removing}
            onClick={() => setConfirm(true)}
          >
            {removing ? 'Removing…' : 'Remove Feedback'}
          </button>
          <span class="ro-help">
            Removing feedback keeps this ride in History.
          </span>
        </div>
      )}
    </section>
  );
};

// One History ride's feedback: a line that opens the summary, or Add Feedback straight into
// the form. A removal waits five seconds for Undo before the background sends it.
export const HistoryFeedback = ({ ride, view }: { ride: Ride; view: View }) => {
  const { pendingRemovals, removeFailures, learning } = view.state;
  const removing = pendingRemovals.some((r) => r.id === ride.id);
  const failure = removeFailures[ride.id] ?? null;
  const experience = removing ? null : (ride.experience ?? null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<false | 'form' | 'times'>(false);
  const [status, setStatus] = useToast();
  const [focusKey, setFocusKey] = useState(0);
  const id = useId();
  const line = useRef<HTMLButtonElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  // Removing and undoing change state in the background; focus follows once it lands.
  const focusNext = useRef<'undo' | 'restored' | null>(null);
  const form = useReload(ride);
  useLearning(learning, open);
  useEffect(() => {
    if (failure) setOpen(true);
  }, [failure]);
  useEffect(() => {
    if (removing && focusNext.current === 'undo') {
      focusNext.current = null;
      undo.current?.focus();
    } else if (!removing && focusNext.current === 'restored') {
      focusNext.current = null;
      setOpen(true);
      setFocusKey((n) => n + 1);
    }
  }, [removing]);
  const close = () => {
    form.done();
    setEditing(false);
    if (experience) setFocusKey((n) => n + 1);
    else {
      setOpen(false);
      later(() => line.current?.focus());
    }
  };
  const formOpen = open && !!editing;
  return (
    <div class="ro-fb-history">
      {removing && (
        <div class="ro-fb-removed" role="status">
          <span>Feedback Removed</span>
          <button
            type="button"
            class="ro-link"
            ref={undo}
            onClick={() => {
              focusNext.current = 'restored';
              send({ type: 'undoRemoveExperience', id: ride.id });
            }}
          >
            Undo
          </button>
        </div>
      )}
      {!removing && !formOpen && !(open && !experience) && (
        <button
          type="button"
          class="ro-fb-line"
          ref={line}
          aria-expanded={experience ? open : undefined}
          aria-controls={experience && open ? id : undefined}
          onClick={() => {
            setFocusKey(0);
            if (experience) setOpen(!open);
            else {
              setOpen(true);
              setEditing('form');
            }
          }}
        >
          {experience ? (
            <>
              <span>{feedbackLine(experience)}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          ) : (
            <span>Add Feedback</span>
          )}
        </button>
      )}
      {open && (
        <div id={id} class="ro-fb-panel">
          {editing ? (
            <FeedbackForm
              key={form.key}
              ride={ride}
              learning={learning}
              blank={removing}
              timesOpen={editing === 'times'}
              loaded={form.loaded}
              onLoadLatest={form.reload}
              onSaved={() => {
                form.done();
                setEditing(false);
                setStatus('Feedback Saved');
                setFocusKey((n) => n + 1);
              }}
              onClose={close}
            />
          ) : experience ? (
            <Summary
              ride={ride}
              experience={experience}
              learning={learning}
              failure={failure}
              status={status}
              focusKey={focusKey}
              onEdit={(times) => {
                setStatus('');
                setEditing(times ? 'times' : 'form');
              }}
              onRemoved={() => {
                focusNext.current = 'undo';
                setOpen(false);
              }}
            />
          ) : status || removing ? null : (
            <div class="ro-fb-empty">
              <span class="ro-fb-title">No Feedback Yet</span>
              <p class="ro-help">
                Rate how this ride felt. It only takes a tap, and you can add
                more later.
              </p>
              <button
                type="button"
                class="ro-secondary"
                onClick={() => setEditing('form')}
              >
                Add Feedback
              </button>
              <p class="ro-help">
                Feedback is optional. This ride stays in History either way.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ORDER: LearningFactor[] = ['cold', 'heat', 'wind', 'rain', 'shade'];

const Progress = (props: {
  learning: LearningProfile;
  today: string;
  timeZone: string;
}) => {
  const { learning } = props;
  const id = useId();
  const paused = !learning.enabled;
  const afreshToday =
    !!learning.resetAt &&
    localDate(learning.resetAt, props.timeZone) === props.today;
  return (
    <div class="ro-fb-section ro-fb-progress" data-paused={paused}>
      <div class="ro-card-head">
        <span id={`${id}-h`} class="ro-fb-label">
          Progress So Far
        </span>
        {paused && <span class="ro-paused-pill">Paused</span>}
      </div>
      {learning.eligibleRideCount === 0 ? (
        <div class="ro-fb-empty">
          <span class="ro-fb-title">
            {afreshToday ? 'Starting Afresh' : 'No Rides Count Yet'}
          </span>
          <p class="ro-help">
            {afreshToday
              ? 'You started afresh today. Feedback you add from now on will count. Earlier ratings stay on each ride in History.'
              : 'Add feedback with ride times to a ride in History, and confirm you followed the saved route.'}
          </p>
          <button
            type="button"
            class="ro-secondary"
            onClick={() => goTo('history')}
          >
            Go to History
          </button>
          <p class="ro-help">
            A ride counts once it has ride times, you confirm you followed the
            saved route, and you choose to include it.
          </p>
        </div>
      ) : (
        <>
          <dl class="ro-fb-rows">
            <div class="ro-fb-row">
              <dt>Rides That Count</dt>
              <dd>
                {learning.eligibleRideCount} of {learning.feedbackRideCount}
              </dd>
            </div>
          </dl>
          <ul class="ro-fb-factors" aria-labelledby={`${id}-h`}>
            {ORDER.map((factor) => {
              const f = learning.factors.find((x) => x.factor === factor) ?? {
                evidenceCount: 0,
                confidence: 0,
              };
              const n = level(f);
              return (
                <li key={factor}>
                  <span class="ro-fb-factor">
                    <span>{FACTOR_NAMES[factor]}</span>
                    <span>
                      {f.evidenceCount < NEEDED
                        ? `Needs ${NEEDED} rides`
                        : rides(f.evidenceCount)}
                    </span>
                  </span>
                  {/* biome-ignore lint/a11y/useSemanticElements: three segments, as in the design; a native <meter> can't be drawn that way. */}
                  <span
                    class="ro-fb-meter"
                    role="meter"
                    aria-label={FACTOR_NAMES[factor]}
                    aria-valuemin={0}
                    aria-valuemax={3}
                    aria-valuenow={n}
                    aria-valuetext={LEVELS[n]}
                  >
                    {[1, 2, 3].map((s) => (
                      <span key={s} data-on={s <= n} />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p class="ro-help">
            This shows how much Ride On has to go on for each kind of weather,
            not what it has decided. Each needs at least five rides.
          </p>
        </>
      )}
    </div>
  );
};

type LearningWrite = { enabled: boolean; reset: boolean };
type LearningProblem = LearningWrite & {
  failure: 'offline' | 'conflict';
  before: boolean;
};

// Preferences › Tailored Rides. The API calls it learning; riders never see that word.
// The switch moves at once and never disables, so focus stays on it while it saves.
export const TailoredRides = ({ view }: { view: View }) => {
  const { learning } = view.state;
  const load = useLearning(learning);
  const id = useId();
  const [busy, setBusy] = useState<'switch' | 'reset' | null>(null);
  const [want, setWant] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<LearningProblem | null>(null);
  const [toast, setToast] = useToast();
  const [confirm, setConfirm] = useState(false);
  const afresh = useRef<HTMLButtonElement>(null);
  const write = async ({ enabled, reset }: LearningWrite) => {
    if (!learning || busy) return;
    const before = learning.enabled;
    setBusy(reset ? 'reset' : 'switch');
    if (!reset) setWant(enabled);
    setProblem(null);
    setToast('');
    const result = await send({
      type: 'saveLearning',
      expectedVersion: learning.settingsVersion,
      enabled,
      reset,
    }).catch(() => ({ error: 'offline', failure: 'offline' as const }));
    setBusy(null);
    setWant(null);
    if (result.error)
      setProblem({
        enabled,
        reset,
        before,
        failure: result.failure === 'conflict' ? 'conflict' : 'offline',
      });
    else
      setToast(
        reset
          ? 'Started Afresh'
          : enabled
            ? 'Tailored Rides On'
            : 'Tailored Rides Paused',
      );
  };
  const on = want ?? learning?.enabled ?? false;
  // The background reloads the profile after a conflict; say what the other device changed.
  const conflictText =
    !learning || !problem || learning.enabled === problem.before
      ? 'Tailored Rides was changed on another device, so that’s shown here now.'
      : learning.enabled
        ? 'Tailored Rides was switched on from another device, so that’s shown here now. Pause it again if you want.'
        : 'Tailored Rides was paused on another device, so that’s shown here now. Turn it back on if you want.';
  return (
    <section class="ro-card ro-fb-tailored" aria-labelledby={`${id}-h`}>
      <div class="ro-fb-head">
        <h2 id={`${id}-h`} class="ro-label">
          Tailored Rides
        </h2>
        <p class="ro-help">
          Ride On uses your ride feedback to find rides that suit you.
        </p>
      </div>
      <div class="ro-fb-test">
        <div class="ro-card-head">
          <span class="ro-fb-label">Being Tested</span>
          <span class="ro-fb-badge">Preview</span>
        </div>
        <p class="ro-help">
          Ride On compares your weather-comfort ratings with the weather you
          actually rode in. It doesn’t change your recommendations yet.
        </p>
      </div>
      <p class="ro-fb-status" role="status">
        {toast && (
          <>
            <Tick />
            {toast}
          </>
        )}
      </p>
      {!learning ? (
        load.failed ? (
          <div class="ro-fb-problem-inline">
            <p class="ro-pause-error" role="alert">
              Couldn’t load Tailored Rides. Check your connection and try again.
            </p>
            <button type="button" class="ro-link" onClick={load.retry}>
              Try Again
            </button>
          </div>
        ) : (
          <p class="ro-help">Loading…</p>
        )
      ) : (
        <>
          {problem?.failure === 'offline' && (
            <Problem
              title="Couldn’t Update Tailored Rides"
              text="Check your connection and try again. Nothing has changed."
              action="Try Again"
              onAction={() => write(problem)}
            />
          )}
          {problem?.failure === 'conflict' && (
            <Problem
              title="Changed on Another Device"
              text={conflictText}
              action="OK"
              onAction={() => setProblem(null)}
            />
          )}
          <div class="ro-setting">
            <div class="ro-setting-text">
              <span id={`${id}-use`}>Use My Feedback</span>
              <span aria-live="polite">
                {busy === 'switch'
                  ? 'Saving…'
                  : on
                    ? 'Only rides you include are used. You choose for each ride when you add feedback.'
                    : 'Paused. New feedback is still saved to your rides, but nothing is analysed. Turn it back on to use eligible rides again.'}
              </span>
            </div>
            <Switch
              on={on}
              labelledBy={`${id}-use`}
              busy={busy === 'switch'}
              onClick={() =>
                write({ enabled: !learning.enabled, reset: false })
              }
            />
          </div>
          <Progress
            learning={learning}
            today={view.today}
            timeZone={view.timeZone}
          />
          <div class="ro-fb-section">
            {confirm ? (
              <Confirm
                title="Start Afresh?"
                text="Ride On will stop using the feedback you’ve given so far to tailor your rides. Your rides, ratings and History are kept."
                confirm="Start Afresh"
                cancel="Cancel"
                onConfirm={() => {
                  setConfirm(false);
                  later(() => afresh.current?.focus());
                  void write({ enabled: learning.enabled, reset: true });
                }}
                onCancel={() => {
                  setConfirm(false);
                  later(() => afresh.current?.focus());
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  class="ro-secondary ro-fb-afresh"
                  ref={afresh}
                  aria-disabled={!!busy || undefined}
                  onClick={() => {
                    if (!busy) setConfirm(true);
                  }}
                >
                  {busy === 'reset' ? 'Starting Afresh…' : 'Start Afresh'}
                </button>
                <p class="ro-help">
                  {learning.resetAt
                    ? `Started afresh ${resetWhen(learning.resetAt, view.timeZone)}. Your rides, ratings and History were kept.`
                    : 'Ride On stops using the feedback you’ve given so far. Your rides, ratings and History are kept.'}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
};
