import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { clamp } from '../lib/math';
import { sticky, useScrollProgress } from '../lib/scroll';

const WORDS =
  'A weather app tells you about one town at one time. Your ride covers 60 km and three hours, and the wind changes direction every time you turn.'
    .split(' ')
    .map((word, i) => ({ word, id: `${i}-${word}` }));
const KEY = /km|hours|wind|turn/;

/** The problem, lit up a word at a time as it scrolls past. */
export default function Problem() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref, sticky);
  const p = useReducedMotion() ? 1 : progress;

  return (
    <section ref={ref} className="problem">
      <div className="problem-stage">
        <p>
          {WORDS.map(({ word, id }, i) => {
            const lit = clamp(p * WORDS.length * 1.25 - i);
            return (
              <span
                key={id}
                data-motion
                style={{
                  opacity: 0.14 + 0.86 * lit,
                  color:
                    KEY.test(word) && lit > 0.9 ? 'var(--accent)' : undefined,
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
