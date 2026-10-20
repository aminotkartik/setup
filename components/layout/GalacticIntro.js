'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './GalacticIntro.module.css';

// Memory belongs to this document only. No cookies/storage and no route keys.
// A completed intro cannot replay even if the boundary is later remounted.
let completed = false;

export default function GalacticIntro({ children }) {
  // Identical server/client first render; consult document memory in the effect.
  const [phase, setPhase] = useState('waiting');
  const focusOnReveal = useRef(false);
  const content = useRef(null);
  const campus = useRef(null);
  const plus = useRef(null);
  const skip = useRef(null);

  function finish() {
    focusOnReveal.current = document.activeElement === skip.current;
    completed = true;
    setPhase('done');
  }

  useEffect(() => {
    if (completed) {
      const timer = setTimeout(() => setPhase('done'), 0);
      return () => clearTimeout(timer);
    }
    let disposed = false;
    let started = false;
    let frame;
    const timers = [];
    const later = (fn, delay) => timers.push(setTimeout(fn, delay));
    const end = () => {
      if (disposed) return;
      focusOnReveal.current = document.activeElement === skip.current;
      completed = true;
      setPhase('done');
    };
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      if (motion.matches) end();
    };
    motion.addEventListener('change', onMotion);
    const onKey = (event) => {
      if (event.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    // Independent of animation events, fonts and SVG APIs.
    later(end, 6200);

    function start() {
      if (disposed || started || completed) return;
      started = true;
      // Freeze fallback typography if the bounded font wait expired, so a late
      // swap cannot invalidate the measured plus position.
      if (!document.fonts?.check('800 84px "Campus Galactic Syne"')) {
        campus.current.style.fontFamily = 'sans-serif';
        plus.current.style.fontFamily = 'sans-serif';
      }
      try {
        const c = campus.current.getComputedTextLength();
        const p = plus.current.getComputedTextLength();
        if (!(c > 0 && p > 0)) throw new Error('Invalid text metrics');
        const x = (760 - c - 24 - p) / 2;
        campus.current.setAttribute('x', x);
        plus.current.setAttribute('x', x + c + 24);
      } catch {
        // Fallback positioning remains centred; never hold the page for metrics.
      }
      setPhase('playing');
      later(() => {
        if (!completed) setPhase('fading');
      }, 5250);
      later(end, 5650);
    }
    if (motion.matches) {
      later(end, 100);
    } else {
      // Explicitly request the faces: fonts.ready alone can resolve before CSS
      // has caused a font request. Bound the wait for offline/failing fonts.
      const fonts = document.fonts;
      if (fonts) {
        Promise.all([
          fonts.load('800 84px "Campus Galactic Syne"'),
          fonts.load('400 13px "Campus Galactic Space"'),
        ]).then(() => {
          if (!disposed) frame = requestAnimationFrame(start);
        }, start);
      }
      later(start, 400);
    }
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', onMotion);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (phase === 'done' && focusOnReveal.current) {
      content.current?.focus({ preventScroll: true });
      focusOnReveal.current = false;
    }
  }, [phase]);

  const visible = phase !== 'done';
  return (
    <>
      {visible && (
        <section
          className={styles.stage}
          data-phase={phase}
          aria-label="Campus+ intro"
        >
          <div aria-hidden="true" className={styles.scenery}>
            <div className={styles.nebula}>
              <div />
              <div />
            </div>
            <div className={styles.stars} />
            <div className={styles.haze} />
            <div className={styles.vignette} />
            <div className={styles.flare} />
            <div className={styles.center}>
              <div className={styles.lockup}>
                <svg
                  className={styles.logo}
                  viewBox="0 0 760 110"
                  preserveAspectRatio="xMidYMid meet"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <text ref={campus} x="112" y="62" className={styles.campus}>
                    CAMPUS
                  </text>
                  <text ref={plus} x="600" y="62" className={styles.plus}>
                    +
                  </text>
                </svg>
              </div>
              <div className={styles.tagline}>THE PCCOE FORUM</div>
            </div>
          </div>
          <button
            ref={skip}
            type="button"
            className={styles.skip}
            onClick={finish}
          >
            Skip intro
          </button>
        </section>
      )}
      <div ref={content} tabIndex={-1} inert={visible ? true : undefined}>
        {children}
      </div>
    </>
  );
}
