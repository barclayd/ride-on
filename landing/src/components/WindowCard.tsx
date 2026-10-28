import { type CSSProperties, useState } from 'react';

const PICKS = ['Tomorrow', 'This Weekend', 'Next 5 Days'];
const HOURS = ['Daylight', 'Custom'];
const DAYS = [
  { day: 'Wed', date: 14, score: 86, best: true },
  { day: 'Thu', date: 15, score: 72 },
  { day: 'Fri', date: 16, score: 0, rain: true },
  { day: 'Sat', date: 17, score: 64 },
  { day: 'Sun', date: 18, score: 79 },
];

/** The ride window picker. The chips and hours are for show: the days don't change. */
export default function WindowCard() {
  const [pick, setPick] = useState('This Weekend');
  const [hours, setHours] = useState('Daylight');

  return (
    <div className="card window-card">
      <fieldset className="chips" aria-label="Window">
        {PICKS.map((label) => (
          <button
            key={label}
            type="button"
            className="chip"
            aria-pressed={pick === label}
            onClick={() => setPick(label)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="days tabular">
        {DAYS.map((day, i) => (
          <div
            key={day.day}
            className={`day${day.best ? ' best' : ''}${day.rain ? ' rain' : ''}`}
            style={
              {
                '--delay': `${i * 90}ms`,
                '--h': `${day.rain ? 10 : day.score * 1.7}px`,
              } as CSSProperties
            }
          >
            <div className="day-label">
              {day.rain ? (
                <span role="img" aria-label="Rained out">
                  ☔
                </span>
              ) : (
                day.score
              )}
            </div>
            <div className="day-bar" />
            <div className="day-date">
              {day.day}
              <br />
              {day.date}
            </div>
          </div>
        ))}
      </div>
      <p className="window-note">
        Wednesday is your best day. Friday is rained out.
      </p>
      <fieldset className="segmented" aria-label="Hours">
        {HOURS.map((label) => (
          <button
            key={label}
            type="button"
            aria-pressed={hours === label}
            onClick={() => setHours(label)}
          >
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
