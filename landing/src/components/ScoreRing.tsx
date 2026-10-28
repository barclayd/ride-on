import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { easeOut } from '../lib/math';

const SCORE = 86;

/** The score ring, counting up the first time it comes into view. */
export default function ScoreRing() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const reduced = useReducedMotion();
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setScore(SCORE);
      return;
    }
    const controls = animate(0, SCORE, {
      duration: 1.5,
      ease: easeOut,
      onUpdate: (value) => setScore(Math.round(value)),
    });
    return () => controls.stop();
  }, [inView, reduced]);

  return (
    <div
      ref={ref}
      className="ring"
      role="img"
      aria-label={`Scored ${SCORE} out of 100`}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle
          cx={18}
          cy={18}
          r={15.5}
          fill="none"
          stroke="#3A3A3C"
          strokeWidth={3}
        />
        <circle
          cx={18}
          cy={18}
          r={15.5}
          fill="none"
          stroke="#30D158"
          strokeWidth={3}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${score} 100`}
        />
      </svg>
      <div className="ring-number" aria-hidden="true">
        {score}
      </div>
    </div>
  );
}
