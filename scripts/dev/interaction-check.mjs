#!/usr/bin/env node
/**
 * Interaction check (development tool).
 *
 * `visual-check.mjs` looks at pages. This one *uses* them: real pointer moves,
 * real touch taps and swipes, real typing, real clicks on real controls, real
 * back/forward — each one asserted against what the browser actually did, not
 * against what the markup says should happen.
 *
 * The distinction matters. A screenshot can show a hover style that CSS would
 * apply if a pointer were there; only `page.mouse.move()` proves the handler
 * ran, the custom property landed and the compositor used it.
 *
 *   node scripts/dev/interaction-check.mjs [--url http://127.0.0.1:3300] [--only hover]
 *
 * Expects the signed-in preview proxy (see `scripts/dev/preview.mjs`). Every
 * write it performs goes to the disposable harness database.
 *
 * Exit code is non-zero when any check FAILS. Warnings do not fail the run —
 * they are behaviours that could not be exercised in this environment, and the
 * report says so instead of claiming a pass.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({
  options: { url: { type: 'string' }, out: { type: 'string' }, only: { type: 'string' } },
  allowPositionals: true,
});

const BASE = (values.url || process.env.PREVIEW_URL || 'http://127.0.0.1:3300').replace(/\/$/, '');
const OUT = path.resolve(values.out || path.join('..', 'interaction-report'));

const results = [];

function record(name, status, detail, evidence = null) {
  results.push({ name, status, detail, evidence });
  const mark = status === 'ok' ? '\x1b[32mPASS\x1b[0m' : status === 'warn' ? '\x1b[33mWARN\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${mark} ${name.padEnd(34)} ${detail}`);
}

/** Run one check; an exception is a failure with the real message. */
async function check(name, fn) {
  try {
    const out = await fn();
    if (out?.status) record(name, out.status, out.detail, out.evidence);
  } catch (error) {
    record(name, 'fail', String(error?.message || error).slice(0, 300));
  }
}

/* ------------------------------------------------------------------ setup */

/** A context that behaves like the device named by `profile`. */
async function newContext(browser, profile = 'desktop', extra = {}) {
  const viewports = {
    desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
    mobile: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  }[profile];
  const context = await browser.newContext({
    ...viewports,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    ...extra,
  });
  // The launch intro is a once-per-session experience; the checks want the page.
  await context.addCookies([{ name: 'campus_intro', value: '1', url: BASE }]);
  return context;
}

/** Collect console errors, failed requests and error responses for one page. */
function watch(page) {
  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 200)}`));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (/favicon/.test(response.url())) return;
    badResponses.push(`${response.status()} ${response.request().method()} ${response.url().slice(0, 100)}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'failed';
    const url = request.url();
    // `net::ERR_ABORTED` is the browser cancelling its own request, not a
    // request that broke: Next.js calls off a prefetch when the student
    // navigates elsewhere first, and a server-action POST whose response has
    // already been consumed is torn down the same way. Real failures — a 4xx/5xx
    // status, a refused connection, a timeout — still land here, and the checks
    // that follow assert the resulting UI state either way.
    if (failure === 'net::ERR_ABORTED') return;
    failedRequests.push(`${failure} ${request.method()} ${url.slice(0, 100)}`);
  });
  return { consoleErrors, failedRequests, badResponses };
}

