import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Campus+ cinematic launch intro — architecture guards.
 *
 * The launch screen is the real `campus.html` choreography, not a spinner:
 * these tests pin the stage set, the resilience contract (reduced motion,
 * cleanup, failsafe) and the loading-layer wiring, so the integration cannot
 * silently degrade into a generic loader.
 */

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const LOADER = path.join('components', 'ui', 'CampusIntroLoader.js');
const GATE = path.join('components', 'layout', 'HomeLaunchGate.js');
const HOME_LAYOUT = path.join('app', '(app)', 'home', 'layout.js');
const HOME_PAGE = path.join('app', '(app)', 'home', 'page.js');
const INTRO_CSS = path.join('app', 'styles', 'intro.css');

describe('cinematic launch choreography (campus.html source of truth)', () => {
  it('keeps every choreography stage', () => {
    const source = read(LOADER);
    for (const stage of [
      'drawCurve',
      'moveComet',
      'endFlare',
      'revealPlus',
      'revealCampus',
      'particleBurst',
      'lightSweepAnimation',
      'holdLogo',
      'fadeScene',
    ]) {
      expect(source).toContain(stage);
    }
  });

  it('rides the comet along the real curve with requestAnimationFrame', () => {
    const source = read(LOADER);
    expect(source).toContain('getPointAtLength');
    expect(source).toContain('getTotalLength');
    expect(source).toContain('requestAnimationFrame');
    // The signature curve and its 1200x700 stage survive the port.
    expect(source).toContain('M 120 560');
    expect(source).toContain('viewBox');
    expect(source).toContain('preserveAspectRatio');
  });

  it('renders responsive scenes instead of forcing desktop geometry on phones', () => {
    const source = read(LOADER);
    expect(source).toContain('LAYOUTS');
    expect(source).toContain('narrow');
    expect(source).toContain('0 0 1200 700');
    expect(source).toContain('0 0 720 700');
  });

  it('paints only through the intro stylesheet (no colour literals in the component)', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(read(LOADER))).toBe(false);
    const css = read(INTRO_CSS);
    for (const colour of ['#203f98', '#10255e', '#050c29', '#010207', '#6594ff']) {
      expect(css).toContain(colour);
    }
    expect(read('app/globals.css')).toContain("./styles/intro.css");
  });
});

describe('launch resilience (never blocks the app)', () => {
  it('respects prefers-reduced-motion with a simplified reveal', () => {
    const source = read(LOADER);
    expect(source).toContain('prefers-reduced-motion');
    expect(source).toContain('showFinalFrame');
  });

  it('cleans up every frame and timer on unmount', () => {
    const source = read(LOADER);
    expect(source).toContain('cancelAnimationFrame');
    expect(source).toContain('clearTimeout');
  });

  it('has a hard display failsafe and a skip path', () => {
    const source = read(LOADER);
    expect(source).toContain('MAX_DISPLAY');
    expect(source).toContain('forceFinish');
    expect(source).toContain('Escape');
  });
});

describe('home loading-layer wiring (once per session, behind the overlay)', () => {
  it('mounts the gate from the Home layout, decided by a session cookie', () => {
    const layout = read(HOME_LAYOUT);
    expect(layout).toContain('readIntroSeen');
    expect(layout).toContain('HomeLaunchGate');
    // The launch layer must not do its own data fetching.
    expect(layout).not.toMatch(/supabase|requireUser|getCampusFeed/);
  });

  it('marks the intro as seen once per browsing session', () => {
    const gate = read(GATE);
    expect(gate).toContain('campus_intro');
    // Session cookie on purpose — the write never makes it persistent.
    expect(gate).not.toMatch(/max-age=/i);
    expect(gate).toContain('sessionStorage');
  });

  it('lets the Home page signal readiness and renders Home behind the scene', () => {
    expect(read(HOME_PAGE)).toContain('HomeReadySignal');
    const gate = read(GATE);
    expect(gate).toContain('markContentReady');
    expect(gate).toContain('{children}');
    expect(gate).toContain('CampusIntroLoader');
  });
});
