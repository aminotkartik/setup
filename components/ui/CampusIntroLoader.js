'use client';

/**
 * Campus+ cinematic launch intro.
 *
 * A faithful React port of the branded `campus.html` loading sequence: a deep
 * blue sky gathers stars, a glowing curve draws itself, a comet rides that
 * exact path, flares at the endpoint, the "+" springs in, CAMPUS rises, a
 * particle burst and a light sweep finish the mark, the scene holds and fades
 * into the interface underneath. The choreography is the real one — same
 * stages (`drawCurve`, `moveComet`, `endFlare`, `revealPlus`, `revealCampus`,
 * `particleBurst`, `lightSweepAnimation`, `holdLogo`, `fadeScene`), same
 * easings, same gradients and filters — reorganised for React:
 *
 *   - SVG gradients/filters are inlined once per mount; every painted colour
 *     lives in `app/styles/intro.css` (the design system's "no hardcoded
 *     colour in a component" rule), while the cinematic palette itself stays
 *     deliberately its own — atmospheric contrast before the warm UI.
 *   - Motion is driven through `requestAnimationFrame` + DOM/SVG writes only:
 *     zero React re-renders inside the frame loops.
 *   - Every timer and animation frame is tracked and cancelled on unmount, so
 *     nothing keeps running after the loader disappears.
 *   - `prefers-reduced-motion` gets a short, static reveal of the completed
 *     mark instead of the full flight — branding stays, motion goes.
 *
 * The component is purely presentational. Session state, readiness
 * coordination and the failsafe wiring belong to `HomeLaunchGate`; this file
 * accepts `ready` (Home content has arrived) so the post-reveal hold can hand
 * over to the interface the moment it exists — and never longer than
 * `TIMELINE.MAX_DISPLAY`.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Stage durations in ms. Each constant carries the original standalone
 * timing in parentheses — the choreography is unchanged, the run is paced for
 * a web launch (~8s end to end) rather than a splash video, and the whole
 * sequence is skippable (click / Escape / Enter / Space).
 */
const TIMELINE = {
  START_DELAY: 250, // (250) before the first beat
  LEAD_IN: 200, // (250) sky settle before the stars
  STAR_STAGGER: 22, // (24) per star
  STAR_GAP: 300, // (400) stars → curve
  DRAW_CURVE: 1750, // (2400) stroke-dashoffset draw
  COMET_TRAVEL: 1950, // (2700) along the path
  FLARE_HOLD: 160, // (180) after the pop
  FLARE_BLOOM: 320, // (350) bloom to 1.8x
  PLUS_SPRING: 640, // (850) easeOutBack pop
  CAMPUS_RISE: 700, // (900) easeOut rise
  BURST: 800, // (1000) particle flight
  BURST_STAGGER: 22, // (25) per particle
  SWEEP: 820, // (1200) light sweep travel
  SWEEP_HOLD: 560, // (700) before the sweep dims
  SWEEP_TAIL: 280, // (400) after it dims
  HOLD_READY: 550, // (1800) — trimmed: content is ready, just breathe
  HOLD_SETTLE: 300, // settle once a late `ready` arrives
  HOLD_WAITING: 1800, // max extra hold while Home content streams in
  FADE: 780, // (900) scene fade
  REDUCED_FADE: 520, // shorter fade for the reduced-motion reveal
  FORCE_FADE: 450, // fade used by skip / failsafe
  MAX_DISPLAY: 10000, // hard failsafe — the loader never blocks forever
};

/* -------------------------------------------------------------------------- */
/* Scene geometry                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The standalone scene is authored on a 1200×700 stage. On portrait screens
 * `slice` would crop the wordmark and strand the plus outside the frame, so
 * portrait gets its own composition: the same arc → flare → plus → CAMPUS
 * lockup (same visual relationships, same choreography) re-aimed to a
 * 720×700 stage where the worst-case visible band (~0.46 aspect) still holds
 * the full mark, the comet's entry point and the endpoint flare.
 */