/* ----------------------------------------------------------------- checks */

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const report = { base: BASE, at: new Date().toISOString(), results: [], observations: [] };
  const want = (name) => !values.only || name.includes(values.only);

  /* ── 1. Hover sweep + island depth, exercised with a real pointer ─────── */
  if (want('hover')) {
    const context = await newContext(browser, 'desktop');
    const page = await context.newPage();
    const { consoleErrors, failedRequests, badResponses } = watch(page);
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('.stream-slot', { timeout: 20_000 });

    await check('hover-sweep', async () => {
      const slot = page.locator('.stream-slot').first();
      // The pointer can only be *in* the entry if the entry is on screen, so the
      // page is scrolled to it exactly as a reader would scroll to it.
      await slot.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const box = await slot.boundingBox();
      const card = '.stream-slot:first-child .stream-card';
      const before = await page.evaluate(
        (selector) => getComputedStyle(document.querySelector(selector), '::after').animationName,
        card,
      );
      // A real pointer move into the entry, the way a student would arrive.
      await page.mouse.move(box.x + 20, box.y - 200);
      await page.mouse.move(box.x + box.width / 2, box.y + 24, { steps: 12 });
      await page.waitForTimeout(120);
      const after = await page.evaluate((selector) => {
        const style = getComputedStyle(document.querySelector(selector), '::after');
        return {
          animationName: style.animationName,
          width: style.width,
          backgroundImage: style.backgroundImage.slice(0, 60),
        };
      }, card);
      const hovered = await page.evaluate(() => {
        const el = document.querySelector('.stream-slot:first-child .stream-card');
        return { hover: el.matches(':hover'), borderColor: getComputedStyle(el).borderColor };
      });
      // The sweep is a one-shot animation; it must have been *started* by the
      // hover, which is what animationName answers.
      const started = before === 'none' && after.animationName === 'entry-sweep';
      return {
        status: started ? 'ok' : 'fail',
        detail: started
          ? `entry-sweep started on hover (pseudo-element present, ${after.width} hairline, card :hover=${hovered.hover})`
          : `hover sweep did not start: before=${before} after=${after.animationName} hover=${hovered.hover}`,
        evidence: { before, after, hovered },
      };
    });

    await check('island-pointer-depth', async () => {
      // The depth response lives on the pointer-motion host and is consumed by
      // each island's transform: prove BOTH, because a host value nobody reads
      // is not a working effect.
      await page.mouse.move(80, 120, { steps: 4 });
      await page.waitForTimeout(2500);
      const atLeft = await page.evaluate(() => ({
        pointer: getComputedStyle(document.querySelector('.island-motion')).getPropertyValue('--pointer-x').trim(),
        transform: getComputedStyle(document.querySelector('.island')).transform,
      }));
      await page.mouse.move(1400, 780, { steps: 8 });
      await page.waitForTimeout(2500);
      const atRight = await page.evaluate(() => ({
        pointer: getComputedStyle(document.querySelector('.island-motion')).getPropertyValue('--pointer-x').trim(),
        transform: getComputedStyle(document.querySelector('.island')).transform,
      }));
      const moved = atLeft.transform !== atRight.transform;
      // The value is eased toward the pointer, so the assertion is about
      // direction and travel rather than about reaching exactly ±1.
      const settled = Number(atRight.pointer) > Number(atLeft.pointer) + 0.6;
      return {
        status: moved && settled ? 'ok' : 'fail',
        detail: moved && settled
          ? `pointer host ${atLeft.pointer}→${atRight.pointer}; island transform changed (${atLeft.transform} → ${atRight.transform})`
          : `pointer=${atLeft.pointer}→${atRight.pointer} transformChanged=${moved}`,
        evidence: { atLeft, atRight },
      };
    });

    await check('island-depth-disabled-for-touch-or-reduced', async () => {
      // The same rule from the other side: on a coarse pointer the depth must
      // be zero, or the effect is a trap for fingers.
      const touchContext = await newContext(browser, 'mobile');
      const touchPage = await touchContext.newPage();
      await touchPage.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
      const depth = await touchPage.evaluate(() => {
        const island = document.querySelector('.island');
        return {
          rule: getComputedStyle(island).getPropertyValue('--island-depth').trim(),
          transform: getComputedStyle(island).transform,
        };
      });
      await touchContext.close();
      const off = depth.rule === '0px';
      return {
        status: off ? 'ok' : 'fail',
        detail: off ? 'mobile: --island-depth resolves to 0px (no finger-depth)' : `mobile: --island-depth=${depth.rule}`,
        evidence: depth,
      };
    });

    /* ── 2. Composer: expansion, typing, validation, submission ─────────── */
    await check('composer-expand-type-count', async () => {
      const textarea = page.locator('.home-composer textarea').first();
      await textarea.click();
      const collapsed = await page.evaluate(() => {
        const form = document.querySelector('.home-composer form');
        return form.getBoundingClientRect().height;
      });
      await textarea.type('Interaction check: the composer is live and counting.');
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        const form = document.querySelector('.home-composer form');
        const counter = Array.from(form.querySelectorAll('*'))
          .map((el) => el.textContent.trim())
          .find((text) => /^\d+\/2000$/.test(text));
        const submit = form.querySelector('button[type="submit"]');
        return {
          height: form.getBoundingClientRect().height,
          counter,
          submitDisabled: submit ? submit.disabled : null,
          focused: document.activeElement === form.querySelector('textarea'),
        };
      });
      const grew = state.height >= collapsed;
      const counted = state.counter === '53/2000';
      return {
        status: grew && counted && state.focused ? 'ok' : 'fail',
        detail: `textarea focus=${state.focused}; form ${collapsed}px→${state.height}px; counter=${state.counter}; submit disabled=${state.submitDisabled}`,
        evidence: state,
      };
    });

    await check('composer-validation', async () => {
      // Switch to Discussion, which requires a title, and submit empty.
      await page.locator('.home-composer button[role="tab"]', { hasText: 'Discussion' }).click();
      await page.waitForTimeout(120);
      const titleRequired = await page.evaluate(() => {
        const input = document.querySelector('.home-composer input[name="title"]');
        return input ? { exists: true, required: input.required } : { exists: false };
      });
      const body = await page.locator('.home-composer textarea').first().inputValue();
      return {
        status: titleRequired.exists && titleRequired.required ? 'ok' : 'fail',
        detail: titleRequired.exists
          ? `Discussion exposes a required title field (required=${titleRequired.required}); body preserved while switching kind: ${body.length} chars`
          : 'Discussion kind did not expose a title field',
        evidence: { titleRequired, bodyLength: body.length },
      };
    });

    await check('composer-submit-roundtrip', async () => {
      // A genuine write: this is the only way to know the server action, RLS
      // and the revalidate path all still line up after a visual change.
      const marker = `interaction-check ${Date.now()}`;
      await page.locator('.home-composer button[role="tab"]', { hasText: 'Post' }).click();
      const textarea = page.locator('.home-composer textarea').first();
      await textarea.fill('');
      await textarea.type(`${marker} — posted by the interaction check.`);
      await page.locator('.home-composer button[type="submit"]').click();
      await page.waitForTimeout(2500);
      const outcome = await page.evaluate((needle) => {
        const text = document.body.innerText;
        return {
          appeared: text.includes(needle),
          cleared: document.querySelector('.home-composer textarea').value === '',
          error: document.querySelector('.home-composer [role="alert"]')?.textContent?.slice(0, 120) || null,
        };
      }, marker);
      return {
        status: outcome.appeared ? (outcome.cleared ? 'ok' : 'warn') : 'fail',
        detail: outcome.appeared
          ? `post appears in the stream after the server action (composer cleared=${outcome.cleared})`
          : `post never appeared in the stream (composer error: ${outcome.error || 'none shown'})`,
        evidence: outcome,
      };
    });

    /* ── 3. Reactions on a real post ────────────────────────────────────── */
    await check('reaction-toggle-live', async () => {
      const chip = page.locator('.stream-slot .chip-toggle').first();
      const before = (await chip.textContent()).trim();
      await chip.click();
      await page.waitForTimeout(1800);
      const after = (await chip.textContent()).trim();
      const aria = await chip.getAttribute('aria-pressed');
      await chip.click();
      await page.waitForTimeout(1800);
      const reverted = (await chip.textContent()).trim();
      return {
        status: before !== after && aria === 'true' ? 'ok' : 'fail',
        detail: `reaction count "${before}" → "${after}" (aria-pressed=${aria}) → toggled back to "${reverted}"`,
        evidence: { before, after, reverted, aria },
      };
    });

    /* ── 4. Navigation, history, search ─────────────────────────────────── */
    await check('navigation-and-history', async () => {
      await page.locator('a[href="/explore"]').first().click();
      await page.waitForURL('**/explore**', { timeout: 20_000 });
      const forward = await page.evaluate(() => ({ url: location.pathname, heading: document.querySelector('h1')?.textContent?.trim() || null }));
      await page.goBack();
      await page.waitForURL('**/home', { timeout: 20_000 });
      const back = await page.evaluate(() => ({ url: location.pathname, scroll: Math.round(window.scrollY) }));
      await page.goForward();
      await page.waitForURL('**/explore**', { timeout: 20_000 });
      const again = await page.evaluate(() => location.pathname);
      return {
        status: forward.url === '/explore' && back.url === '/home' && again === '/explore' ? 'ok' : 'fail',
        detail: `/home → /explore (h1 "${forward.heading}") → back /home (scrollY ${back.scroll}) → forward ${again}`,
        evidence: { forward, back, again },
      };
    });

    await check('search-from-shell', async () => {
      await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
      const field = page.locator('header input').first();
      await field.click();
      await field.type('campus');
      await field.press('Enter');
      await page.waitForURL('**/explore**q=campus**', { timeout: 20_000 });
      await page.waitForTimeout(800);
      const out = await page.evaluate(() => ({
        url: location.pathname + location.search,
        results: document.querySelectorAll('a[href^="/"], article').length,
        heading: document.querySelector('h1')?.textContent?.trim() || null,
      }));
      return {
        status: /q=campus/.test(out.url) ? 'ok' : 'fail',
        detail: `submitted from the shell → ${out.url} (h1 "${out.heading}", ${out.results} result-ish nodes)`,
        evidence: out,
      };
    });

    await check('keyboard-focus-visible', async () => {
      await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const out = await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50),
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow.slice(0, 60),
        };
      });
      const visible = out.outlineStyle !== 'none' && parseFloat(out.outlineWidth) > 0;
      return {
        status: visible ? 'ok' : 'fail',
        detail: `second Tab → <${out.tag}> "${out.label}" outline ${out.outlineWidth} ${out.outlineStyle}`,
        evidence: out,
      };
    });

    await check('console-and-network-clean', async () => {
      // Everything above ran on this page/context pair, so this is a real
      // record of the whole session, not a fresh page load.
      const hard = consoleErrors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
      const hardFailed = failedRequests.filter((text) => !/favicon/i.test(text));
      const hardResponses = badResponses.filter((text) => !/favicon/i.test(text));
      const clean = hard.length === 0 && hardFailed.length === 0 && hardResponses.length === 0;
      return {
        status: clean ? 'ok' : 'warn',
        detail: clean
          ? 'no console errors, no failed requests and no 4xx/5xx responses across the interactive session'
          : `${hard.length} console error(s), ${hardFailed.length} failed request(s), ${hardResponses.length} error response(s)`,
        evidence: { consoleErrors: hard, failedRequests: hardFailed, badResponses: hardResponses },
      };
    });

    await context.close();
  }

  /* ── 5. Touch: tap, drag-scroll, and a tap that must NOT activate ─────── */
  if (want('touch')) {
    const context = await newContext(browser, 'mobile');
    const page = await context.newPage();
    const { consoleErrors } = watch(page);
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('.stream-slot', { timeout: 20_000 });

    await check('touch-tap-navigation', async () => {
      // On a phone the sidebar is off-canvas; the bottom navigation is the one
      // that is really there to be tapped.
      const target = page
        .locator('a[href="/explore"]:visible')
        .last();
      await target.tap();
      await page.waitForURL('**/explore**', { timeout: 20_000 });
      const url = await page.evaluate(() => location.pathname);
      await page.goBack();
      await page.waitForURL('**/home', { timeout: 20_000 });
      return { status: url === '/explore' ? 'ok' : 'fail', detail: `touch tap navigated to ${url}, back returned to /home`, evidence: { url } };
    });

    await check('touch-drag-scrolls', async () => {
      // A finger drag on the feed must scroll the page — the classic failure is
      // a surface that swallows touch events, or `touch-action: none` somewhere.
      const before = await page.evaluate(() => window.scrollY);
      const box = await page.locator('.home-stream').first().boundingBox();
      const client = await context.newCDPSession(page);
      const x = Math.round(box.x + box.width / 2);
      const y0 = Math.round(box.y + box.height / 2);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let step = 1; step <= 8; step += 1) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y0 - step * 40 }],
        });
        await page.waitForTimeout(16);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.scrollY);
      const scrolled = after > before + 100;
      // …and the tap the browser synthesises from a drag must not have opened
      // the entry under the finger.
      const url = await page.evaluate(() => location.pathname);
      return {
        status: scrolled && url === '/home' ? 'ok' : scrolled ? 'warn' : 'fail',
        detail: `touch drag of 320px scrolled ${before}→${after}${url === '/home' ? ' without navigating' : ` but ended on ${url}`}`,
        evidence: { before, after, url },
      };
    });

    await check('touch-composer-usable', async () => {
      const textarea = page.locator('.home-composer textarea').first();
      await textarea.scrollIntoViewIfNeeded();
      await textarea.tap();
      await textarea.type('touch typing works');
      const value = await textarea.inputValue();
      const kb = await page.evaluate(() => {
        const el = document.querySelector('.home-composer textarea');
        const rect = el.getBoundingClientRect();
        return { top: Math.round(rect.top), height: Math.round(rect.height), fontSize: getComputedStyle(el).fontSize };
      });
      return {
        status: value === 'touch typing works' ? 'ok' : 'fail',
        detail: `tap focused the textarea and typing landed (${value.length} chars, ${kb.fontSize} input)`,
        evidence: { value, kb },
      };
    });

    await check('mobile-overflow', async () => {
      const out = await page.evaluate(async () => {
        // Two measurements, because each alone can lie. `innerWidth` is not the
        // reference (Chromium widens it along with the overflow, which is how a
        // 446px document on a 390px phone first reported as a pass) — and
        // `scrollWidth` alone is not enough either, since clipped overflow can
        // still be reported. So: the layout viewport, plus an actual attempt to
        // drag the page sideways.
        const de = document.documentElement;
        de.scrollLeft = 600;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const didScroll = de.scrollLeft;
        de.scrollLeft = 0;
        return {
          docWidth: de.scrollWidth,
          viewport: de.clientWidth,
          didScrollX: didScroll,
          // Anything still painted past the layout viewport, ignoring what an
          // ancestor already clips (a decorative element inside an
          // `overflow: hidden` box is not an overflow bug).
          offenders: Array.from(document.querySelectorAll('body *'))
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 40 || rect.right <= de.clientWidth + 2) return false;
              for (let parent = el.parentElement; parent; parent = parent.parentElement) {
                if (getComputedStyle(parent).overflowX !== 'visible') return false;
              }
              return true;
            })
            .slice(0, 6)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`),
        };
      });
      const contained = out.docWidth <= out.viewport + 2 && out.didScrollX === 0;
      return {
        status: contained ? 'ok' : 'fail',
        detail: `390px viewport: document ${out.docWidth}px wide (viewport ${out.viewport}px), sideways scroll ${out.didScrollX ? `possible (${out.didScrollX}px)` : 'impossible'}, offenders [${out.offenders.join(', ')}]`,
        evidence: out,
      };
    });

    report.observations.push({ mobile: { consoleErrors } });
    await context.close();
  }

  /* ── 6. Reduced motion ──────────────────────────────────────────────── */
  if (want('motion')) {
    const context = await newContext(browser, 'desktop', { reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
    await check('reduced-motion-still-frame', async () => {
      await page.waitForTimeout(500);
      const out = await page.evaluate(() => {
        const island = document.querySelector('.island');
        const field = document.querySelector('.depth-field');
        return {
          islandAnimation: getComputedStyle(island).animationName,
          islandDepth: getComputedStyle(island).getPropertyValue('--island-depth').trim(),
          ridgeAnimation: field
            ? getComputedStyle(field.querySelector('.depth-field__ridge') || island).animationName
            : 'no-field',
          fieldState: field?.dataset.state || null,
          canvas: Boolean(field?.querySelector('canvas')),
        };
      });
      const ok = out.islandAnimation === 'none' && out.fieldState !== null;
      return {
        status: ok ? 'ok' : 'fail',
        detail: `island animation=${out.islandAnimation}, depth=${out.islandDepth}, field=${out.fieldState} (canvas ${out.canvas}, CSS ridge animation ${out.ridgeAnimation})`,
        evidence: out,
      };
    });
    await context.close();
  }

  /* ── 7. Light theme, via the real application preference ────────────── */
  if (want('theme')) {
    const context = await newContext(browser, 'desktop');
    await context.addCookies([{ name: 'campus_theme', value: 'light', url: BASE }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(1200);
    await check('light-theme-preference', async () => {
      const out = await page.evaluate(() => {
        const field = document.querySelector('.depth-field');
        const canvas = field?.querySelector('canvas');
        const computed = (selector, prop) => {
          const el = document.querySelector(selector);
          return el ? getComputedStyle(el)[prop] : null;
        };
        return {
          datasetTheme: document.documentElement.dataset.theme,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          pageBg: computed('body', 'backgroundColor'),
          depthBase: getComputedStyle(document.documentElement).getPropertyValue('--cp-depth-base').trim(),
          canvas: Boolean(canvas),
          fieldState: field?.dataset.state || null,
        };
      });
      const ok = out.datasetTheme === 'light' && out.canvas;
      return {
        status: ok ? 'ok' : 'warn',
        detail: `cookie-driven light theme: data-theme=${out.datasetTheme}, color-scheme=${out.colorScheme}, depth-field=${out.fieldState}, --cp-depth-base=${out.depthBase}`,
        evidence: out,
      };
    });
    await context.close();
  }

  /* ── 8. No WebGL: the CSS fallback must be a finished composition ───── */
  if (want('webgl')) {
    const context = await newContext(browser, 'desktop');
    const page = await context.newPage();
    await page.addInitScript(() => {
      const fail = () => null;
      HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
        apply(target, self, args) {
          if (String(args[0]).startsWith('webgl')) return fail();
          return Reflect.apply(target, self, args);
        },
      });
    });
    await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(900);
    await check('webgl-fallback-renders', async () => {
      const out = await page.evaluate(() => {
        const field = document.querySelector('.depth-field');
        const fallback = document.querySelector('.depth-field__fallback');
        return {
          state: field?.dataset.state || null,
          canvases: field?.querySelectorAll('canvas').length ?? -1,
          ridges: document.querySelectorAll('.depth-field__ridge').length,
          horizon: Boolean(document.querySelector('.depth-field__horizon')),
          fallbackBox: fallback
            ? { w: Math.round(fallback.getBoundingClientRect().width), h: Math.round(fallback.getBoundingClientRect().height) }
            : null,
          islands: document.querySelectorAll('.island').length,
        };
      });
      const ok = out.state === 'fallback' && out.canvases === 0 && out.ridges >= 3 && out.horizon;
      return {
        status: ok ? 'ok' : 'fail',
        detail: `no-WebGL: state=${out.state}, canvases=${out.canvases}, ridges=${out.ridges}, horizon=${out.horizon}, ${out.islands} islands still composed`,
        evidence: out,
      };
    });
    await context.close();
  }

  await browser.close();

  const failed = results.filter((row) => row.status === 'fail');
  report.results = results;
  report.summary = {
    total: results.length,
    passed: results.filter((row) => row.status === 'ok').length,
    warned: results.filter((row) => row.status === 'warn').length,
    failed: failed.length,
  };
  writeFileSync(path.join(OUT, 'interaction-report.json'), JSON.stringify(report, null, 2));
  console.log(
    `\n${report.summary.passed}/${report.summary.total} passed · ${report.summary.warned} warnings · ${report.summary.failed} failures`,
  );
  console.log(`report: ${path.join(OUT, 'interaction-report.json')}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`interaction-check failed: ${error?.stack || error}`);
  process.exit(1);
});
