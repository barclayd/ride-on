import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { clamp } from '../lib/math';

const MIN = -5;
const MAX = 35;
const RANGE = MAX - MIN;
const percent = (temperature: number) => ((temperature - MIN) / RANGE) * 100;

type Handle = 'lo' | 'hi';
const STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  PageDown: -5,
  PageUp: 5,
};

/** A two-handled ideal temperature range to drag, over the condition temperature ramp. */
export default function TempRamp() {
  const [lo, setLo] = useState(9);
  const [hi, setHi] = useState(14);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<Handle | null>(null);

  const set = (handle: Handle, temperature: number) => {
    if (handle === 'lo') setLo(Math.max(MIN, Math.min(temperature, hi - 1)));
    else setHi(Math.min(MAX, Math.max(temperature, lo + 1)));
  };

  const temperatureAt = (x: number) => {
    const rect = track.current?.getBoundingClientRect();
    return rect
      ? Math.round(MIN + clamp((x - rect.left) / rect.width) * RANGE)
      : lo;
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const temperature = temperatureAt(event.clientX);
    const handle =
      Math.abs(temperature - lo) <= Math.abs(temperature - hi) ? 'lo' : 'hi';
    dragging.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
    set(handle, temperature);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) set(dragging.current, temperatureAt(event.clientX));
  };

  const key = (handle: Handle) => (event: KeyboardEvent<HTMLDivElement>) => {
    const value = handle === 'lo' ? lo : hi;
    const step = STEPS[event.key];
    const next = step
      ? value + step
      : event.key === 'Home'
        ? MIN
        : event.key === 'End'
          ? MAX
          : null;
    if (next === null) return;
    event.preventDefault();
    set(handle, next);
  };

  const loPercent = percent(lo);
  const hiPercent = percent(hi);
  const span = hiPercent - loPercent;

  return (
    <div className="card temp-card">
      <div className="subtle">Ideal Temperature · try it</div>
      <div className="temp-readout tabular" aria-hidden="true">
        {lo}–{hi}°
      </div>
      <div
        ref={track}
        className="ramp"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        <div className="ramp-track" />
        <div
          className="ramp-span"
          style={{
            left: `${loPercent}%`,
            width: `${span}%`,
            backgroundSize: `${(100 / span) * 100}% 100%`,
            backgroundPosition: `${(loPercent / (100 - span)) * 100}% 0`,
          }}
        />
        {(['lo', 'hi'] as const).map((handle) => {
          const value = handle === 'lo' ? lo : hi;
          return (
            <div
              key={handle}
              className="ramp-handle"
              role="slider"
              tabIndex={0}
              aria-label={
                handle === 'lo'
                  ? 'Coolest ideal temperature'
                  : 'Warmest ideal temperature'
              }
              aria-valuemin={handle === 'lo' ? MIN : lo + 1}
              aria-valuemax={handle === 'lo' ? hi - 1 : MAX}
              aria-valuenow={value}
              aria-valuetext={`${value}°C`}
              style={{ left: `${percent(value)}%` }}
              onKeyDown={key(handle)}
            />
          );
        })}
      </div>
      <div className="ramp-scale tabular" aria-hidden="true">
        <span>−5°</span>
        <span>15°</span>
        <span>35°</span>
      </div>
    </div>
  );
}