const STAR_POSITIONS = [
  [80, 120, 1.2],
  [145, 210, 1.7],
  [205, 85, 1],
  [270, 150, 1.3],
  [340, 95, 1],
  [405, 170, 1.6],
  [475, 80, 1],
  [545, 125, 1.5],
  [625, 70, 1],
  [700, 135, 1.4],
  [780, 80, 1],
  [855, 145, 1.5],
  [935, 90, 1],
  [1015, 160, 1.5],
  [1090, 105, 1],
  [70, 450, 1],
  [145, 525, 1.5],
  [225, 470, 1],
  [305, 570, 1.4],
  [385, 510, 1],
  [465, 585, 1.5],
  [545, 520, 1],
  [655, 580, 1.5],
  [735, 515, 1],
  [820, 570, 1.4],
  [905, 500, 1],
  [985, 565, 1.5],
  [1070, 475, 1],
  [1140, 535, 1.4],
];

const PARTICLE_POSITIONS = [
  [490, 330, 2],
  [530, 300, 1.5],
  [570, 285, 2],
  [610, 275, 1.5],
  [650, 285, 2],
  [690, 300, 1.5],
  [730, 330, 2],
  [490, 420, 1.5],
  [530, 445, 2],
  [575, 460, 1.5],
  [620, 465, 2],
  [665, 455, 1.5],
  [710, 435, 2],
  [745, 410, 1.5],
];

/* Portrait table: the starfield re-spreads across the narrower stage and the
   burst ring keeps the original offsets, scaled around the wordmark. */
const NARROW_STARS = STAR_POSITIONS.map(([cx, cy, r]) => [60 + cx * 0.45, cy, r]);
const NARROW_PARTICLES = PARTICLE_POSITIONS.map(([cx, cy, r]) => [
  315 + (cx - 585) * 0.62,
  385 + (cy - 375) * 0.78,
  r,
]);

const LAYOUTS = {
  wide: {
    viewBox: '0 0 1200 700',
    sky: [1200, 700],
    // The signature curve — the comet's exact track.
    arc: 'M 120 560 C 245 230, 515 85, 745 150 C 830 175, 900 205, 940 235',
    arcStart: [120, 560],
    flare: [940, 235],
    plus: [940, 330],
    word: [585, 375],
    wordSize: 94,
    wordSpacing: -5,
    plusArm: 48,
    plusBar: 20,
    flareH: [240, 4],
    flareV: [4, 150],
    flareCore: 6,
    sweep: { x: 350, y: 350, w: 430, h: 3, r: 2, travel: 500 },
    stars: STAR_POSITIONS,
    particles: PARTICLE_POSITIONS,
  },
  narrow: {
    viewBox: '0 0 720 700',
    sky: [720, 700],
    arc: 'M 218 585 C 246 320, 350 162, 424 186 C 448 193, 460 214, 472 240',
    arcStart: [218, 585],
    flare: [472, 240],
    plus: [472, 332],
    word: [315, 385],
    wordSize: 50,
    wordSpacing: -2.5,
    plusArm: 28,
    plusBar: 12,
    flareH: [72, 2.5],
    flareV: [2.5, 45],
    flareCore: 4,
    sweep: { x: 155, y: 360, w: 330, h: 3, r: 2, travel: 360 },
    stars: NARROW_STARS,
    particles: NARROW_PARTICLES,
  },
};

/* -------------------------------------------------------------------------- */
/* Easing — identical curves to the standalone implementation                  */
/* -------------------------------------------------------------------------- */

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/* -------------------------------------------------------------------------- */
/* Scene selection — SSR-safe viewport read                                    */
/* -------------------------------------------------------------------------- */

function subscribeToOrientation(onStoreChange) {
  window.addEventListener('resize', onStoreChange);
  window.addEventListener('orientationchange', onStoreChange);
  return () => {
    window.removeEventListener('resize', onStoreChange);
    window.removeEventListener('orientationchange', onStoreChange);
  };
}

function readSceneSnapshot() {
  return window.innerHeight > window.innerWidth ? 'narrow' : 'wide';
}

