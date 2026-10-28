import { type RefObject, useEffect, useState } from 'react';
import { clamp } from './math';

type Measure = (rect: DOMRect, viewportHeight: number) => number;

/** 0 → 1 across a tall section's sticky run. */
export const sticky: Measure = (rect, vh) =>
  rect.height - vh > 0 ? clamp(-rect.top / (rect.height - vh)) : 0;

/** 0 → 1 as an element's top travels from the bottom of the viewport to the top. */
export const entering: Measure = (rect, vh) => clamp((vh - rect.top) / vh);

/** Scroll progress through `ref`, recomputed at most once a frame. */
export const useScrollProgress = (
  ref: RefObject<HTMLElement | null>,
  measure: Measure,
) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = ref.current;
      if (element) {
        setProgress(
          measure(element.getBoundingClientRect(), window.innerHeight),
        );
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, measure]);

  return progress;
};
