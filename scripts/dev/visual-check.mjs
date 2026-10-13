#!/usr/bin/env node
/**
 * Visual check (development tool): looks at the real application in a real
 * browser and writes PNGs plus a JSON report of everything it saw.
 *
 * Lint and a green build cannot tell you whether a page looks right. This runs
 * the authenticated application at the usual breakpoints and in the states that
 * matter — dark, light, reduced motion, no WebGL, mobile — captures full-page
 * screenshots, and records console errors, failed requests and a few measured
 * facts (renderer size, island count, contrast-bearing text nodes).
 *
 *   node scripts/dev/visual-check.mjs [--url http://127.0.0.1:3300] [--out ../screenshots] [--only home]
 *
 * Expects the app to be running (see `scripts/dev/preview.mjs` for the signed-in
 * proxy, or point `--url` at anything that serves the app with a session).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string' },
    settle: { type: 'string' },
  },
  allowPositionals: true,
});

const BASE = (values.url || process.env.PREVIEW_URL || 'http://127.0.0.1:3300').replace(/\/$/, '');
const OUT = path.resolve(values.out || path.join('..', 'screenshots'));
const SETTLE = Number(values.settle || 1400);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  wide: { width: 1680, height: 1000 },
  tablet: { width: 1024, height: 820 },
  mobile: { width: 390, height: 844 },
};

/** The shots worth taking, cheapest first. */
const SHOTS = [
  { name: 'home-desktop-dark', url: '/home', view: 'desktop', scheme: 'dark' },
  { name: 'home-desktop-dark-full', url: '/home', view: 'desktop', scheme: 'dark', fullPage: true },
  { name: 'home-wide-dark', url: '/home', view: 'wide', scheme: 'dark' },
  { name: 'home-desktop-light', url: '/home', view: 'desktop', scheme: 'light' },
  { name: 'home-mobile-dark', url: '/home', view: 'mobile', scheme: 'dark' },
  { name: 'home-mobile-dark-full', url: '/home', view: 'mobile', scheme: 'dark', fullPage: true },
  { name: 'home-desktop-reduced-motion', url: '/home', view: 'desktop', scheme: 'dark', reducedMotion: true },
  { name: 'home-desktop-no-webgl', url: '/home', view: 'desktop', scheme: 'dark', noWebgl: true },
  { name: 'home-tablet-dark', url: '/home', view: 'tablet', scheme: 'dark' },
  { name: 'feed-scroll-mid', url: '/home', view: 'desktop', scheme: 'dark', scrollTo: 0.55 },
  { name: 'home-mobile-light', url: '/home', view: 'mobile', scheme: 'light' },
];

async function collect(page) {
  return page.evaluate(() => {
    const text = (selector) => Array.from(document.querySelectorAll(selector)).map((el) => el.textContent.trim());
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
    };
    const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => ({
      className: canvas.className,
      css: { width: Math.round(canvas.getBoundingClientRect().width), height: Math.round(canvas.getBoundingClientRect().height) },
      backing: { width: canvas.width, height: canvas.height },
      // A canvas with no pixels is worse than no canvas: sample the middle row.
      painted: (() => {
        try {
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (gl) {
            const px = new Uint8Array(4 * 8);
            gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 8, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const nonZero = [...px].filter((v) => v > 4).length;
            return `webgl:${nonZero}/${px.length} non-black`;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const px = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 8, 1).data;
            const nonZero = [...px].filter((v) => v > 4).length;
            return `2d:${nonZero}/${px.length} non-black`;
          }
          return 'unreadable';
        } catch (error) {
          return `error:${String(error.message).slice(0, 40)}`;
        }
      })(),
    }));
    return {
      theme: document.documentElement.dataset.theme || null,
      title: document.title,
      islands: Array.from(document.querySelectorAll('.island')).map((el) => ({
        elevation: el.dataset.elevation || null,
        tone: el.dataset.tone || null,
        kind: el.className.replace(/\s+/g, ' ').slice(0, 60),
        ...(() => {
          const box = el.getBoundingClientRect();
          return { top: Math.round(box.top + window.scrollY), height: Math.round(box.height), width: Math.round(box.width) };
        })(),
        heading: el.querySelector('h1,h2')?.textContent.trim().slice(0, 60) || null,
      })),
      feedItems: document.querySelectorAll('article, .post-card').length,
      composer: Boolean(document.querySelector('form textarea')),
      hero: rect('.island-hero'),
      feedIsland: rect('.island-feed'),
      rail: rect('.rail'),
      firstHeadingSize: (() => {
        const h1 = document.querySelector('h1');
        return h1 ? getComputedStyle(h1).fontSize : null;
      })(),
      headings: text('h1,h2').slice(0, 12),
      canvases,
      // Anything that overflows the viewport horizontally is a bug worth seeing.
      overflowing: Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2 && el.getBoundingClientRect().width > 40)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`),
      scroll: { height: document.documentElement.scrollHeight, viewport: window.innerHeight },
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const report = { base: BASE, at: new Date().toISOString(), shots: [] };

  const shots = SHOTS.filter((shot) => !values.only || shot.name.includes(values.only));

  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: VIEWPORTS[shot.view],
      colorScheme: shot.scheme === 'light' ? 'light' : 'dark',
      deviceScaleFactor: 1,
      reducedMotion: shot.reducedMotion ? 'reduce' : 'no-preference',
      isMobile: shot.view === 'mobile',
      hasTouch: shot.view === 'mobile',
    });
    // The cinematic launch intro is a once-per-browser-session experience; a
    // screenshot run wants the page behind it, not the splash.
    await context.addCookies([
      { name: 'campus_intro', value: '1', url: BASE },
      // The theme is a cookie the server reads (`lib/theme.js`), so the light
      // shots set it the way a student would instead of poking the DOM.
      { name: 'campus_theme', value: shot.scheme === 'light' ? 'light' : 'dark', url: BASE },
    ]);

    const page = await context.newPage();
    // Every page: WebGL contexts in a software rasteriser are slow to die, so
    // the renderer is not allowed to hold the context across a reload.
    await page.addInitScript(() => {
      window.__campusVisualCheck = true;
    });
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 200)}`));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url().slice(0, 90)}`));

    if (shot.noWebgl) {
      await page.addInitScript(() => {
        const fail = () => null;
        HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
          apply(target, self, args) {
            if (String(args[0]).startsWith('webgl')) return fail();
            return Reflect.apply(target, self, args);
          },
        });
      });
    }

    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(SETTLE);
    if (shot.scrollTo) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(height * shot.scrollTo));
      await page.waitForTimeout(600);
    }

    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: Boolean(shot.fullPage) });
    const facts = await collect(page);
    report.shots.push({ name: shot.name, file, view: shot.view, scheme: shot.scheme, reducedMotion: Boolean(shot.reducedMotion), noWebgl: Boolean(shot.noWebgl), consoleErrors, failedRequests, facts });
    console.log(`${shot.name.padEnd(30)} ${JSON.stringify({ islands: facts.islands.length, canvases: facts.canvases.length, feed: facts.feedItems, theme: facts.theme, errors: consoleErrors.length })}`);

    await context.close();
  }

  await browser.close();
  const outfile = path.join(OUT, 'visual-report.json');
  writeFileSync(outfile, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${report.shots.length} shots + ${outfile}`);
}

main().catch((error) => {
  console.error(`visual-check failed: ${error?.stack || error}`);
  process.exit(1);
});
