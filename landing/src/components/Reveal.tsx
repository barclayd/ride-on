import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { clamp, easeOut } from '../lib/math';
import { entering, useScrollProgress } from '../lib/scroll';

/** The hero: a panel that grows to fill the screen as it scrolls in, then the copy and phone settle onto it. */
export default function Reveal() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollProgress(ref, entering);
  const p = useReducedMotion() ? 1 : progress;
  const e = easeOut(p);
  const hero = clamp((p - 0.55) / 0.45);

  return (
    <section ref={ref} className="reveal">
      <div className="reveal-stage">
        <div
          className="reveal-panel"
          data-motion
          style={{
            transform: `scale(${0.78 + 0.22 * e})`,
            borderRadius: Math.round(56 * (1 - e)),
          }}
        />
        <div className="reveal-content">
          <div
            className="hero"
            data-motion
            style={{
              opacity: hero,
              transform: `translateY(${40 * (1 - hero)}px)`,
            }}
          >
            <div className="hero-eyebrow">Plan your rides.</div>
            <h2>Pick the right ride.</h2>
            <p>
              Ride On checks the forecast along every kilometre of your
              favourite routes, at the time you'll actually ride them, and tells
              you which one to do and when to leave.
            </p>
            <div className="hero-actions">
              <a className="button" href="#beta">
                Join the beta
              </a>
              {/* The web app isn't public yet. */}
              <button type="button" className="link-button">
                Open the web app ›
              </button>
            </div>
          </div>
          <div
            className="phone"
            data-motion
            style={{
              opacity: hero,
              transform: `translateY(${80 * (1 - hero)}px) rotate(${4 * (1 - hero)}deg)`,
            }}
          >
            <div className="phone-frame">
              <picture>
                <source
                  srcSet="/screens/rides-dark.webp"
                  media="(prefers-color-scheme: dark)"
                />
                <img
                  src="/screens/rides-light.webp"
                  width={276}
                  height={592}
                  alt="Ride On on iPhone, recommending today's best ride"
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