function getServerSceneSnapshot() {
  return null;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Plays the launch sequence over the interface behind it and calls
 * `onComplete` once the fade has handed over.
 *
 * @param {{ ready?: boolean, onComplete?: () => void }} props
 *   `ready` — Home content has committed (drives the post-reveal hand-over);
 *   `onComplete` — the scene has fully faded and may unmount.
 */
export default function CampusIntroLoader({ ready = true, onComplete }) {
  const stageRef = useRef(null);
  const arcRef = useRef(null);
  const arcGlowRef = useRef(null);
  const cometRef = useRef(null);
  const flareRef = useRef(null);
  const campusRef = useRef(null);
  const plusRef = useRef(null);
  const lightSweepRef = useRef(null);
  const starsRef = useRef([]);
  const particlesRef = useRef([]);

  // Callback/ready plumbing lives in refs so prop updates never restart the
  // choreography (the effect below only depends on the chosen scene).
  const onCompleteRef = useRef(onComplete);
  const readyRef = useRef(ready);
  const readyResolversRef = useRef(new Set());

  // Portrait vs landscape is read through useSyncExternalStore: the server
  // renders the neutral sky (null), the client picks the matching scene right
  // after hydration — no window during SSR, no hydration mismatch. A resize
  // that flips the aspect re-plays the sequence onto the new stage.
  const scene = useSyncExternalStore(
    subscribeToOrientation,
    readSceneSnapshot,
    getServerSceneSnapshot,
  );

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    readyRef.current = ready;
    if (ready) {
      readyResolversRef.current.forEach((resolve) => resolve(true));
      readyResolversRef.current.clear();
    }
  }, [ready]);

  useEffect(() => {
    if (!scene) return undefined;

    const L = LAYOUTS[scene] || LAYOUTS.wide;

    const stage = stageRef.current;
    const arc = arcRef.current;
    const arcGlow = arcGlowRef.current;
    const comet = cometRef.current;
    const flare = flareRef.current;
    const campus = campusRef.current;
    const plus = plusRef.current;
    const lightSweep = lightSweepRef.current;

    if (!stage || !arc || !arcGlow || !comet || !flare || !campus || !plus || !lightSweep) {
      return undefined;
    }

    const stars = starsRef.current;
    const particles = particlesRef.current;
    const pathLength = arc.getTotalLength();
    const readyResolvers = readyResolversRef.current;

    /* ── run state ──────────────────────────────────────────────────────── */

    let running = true; // false after unmount
    let generation = 0; // invalidates in-flight stages (skip / restart)
    let finished = false;
    const startedAt = performance.now();

    const timeouts = new Set();
    const frames = new Set();

    const alive = (id) => running && id === generation;

    const addTimeout = (fn, ms) => {
      const handle = window.setTimeout(() => {
        timeouts.delete(handle);
        fn();
      }, ms);
      timeouts.add(handle);
      return handle;
    };

    const wait = (ms) =>
      new Promise((resolve) => {
        addTimeout(resolve, ms);
      });

    const nextFrame = (fn) => {
      const handle = window.requestAnimationFrame((now) => {
        frames.delete(handle);
        fn(now);
      });
      frames.add(handle);
      return handle;
    };

    // Forces a style flush so the next style write transitions from the
    // current state (offsetWidth does not exist on SVG elements).
    const reflow = (el) => el.getBoundingClientRect();

    const waitForReady = (ms) =>
      new Promise((resolve) => {
        if (readyRef.current) {
          resolve(true);
          return;
        }
        const settle = (value) => {
          readyResolvers.delete(resolver);
          resolve(value);
        };
        const resolver = () => settle(true);
        readyResolvers.add(resolver);
        addTimeout(() => settle(false), ms);
      });

    /* ── scene frames ───────────────────────────────────────────────────── */

    const resetScene = () => {
      stars.forEach((star) => {
        star.style.transition = 'none';
        star.style.opacity = '0';
        star.style.transform = 'scale(.5)';
      });

      arc.style.transition = 'none';
      arc.style.opacity = '0';
      arc.style.strokeDasharray = pathLength;
      arc.style.strokeDashoffset = pathLength;

      arcGlow.style.transition = 'none';
      arcGlow.style.opacity = '0';
      arcGlow.style.strokeDasharray = pathLength;
      arcGlow.style.strokeDashoffset = pathLength;

      comet.style.transition = 'none';
      comet.style.opacity = '0';
      comet.setAttribute('transform', `translate(${L.arcStart[0]} ${L.arcStart[1]})`);

      flare.style.transition = 'none';
      flare.style.opacity = '0';
      flare.setAttribute('transform', `translate(${L.flare[0]} ${L.flare[1]}) scale(.1)`);

      campus.style.transition = 'none';
      campus.style.opacity = '0';
      campus.setAttribute('transform', `translate(${L.word[0]} ${L.word[1]}) scale(.55)`);

      plus.style.transition = 'none';
      plus.style.opacity = '0';
      plus.setAttribute('transform', `translate(${L.plus[0]} ${L.plus[1]}) scale(.1)`);

      lightSweep.style.transition = 'none';
      lightSweep.style.opacity = '0';
      lightSweep.setAttribute('transform', `translate(${-L.sweep.travel} 0)`);

      particles.forEach((particle) => {
        particle.style.transition = 'none';
        particle.style.opacity = '0';
        particle.style.transform = 'translate(0,0) scale(.5)';
      });

      stage.style.transition = 'none';
      stage.style.opacity = '1';
    };

    /** The completed mark — also the whole reduced-motion reveal. */
    const showFinalFrame = () => {
      resetScene();
      stars.forEach((star) => {
        star.style.opacity = String(0.28 + star.getAttribute('r') * 0.1);
        star.style.transform = 'scale(1)';
      });
      arc.style.opacity = '1';
      arc.style.strokeDashoffset = '0';
      arcGlow.style.opacity = '.5';
      arcGlow.style.strokeDashoffset = '0';
      campus.style.opacity = '1';
      campus.setAttribute('transform', `translate(${L.word[0]} ${L.word[1]}) scale(1)`);
      plus.style.opacity = '1';
      plus.setAttribute('transform', `translate(${L.plus[0]} ${L.plus[1]}) scale(1)`);
    };

    /* ── the choreography ───────────────────────────────────────────────── */

    const animateStars = async (id) => {
      for (let i = 0; i < stars.length; i += 1) {
        if (!alive(id)) return;
        const star = stars[i];
        star.style.transition = 'opacity .7s ease, transform .7s ease';
        star.style.opacity = String(0.25 + Math.random() * 0.75);
        star.style.transform = 'scale(1)';
        await wait(TIMELINE.STAR_STAGGER);
      }
    };

    const drawCurve = async (id) => {
      if (!alive(id)) return;

      arc.style.opacity = '1';
      arcGlow.style.opacity = '.8';

      arc.style.strokeDasharray = pathLength;
      arc.style.strokeDashoffset = pathLength;
      arcGlow.style.strokeDasharray = pathLength;
      arcGlow.style.strokeDashoffset = pathLength;

      reflow(arc);

      const draw = `stroke-dashoffset ${TIMELINE.DRAW_CURVE}ms cubic-bezier(.65,0,.2,1)`;
      arc.style.transition = draw;
      arcGlow.style.transition = draw;

      arc.style.strokeDashoffset = '0';
      arcGlow.style.strokeDashoffset = '0';

      await wait(TIMELINE.DRAW_CURVE);
    };

    const moveComet = async (id) => {
      if (!alive(id)) return;

      comet.style.opacity = '1';

      const duration = TIMELINE.COMET_TRAVEL;
      const start = performance.now();

      await new Promise((resolve) => {
        const frame = (now) => {
          if (!alive(id)) {
            resolve();
            return;
          }

          let progress = (now - start) / duration;
          progress = Math.max(0, Math.min(1, progress));

          const distance = pathLength * easeInOut(progress);
          const point = arc.getPointAtLength(distance);
          const nextPoint = arc.getPointAtLength(Math.min(pathLength, distance + 5));
          const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * (180 / Math.PI);

          comet.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle})`);

          if (progress < 1) {
            nextFrame(frame);
          } else {
            resolve();
          }
        };
        nextFrame(frame);
      });
    };

    const endFlare = async (id) => {
      if (!alive(id)) return;

      comet.style.transition = 'opacity .2s ease';
      comet.style.opacity = '0';

      flare.style.opacity = '1';
      flare.setAttribute('transform', `translate(${L.flare[0]} ${L.flare[1]}) scale(.15)`);
      reflow(flare);

      flare.style.transition = `transform ${TIMELINE.FLARE_HOLD + TIMELINE.FLARE_BLOOM}ms cubic-bezier(.2,.8,.2,1), opacity .5s ease`;
      flare.setAttribute('transform', `translate(${L.flare[0]} ${L.flare[1]}) scale(1)`);

      await wait(TIMELINE.FLARE_HOLD);
      if (!alive(id)) return;

      flare.setAttribute('transform', `translate(${L.flare[0]} ${L.flare[1]}) scale(1.8)`);
      flare.style.opacity = '.2';

      await wait(TIMELINE.FLARE_BLOOM);
      if (!alive(id)) return;

      flare.style.opacity = '0';
    };

    const revealPlus = async (id) => {
      if (!alive(id)) return;

      plus.style.opacity = '1';
      plus.setAttribute('transform', `translate(${L.plus[0]} ${L.plus[1]}) scale(.1)`);
      reflow(plus);

      const duration = TIMELINE.PLUS_SPRING;
      const start = performance.now();

      await new Promise((resolve) => {
        const frame = (now) => {
          if (!alive(id)) {
            resolve();
            return;
          }

          let progress = (now - start) / duration;
          progress = Math.min(1, Math.max(0, progress));

          const scale = 0.1 + 0.9 * easeOutBack(progress);
          plus.setAttribute('transform', `translate(${L.plus[0]} ${L.plus[1]}) scale(${scale})`);

          if (progress < 1) {
            nextFrame(frame);
          } else {
            resolve();
          }
        };
        nextFrame(frame);
      });
    };

    const revealCampus = async (id) => {
      if (!alive(id)) return;

      campus.style.opacity = '1';

      const duration = TIMELINE.CAMPUS_RISE;
      const start = performance.now();

      await new Promise((resolve) => {
        const frame = (now) => {
          if (!alive(id)) {
            resolve();
            return;
          }

          let progress = (now - start) / duration;
          progress = Math.min(1, Math.max(0, progress));

          const scale = 0.55 + 0.45 * easeOut(progress);
          campus.setAttribute('transform', `translate(${L.word[0]} ${L.word[1]}) scale(${scale})`);

          if (progress < 1) {
            nextFrame(frame);
          } else {
            resolve();
          }
        };
        nextFrame(frame);
      });
    };

    const particleBurst = async (id) => {
      if (!alive(id)) return;

      const [centerX, centerY] = L.word;

      particles.forEach((particle, index) => {
        const x = parseFloat(particle.getAttribute('cx') || '0');
        const y = parseFloat(particle.getAttribute('cy') || '0');
        const dx = x - centerX;
        const dy = y - centerY;

        particle.style.opacity = '.85';
        particle.style.transition = `transform ${TIMELINE.BURST}ms cubic-bezier(.15,.8,.2,1), opacity ${TIMELINE.BURST}ms ease`;
        particle.style.transform = `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1.4)`;

        addTimeout(() => {
          if (!alive(id)) return;
          particle.style.transform = `translate(${dx * 0.65}px, ${dy * 0.65}px) scale(.1)`;
          particle.style.opacity = '0';
        }, 250 + index * TIMELINE.BURST_STAGGER);
      });

      await wait(TIMELINE.BURST);
    };

    const lightSweepAnimation = async (id) => {
      if (!alive(id)) return;

      lightSweep.style.opacity = '.7';
      lightSweep.setAttribute('transform', `translate(${-L.sweep.travel} 0)`);
      reflow(lightSweep);

      lightSweep.style.transition = `transform ${TIMELINE.SWEEP}ms cubic-bezier(.2,.7,.2,1), opacity .2s ease`;
      lightSweep.setAttribute('transform', `translate(${L.sweep.travel} 0)`);

      await wait(TIMELINE.SWEEP_HOLD);
      if (!alive(id)) return;

      lightSweep.style.opacity = '0';

      await wait(TIMELINE.SWEEP_TAIL);
    };

    /**
     * After the meaningful reveal: breathe on the finished mark and hand over
     * the moment Home is there — never idling past the failsafe budget.
     */
    const holdLogo = async (id) => {
      if (!alive(id)) return;

      const elapsed = performance.now() - startedAt;
      const budget = Math.max(0, TIMELINE.MAX_DISPLAY - TIMELINE.FADE - 250 - elapsed);

      if (readyRef.current) {
        await wait(TIMELINE.HOLD_READY);
      } else {
        const gotReady = await waitForReady(Math.min(budget, TIMELINE.HOLD_WAITING));
        if (gotReady && alive(id)) await wait(TIMELINE.HOLD_SETTLE);
      }
    };

    const fadeScene = async (id, duration = TIMELINE.FADE) => {
      if (!alive(id)) return;

      stage.style.transition = `opacity ${duration}ms ease`;
      stage.style.opacity = '0';

      await wait(duration);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      onCompleteRef.current?.();
    };

    /* ── sequencing ─────────────────────────────────────────────────────── */

    const playAnimation = async () => {
      generation += 1;
      const id = generation;

      resetScene();
      await wait(TIMELINE.LEAD_IN);
      if (!alive(id)) return;

      animateStars(id);

      await wait(TIMELINE.STAR_GAP);
      await drawCurve(id);
      await moveComet(id);
      await endFlare(id);
      await revealPlus(id);
      await revealCampus(id);
      particleBurst(id);
      await lightSweepAnimation(id);
      await holdLogo(id);
      await fadeScene(id);
      if (!alive(id)) return;

      finish();
    };

    /** Skip / failsafe entry: land on the completed mark, fade, done. */
    const forceFinish = () => {
      if (finished) return;
      generation += 1;
      const id = generation;

      if (!running) return;

      showFinalFrame();
      (async () => {
        await fadeScene(id, TIMELINE.FORCE_FADE);
        if (!alive(id)) return;
        finish();
      })();
    };

    const onSkipKey = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        forceFinish();
      }
    };

    /* ── run ────────────────────────────────────────────────────────────── */

    resetScene();

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      // Short, simplified reveal: the completed mark, a breath, a gentle fade.
      generation += 1;
      const id = generation;
      showFinalFrame();
      (async () => {
        await holdLogo(id);
        await fadeScene(id, TIMELINE.REDUCED_FADE);
        if (!alive(id)) return;
        finish();
      })();
    } else {
      addTimeout(playAnimation, TIMELINE.START_DELAY);
    }

    // Failsafe: no matter what happens, the interface becomes reachable.
    addTimeout(forceFinish, TIMELINE.MAX_DISPLAY);

    // The scene is the interface until it fades — click or key to move on.
    stage.addEventListener('pointerdown', forceFinish);
    window.addEventListener('keydown', onSkipKey);

    // Nothing scrolls behind the launch screen.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      running = false;
      generation += 1;
      timeouts.forEach((handle) => window.clearTimeout(handle));
      timeouts.clear();
      frames.forEach((handle) => window.cancelAnimationFrame(handle));
      frames.clear();
      readyResolvers.clear();
      stage.removeEventListener('pointerdown', forceFinish);
      window.removeEventListener('keydown', onSkipKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [scene]);

  const stars = scene ? LAYOUTS[scene].stars : LAYOUTS.wide.stars;
  const particles = scene ? LAYOUTS[scene].particles : LAYOUTS.wide.particles;
  const L = scene ? LAYOUTS[scene] : LAYOUTS.wide;

  return (
    <div ref={stageRef} className="campus-intro" role="status" aria-label="Campus+ is launching">
      {scene ? (
        <svg
          viewBox={L.viewBox}
          preserveAspectRatio="xMidYMid slice"
          className="campus-intro__svg"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="cpIntroSky">
              <stop offset="0%" className="campus-intro__sky-1" />
              <stop offset="42%" className="campus-intro__sky-2" />
              <stop offset="72%" className="campus-intro__sky-3" />
              <stop offset="100%" className="campus-intro__sky-4" />
            </radialGradient>

            <linearGradient id="cpIntroArc" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" className="campus-intro__arc-1" />
              <stop offset="25%" className="campus-intro__arc-2" />
              <stop offset="52%" className="campus-intro__arc-3" />
              <stop offset="75%" className="campus-intro__arc-4" />
              <stop offset="100%" className="campus-intro__arc-5" />
            </linearGradient>

            <radialGradient id="cpIntroComet">
              <stop offset="0%" className="campus-intro__comet-1" />
              <stop offset="25%" className="campus-intro__comet-2" />
              <stop offset="65%" className="campus-intro__comet-3" />
              <stop offset="100%" className="campus-intro__comet-4" />
            </radialGradient>

            <linearGradient id="cpIntroTrail" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" className="campus-intro__trail-1" />
              <stop offset="45%" className="campus-intro__trail-2" />
              <stop offset="100%" className="campus-intro__trail-3" />
            </linearGradient>

            <linearGradient id="cpIntroFlareH" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" className="campus-intro__flare-1" />
              <stop offset="50%" className="campus-intro__flare-2" />
              <stop offset="100%" className="campus-intro__flare-1" />
            </linearGradient>

            <linearGradient id="cpIntroFlareV" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" className="campus-intro__flare-1" />
              <stop offset="50%" className="campus-intro__flare-2" />
              <stop offset="100%" className="campus-intro__flare-1" />
            </linearGradient>

            <filter id="cpIntroGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="cpIntroCometGlow" x="-400%" y="-400%" width="800%" height="800%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect width={L.sky[0]} height={L.sky[1]} fill="url(#cpIntroSky)" />

          <g>
            {stars.map(([cx, cy, r], index) => (
              <circle
                key={`star-${index}`}
                ref={(el) => {
                  if (el) starsRef.current[index] = el;
                }}
                cx={cx}
                cy={cy}
                r={r}
                className="campus-intro__star"
                opacity="0"
              />
            ))}
          </g>

          <path
            ref={arcGlowRef}
            d={L.arc}
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            className="campus-intro__arc-glow"
            opacity="0"
            filter="url(#cpIntroGlow)"
          />

          <path
            ref={arcRef}
            d={L.arc}
            fill="none"
            stroke="url(#cpIntroArc)"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0"
            filter="url(#cpIntroGlow)"
          />

          <g ref={cometRef} opacity="0" filter="url(#cpIntroCometGlow)">
            <ellipse cx="-48" cy="0" rx="75" ry="7" fill="url(#cpIntroTrail)" />
            <circle cx="0" cy="0" r="34" fill="url(#cpIntroComet)" />
            <circle cx="0" cy="0" r="10" className="campus-intro__core-soft" />
            <circle cx="0" cy="0" r="5" className="campus-intro__core-hot" />
          </g>

          <g
            ref={flareRef}
            transform={`translate(${L.flare[0]} ${L.flare[1]}) scale(.1)`}
            opacity="0"
          >
            <rect
              x={-L.flareH[0] / 2}
              y={-L.flareH[1] / 2}
              width={L.flareH[0]}
              height={L.flareH[1]}
              fill="url(#cpIntroFlareH)"
            />
            <rect
              x={-L.flareV[0] / 2}
              y={-L.flareV[1] / 2}
              width={L.flareV[0]}
              height={L.flareV[1]}
              fill="url(#cpIntroFlareV)"
            />
            <circle cx="0" cy="0" r={L.flareCore} className="campus-intro__core-hot" />
          </g>

          <g
            ref={campusRef}
            transform={`translate(${L.word[0]} ${L.word[1]}) scale(.55)`}
            opacity="0"
          >
            <text
              x="0"
              y="0"
              textAnchor="middle"
              fontSize={L.wordSize}
              fontWeight="800"
              letterSpacing={L.wordSpacing}
              className="campus-intro__word"
            >
              CAMPUS
            </text>
          </g>

          {/* The Campus+ mark: the plus, revealed at the curve's endpoint. */}
          <g
            ref={plusRef}
            transform={`translate(${L.plus[0]} ${L.plus[1]}) scale(.1)`}
            opacity="0"
          >
            <rect
              x={-L.plusBar / 2}
              y={-L.plusArm}
              width={L.plusBar}
              height={L.plusArm * 2}
              rx={L.plusBar / 2}
              className="campus-intro__plus-bar"
            />
            <rect
              x={-L.plusArm}
              y={-L.plusBar / 2}
              width={L.plusArm * 2}
              height={L.plusBar}
              rx={L.plusBar / 2}
              className="campus-intro__plus-bar"
            />
          </g>

          <rect
            ref={lightSweepRef}
            x={L.sweep.x}
            y={L.sweep.y}
            width={L.sweep.w}
            height={L.sweep.h}
            rx={L.sweep.r}
            className="campus-intro__sweep"
            opacity="0"
          />

          <g>
            {particles.map(([cx, cy, r], index) => (
              <circle
                key={`particle-${index}`}
                ref={(el) => {
                  if (el) particlesRef.current[index] = el;
                }}
                cx={cx}
                cy={cy}
                r={r}
                className="campus-intro__particle"
                opacity="0"
              />
            ))}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
