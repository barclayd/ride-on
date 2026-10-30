import { useEffect, useId, useState } from 'preact/hooks';
import { send } from '../lib/state';
import type { FeedbackFactor, Ride, RideExperience } from '../lib/types';
import type { View } from './components';
import { clock } from './format';

const reasons: [FeedbackFactor, string, string][] = [
  ['sunshine', 'Lovely sunshine', 'Not enough sunshine'],
  ['temperature', 'Comfortable temperature', 'Too hot or cold'],
  ['wind', 'Helpful breeze', 'Wind made it hard'],
  ['rain', 'Enjoyed the rain', 'Rain spoiled it'],
  ['surface', 'Good surfaces', 'Poor or muddy surfaces'],
  ['hills', 'Enjoyed the hills', 'Too much climbing'],
  ['distance', 'Distance felt right', 'Distance did not suit me'],
  ['traffic', 'Quiet roads', 'Too much traffic'],
  ['company', 'Good company', 'Company affected the ride'],
  ['tiredness', 'Felt strong', 'Felt tired'],
  ['mechanical', 'Bike felt great', 'Mechanical problem'],
];
const Ratings = ({
  name,
  title,
  labels,
  value,
  onChange,
}: {
  name: string;
  title: string;
  labels: string[];
  value: number | null;
  onChange: (value: number | null) => void;
}) => (
  <fieldset class="ro-feedback-rating">
    <legend>
      {title} <span class="ro-help">Optional</span>
    </legend>
    <div>
      {labels.map((label, i) => (
        <label key={label}>
          <input
            type="radio"
            name={name}
            value={i + 1}
            checked={value === i + 1}
            onChange={() => onChange(i + 1)}
          />
          <span>{i + 1}</span>
          <small>{label}</small>
        </label>
      ))}
    </div>
    {value !== null && (
      <button type="button" class="ro-link" onClick={() => onChange(null)}>
        Clear rating
      </button>
    )}
  </fieldset>
);
const FeedbackEditor = ({ ride, close }: { ride: Ride; close: () => void }) => {
  const id = useId();
  const saved = ride.experience;
  const [enjoyment, setEnjoyment] = useState(
    saved?.feedback?.enjoyment ?? null,
  );
  const [comfort, setComfort] = useState(
    saved?.feedback?.weatherComfort ?? null,
  );
  const [choices, setChoices] = useState(
    saved?.feedback?.reasons.map((r) => `${r.factor}:${r.impact}`) ?? ['', ''],
  );
  const [include, setInclude] = useState(
    saved?.feedback?.includeInLearning ?? true,
  );
  const [hasTiming, setHasTiming] = useState(!!saved?.timing);
  const [start, setStart] = useState(
    saved?.timing?.startTime ??
      (ride.plan ? clock(ride.plan.departureAt, ride.timeZone) : ''),
  );
  const [duration, setDuration] = useState(
    String(
      saved?.timing?.durationMinutes ??
        (ride.plan
          ? Math.round(
              (Date.parse(ride.plan.finishAt) -
                Date.parse(ride.plan.departureAt)) /
                60000,
            )
          : ''),
    ),
  );
  const [precision, setPrecision] = useState<'confirmed' | 'approximate'>(
    saved?.timing?.precision ?? 'approximate',
  );
  const [followed, setFollowed] = useState<
    NonNullable<RideExperience['timing']>['routeFollowed']
  >(saved?.timing?.routeFollowed ?? 'unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (experience: RideExperience) => {
    setBusy(true);
    setError('');
    try {
      const result = await send({
        type: 'saveRideExperience',
        id: ride.id,
        expectedVersion: ride.experienceVersion ?? 0,
        expectedRideVersion: ride.version,
        experience,
      });
      if (result.error) setError(result.error);
      else close();
    } catch {
      setError('Could not save feedback. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="ro-feedback-form"
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        const selected = choices.filter(Boolean).map((choice) => {
          const [factor, impact] = choice.split(':');
          return {
            factor: factor as FeedbackFactor,
            impact: impact as 'positive' | 'negative',
          };
        });
        if (new Set(selected.map((r) => r.factor)).size !== selected.length) {
          setError('Choose two different reasons.');
          return;
        }
        const feedback =
          enjoyment !== null || comfort !== null || selected.length
            ? {
                enjoyment,
                weatherComfort: comfort,
                reasons: selected,
                includeInLearning: include,
              }
            : null;
        void save({
          timing: hasTiming
            ? {
                startTime: start,
                durationMinutes: Number(duration),
                precision,
                routeFollowed: followed,
              }
            : null,
          feedback,
        });
      }}
    >
      <p class="ro-help">
        Your ride is saved. A few optional details help Ride On understand what
        suits you. Scores still use your saved preferences while we evaluate
        learning.
      </p>
      <Ratings
        name={`${id}-enjoyment`}
        title="How much did you enjoy it?"
        labels={['Not at all', 'A little', 'Okay', 'Enjoyed it', 'Loved it']}
        value={enjoyment}
        onChange={setEnjoyment}
      />
      <Ratings
        name={`${id}-comfort`}
        title="How comfortable was the weather?"
        labels={['Very poor', 'Poor', 'Okay', 'Good', 'Ideal']}
        value={comfort}
        onChange={setComfort}
      />
      <fieldset class="ro-feedback-reasons">
        <legend>
          What made the biggest difference?{' '}
          <span class="ro-help">Up to two</span>
        </legend>
        {[0, 1].map((i) => (
          <label key={i} htmlFor={`${id}-reason-${i}`}>
            Reason {i + 1}
            <select
              id={`${id}-reason-${i}`}
              name={`reason-${i}`}
              value={choices[i] ?? ''}
              onChange={(e) =>
                setChoices((current) => {
                  const next = [...current];
                  next[i] = e.currentTarget.value;
                  return next;
                })
              }
            >
              <option value="">Nothing to add</option>
              {reasons.map(([factor, positive, negative]) => (
                <optgroup key={factor} label={factor}>
                  {[
                    ['positive', positive],
                    ['negative', negative],
                  ].map(([impact, label]) => (
                    <option key={impact} value={`${factor}:${impact}`}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <label class="ro-feedback-check">
        <input
          type="checkbox"
          name="hasTiming"
          checked={hasTiming}
          onChange={(e) => setHasTiming(e.currentTarget.checked)}
          aria-controls={`${id}-timing`}
          aria-expanded={hasTiming}
        />
        Add the time I actually rode
      </label>
      {!hasTiming && (
        <p class="ro-help">
          Ride times let us match your feedback to the weather.
        </p>
      )}
      {hasTiming && (
        <fieldset id={`${id}-timing`} class="ro-feedback-timing">
          <legend>Ride timing · {ride.riddenOn}</legend>
          <p class="ro-help">
            Times are in {ride.timeZone}. Check any times filled from your plan.
            Include stops in the duration.
          </p>
          <label htmlFor={`${id}-start`}>
            Started at
            <input
              id={`${id}-start`}
              name="startTime"
              type="time"
              required
              value={start}
              onInput={(e) => setStart(e.currentTarget.value)}
            />
          </label>
          <label htmlFor={`${id}-duration`}>
            Duration, in minutes
            <input
              id={`${id}-duration`}
              name="duration"
              type="number"
              min="1"
              max="1440"
              required
              value={duration}
              onInput={(e) => setDuration(e.currentTarget.value)}
            />
          </label>
          <label htmlFor={`${id}-precision`}>
            How precise are these times?
            <select
              id={`${id}-precision`}
              name="precision"
              value={precision}
              onChange={(e) =>
                setPrecision(e.currentTarget.value as typeof precision)
              }
            >
              <option value="approximate">Approximate</option>
              <option value="confirmed">Checked against my activity</option>
            </select>
          </label>
          <label htmlFor={`${id}-followed`}>
            Did you follow the saved route?
            <select
              id={`${id}-followed`}
              name="routeFollowed"
              value={followed}
              onChange={(e) =>
                setFollowed(e.currentTarget.value as typeof followed)
              }
            >
              <option value="unknown">Not sure</option>
              <option value="yes">Yes, the full route</option>
              <option value="partly">Only part of it</option>
              <option value="different">I took a different route</option>
            </select>
          </label>
        </fieldset>
      )}
      <label class="ro-feedback-check">
        <input
          type="checkbox"
          name="includeInLearning"
          checked={include}
          onChange={(e) => setInclude(e.currentTarget.checked)}
        />
        Use this feedback to learn my preferences
      </label>
      <p class="ro-help">
        When included, Ride On uses approximate route locations and ride times
        to retrieve historical weather from Open-Meteo. You can edit or remove
        this feedback at any time.
      </p>
      {error && (
        <p role="alert" class="ro-feedback-error">
          {error}
        </p>
      )}
      <div class="ro-feedback-actions">
        <button type="submit" class="ro-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save feedback'}
        </button>
        <button type="button" class="ro-link" disabled={busy} onClick={close}>
          Skip for now
        </button>
        {saved && (
          <button
            type="button"
            class="ro-link"
            disabled={busy}
            onClick={() => save({ timing: null, feedback: null })}
          >
            Remove feedback
          </button>
        )}
      </div>
    </form>
  );
};
export const RideFeedback = ({
  ride,
  initiallyOpen = false,
}: {
  ride: Ride;
  initiallyOpen?: boolean;
}) => {
  const [open, setOpen] = useState(initiallyOpen && !ride.experience);
  const id = useId();
  return (
    <section class="ro-feedback" aria-label="Ride feedback">
      <button
        type="button"
        class="ro-link"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {ride.experience ? 'Edit ride feedback' : 'How was your ride?'}
      </button>
      {open && (
        <div id={id}>
          <FeedbackEditor
            key={`${ride.id}:${ride.experienceVersion ?? 0}`}
            ride={ride}
            close={() => setOpen(false)}
          />
        </div>
      )}
      {!open && ride.experience && (
        <span class="ro-help">
          Feedback saved
          {ride.experience.feedback?.enjoyment
            ? ` · Enjoyment ${ride.experience.feedback.enjoyment}/5`
            : ''}
          {ride.experience.feedback?.includeInLearning &&
          !ride.experience.timing
            ? ' · Add ride times to match the weather'
            : ''}
        </span>
      )}
    </section>
  );
};
export const LearningControls = ({ view }: { view: View }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const learning = view.state.learning;
  useEffect(() => {
    if (!open || learning) return;
    void send({ type: 'loadLearning' })
      .catch(() => ({ error: 'Could not load learning settings.' }))
      .then((result) => setError(result.error ?? ''));
  }, [open, learning]);
  const change = async (enabled: boolean, reset = false) => {
    if (!learning) return;
    setBusy(true);
    setPendingEnabled(enabled);
    const result = await send({
      type: 'saveLearning',
      expectedVersion: learning.settingsVersion,
      enabled,
      reset,
    }).catch(() => ({ error: 'Could not update learning. Please try again.' }));
    setError(result.error ?? '');
    setPendingEnabled(null);
    setBusy(false);
  };
  return (
    <section class="ro-feedback">
      <button
        type="button"
        class="ro-link"
        aria-expanded={open}
        onClick={async () => {
          setOpen(!open);
          if (!open && learning) {
            const result = await send({ type: 'loadLearning' }).catch(() => ({
              error: 'Could not load learning settings.',
            }));
            setError(result.error ?? '');
          }
        }}
      >
        Learning from your rides
      </button>
      {open && (
        <div>
          {learning ? (
            <>
              <p class="ro-help">
                {learning.eligibleRideCount} rides with usable feedback and
                weather. Learning is being evaluated; it does not change your
                scores yet.
              </p>
              <label class="ro-feedback-check">
                <input
                  type="checkbox"
                  name="learningEnabled"
                  checked={pendingEnabled ?? learning.enabled}
                  disabled={busy}
                  onChange={(e) => change(e.currentTarget.checked)}
                />
                Learn from my ride feedback
              </label>
              <button
                type="button"
                class="ro-link"
                disabled={busy}
                onClick={() => change(learning.enabled, true)}
              >
                Start learning afresh
              </button>
              <p class="ro-help">
                Starting afresh excludes earlier feedback from learning. It
                keeps your ride history and ratings.
              </p>
            </>
          ) : (
            !error && <p role="status">Loading…</p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
};
