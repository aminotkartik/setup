/** Run against a configured or unconfigured Next server:
 * INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs
 * Optional CHROMIUM_EXECUTABLE_PATH for a sandbox browser installation.
 *
 * The suite covers Chromium. Microsoft Edge is not installed in this sandbox;
 * see docs/GALACTIC-INTRO.md for the manual Edge checklist that runs the same
 * checks against an actual Edge installation. (Edge shares Chromium's engine,
 * but that is not a substitute for testing the real browser.)
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.INTRO_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
const fontResponses = [];
const fontFailures = [];

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const location = message.location();
  consoleErrors.push({
    text: message.text(),
    url: location?.url || '',
  });
});
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (!pathname.startsWith('/fonts/')) return;
  fontResponses.push({
    pathname,
    status: response.status(),
    type: response.headers()['content-type'],
  });
});
page.on('requestfailed', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname.startsWith('/fonts/')) {
    fontFailures.push({ pathname, error: request.failure()?.errorText });
  }
});

// Record phase changes and the DOM state at the exact `playing` transition.
// GalaxyIntro sets both x attributes before committing `playing`, so this
// snapshot is the real first animated frame rather than a later sample.
await page.addInitScript(() => {
  window.__introTrace = {
    phaseEvents: [],
    playing: null,
    removedAt: null,
  };
  let stage = null;
  const record = () => {
    if (!stage) return;
    const phase = stage.dataset.phase;
    const events = window.__introTrace.phaseEvents;
    const previous = events[events.length - 1];
    if (previous?.phase === phase) return;
    const entry = {
      phase,
      t: performance.now(),
      typography: stage.dataset.typography ?? null,
    };
    if (phase === 'playing') {
      const texts = [...stage.querySelectorAll('svg text')];
      entry.x = texts.map((text) => Number(text.getAttribute('x')));
      entry.font = getComputedStyle(texts[0]).fontFamily;
      window.__introTrace.playing = entry;
    }
    events.push(entry);
  };
  const attach = () => {
    stage = document.querySelector('section[data-phase]');
    if (!stage) {
      requestAnimationFrame(attach);
      return;
    }
    record();
    new MutationObserver(record).observe(stage, {
      attributes: true,
      attributeFilter: ['data-phase'],
    });
    new MutationObserver(() => {
      if (!stage.isConnected) {
        window.__introTrace.removedAt = performance.now();
      }
    }).observe(document.body, { childList: true });
  };
  requestAnimationFrame(attach);
});

const splash = page.getByRole('region', { name: 'Campus+ intro' });
const skipButton = page.getByRole('button', { name: 'Skip intro' });

const goto = (path) =>
  page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });

async function waitForPlaying(timeout = 7000) {
  await page.locator('section[data-phase="playing"]').waitFor({ timeout });
}

async function waitForDetached(timeout = 9000) {
  await splash.waitFor({ state: 'detached', timeout });
}

async function readIntro() {
  return page.evaluate(() => {
    const stage = document.querySelector('section[data-phase]');
    if (!stage) return null;
    const texts = [...stage.querySelectorAll('svg text')];
    const [campus, plus] = texts;
    const campusBox = campus.getBBox();
    const plusBox = plus.getBBox();
    const tagline = stage.querySelector('[class*="tagline"]');
    const skip = stage.querySelector('button');
    const taglineRect = tagline.getBoundingClientRect();
    const skipRect = skip.getBoundingClientRect();
    const style = (element) => getComputedStyle(element);
    return {
      phase: stage.dataset.phase,
      typography: stage.dataset.typography ?? null,
      campusFont: style(campus).fontFamily,
      plusFont: style(plus).fontFamily,
      taglineFont: style(tagline).fontFamily,
      skipFont: style(skip).fontFamily,
      campusWeight: style(campus).fontWeight,
      taglineWeight: style(tagline).fontWeight,
      skipWeight: style(skip).fontWeight,
      x: texts.map((text) => Number(text.getAttribute('x'))),
      lengths: texts.map((text) => text.getComputedTextLength()),
      gap: plusBox.x - (campusBox.x + campusBox.width),
      left: campusBox.x,
      right: plusBox.x + plusBox.width,
      taglineRect: {
        left: taglineRect.left,
        right: taglineRect.right,
        width: taglineRect.width,
        height: taglineRect.height,
      },
      skipRect: {
        top: skipRect.top,
        bottom: skipRect.bottom,
        left: skipRect.left,
        right: skipRect.right,
        width: skipRect.width,
        height: skipRect.height,
      },
      overflow: document.documentElement.scrollWidth > innerWidth,
      viewport: { width: innerWidth, height: innerHeight },
      checkSyne: document.fonts.check(
        '800 84px "Campus Galactic Syne"',
        'CAMPUS+',
      ),
      checkSpace: document.fonts.check(
        '400 13px "Campus Galactic Space"',
        'THE PCCOE FORUMSkip intro',
      ),
    };
  });
}

function assertBounds(state, label) {
  assert.equal(state.overflow, false, `${label}: horizontal overflow`);
  assert.ok(state.left >= 0, `${label}: left edge ${state.left}`);
  assert.ok(state.right <= 760, `${label}: right edge ${state.right}`);
  assert.ok(
    Math.abs(state.gap - 24) < 0.75,
    `${label}: expected a 24-unit gap, got ${state.gap}`,
  );
  assert.ok(
    Math.abs(state.x[0] - (760 - state.x[1] - state.lengths[1])) < 0.75,
    `${label}: lockup is not centred (${state.x})`,
  );
}

function assertCustomTypography(state, label) {
  assert.equal(state.typography, 'loaded', `${label}: typography state`);
  assert.match(state.campusFont, /Campus Galactic Syne/, label);
  assert.match(state.plusFont, /Campus Galactic Syne/, label);
  assert.match(state.taglineFont, /Campus Galactic Space/, label);
  assert.match(state.skipFont, /Campus Galactic Space/, label);
  assert.equal(state.campusWeight, '800', `${label}: logo weight`);
  assert.equal(state.taglineWeight, '400', `${label}: tagline weight`);
  assert.equal(state.skipWeight, '400', `${label}: skip weight`);
  assert.equal(state.checkSyne, true, `${label}: Syne check`);
  assert.equal(state.checkSpace, true, `${label}: Space check`);
  assertBounds(state, label);
}

function assertFallbackTypography(state, label) {
  assert.equal(state.typography, 'fallback', `${label}: typography state`);
  const families = [
    state.campusFont,
    state.plusFont,
    state.taglineFont,
    state.skipFont,
  ];
  for (const family of families) {
    assert.doesNotMatch(family, /Campus Galactic/, `${label}: ${family}`);
    assert.match(family, /Arial/, `${label}: ${family}`);
  }
  assert.equal(
    new Set(families).size,
    1,
    `${label}: fallback must be identical for the whole intro`,
  );
  assertBounds(state, label);
}

function assertNoUnexpectedErrors() {
  assert.deepEqual(pageErrors, [], 'page errors');
  const unexpected = consoleErrors.filter(
    (error) =>
      !error.url.includes('/fonts/') &&
      !/Failed to load resource/i.test(error.text),
  );
  assert.deepEqual(unexpected, [], 'console errors/hydration warnings');
}

function assertFontResponsesOk(label) {
  assert.ok(fontResponses.length >= 2, `${label}: font responses seen`);
  for (const response of fontResponses) {
    assert.equal(response.status, 200, `${label}: ${response.pathname} status`);
    assert.equal(response.type, 'font/ttf', `${label}: ${response.pathname} type`);
  }
  const counts = new Map();
  for (const response of fontResponses) {
    counts.set(response.pathname, (counts.get(response.pathname) || 0) + 1);
  }
  assert.equal(counts.get('/fonts/Syne.ttf'), 1, `${label}: Syne once`);
  assert.equal(
    counts.get('/fonts/SpaceGrotesk.ttf'),
    1,
    `${label}: Space Grotesk once`,
  );
}

try {
  // ---------------------------------------------------------------------------
  // 1. Successful load: fonts are verified before the first animated frame.
  // ---------------------------------------------------------------------------
  fontResponses.length = 0;
  fontFailures.length = 0;
  await goto('/setup?destination=%2Fmarket&probe=1');
  await splash.waitFor();
  const initialUrl = page.url();

  const preloads = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(
      (link) => ({
        pathname: new URL(link.href).pathname,
        crossOrigin: link.crossOrigin,
        type: link.getAttribute('type'),
      }),
    ),
  );
  for (const pathname of ['/fonts/Syne.ttf', '/fonts/SpaceGrotesk.ttf']) {
    assert.ok(
      preloads.some(
        (link) =>
          link.pathname === pathname &&
          link.crossOrigin === 'anonymous' &&
          link.type === 'font/ttf',
      ),
      `missing preload for ${pathname}`,
    );
  }

  await waitForPlaying();
  const firstFrame = await readIntro();
  assertCustomTypography(firstFrame, 'successful load');
  assert.equal(firstFrame.phase, 'playing');
  assert.equal(firstFrame.taglineRect.width > 0, true);
  assert.equal(firstFrame.skipRect.width > 0, true);
  console.log('PASS fonts verified before playback, preloads and custom faces');

  // CSS and JS choreography share the same phase-relative timeline.
  const animations = await page.evaluate(() => {
    const stage = document.querySelector('section[data-phase]');
    const texts = [...stage.querySelectorAll('svg text')];
    const describe = (element) => {
      const style = getComputedStyle(element);
      return {
        name: style.animationName,
        delay: style.animationDelay,
        duration: style.animationDuration,
      };
    };
    return {
      stageTransition: getComputedStyle(stage).transitionDuration,
      flare: describe(stage.querySelector('[class*="flare"]')),
      campus: describe(texts[0]),
      plus: describe(texts[1]),
      logo: describe(stage.querySelector('svg')),
      tagline: describe(stage.querySelector('[class*="tagline"]')),
    };
  });
  const parts = (value) => value.split(',').map((part) => part.trim());
  assert.deepEqual(parts(animations.stageTransition), ['0.4s']);
  assert.deepEqual(parts(animations.flare.delay), ['0.2s']);
  assert.deepEqual(parts(animations.flare.duration), ['2.6s']);
  assert.deepEqual(parts(animations.campus.delay), ['0.95s', '2.8s']);
  assert.deepEqual(parts(animations.campus.duration), ['1.65s', '1.1s']);
  assert.deepEqual(parts(animations.plus.delay), ['2.45s', '3.55s']);
  assert.deepEqual(parts(animations.plus.duration), ['1s', '1s']);
  assert.deepEqual(parts(animations.logo.delay), ['5s']);
  assert.deepEqual(parts(animations.logo.duration), ['3s']);
  assert.deepEqual(parts(animations.tagline.delay), ['4.45s']);
  assert.deepEqual(parts(animations.tagline.duration), ['0.8s']);
  console.log('PASS CSS flare/draw/fill/tagline/breathe delays match JS timing');

  // No metric or typography change while the sequence is running.
  await page.waitForTimeout(1200);
  const steadyFrame = await readIntro();
  assert.deepEqual(steadyFrame.x, firstFrame.x, 'logo shifted after start');
  assert.equal(steadyFrame.campusFont, firstFrame.campusFont);
  assert.equal(steadyFrame.taglineFont, firstFrame.taglineFont);
  assertCustomTypography(steadyFrame, 'mid-animation');

  await page.locator('section[data-phase="fading"]').waitFor({ timeout: 6000 });
  await waitForDetached(4000);
  assert.equal(page.url(), initialUrl, 'intro changed the URL');
  assert.equal(await page.locator('[inert]').count(), 0, 'inert left behind');

  const trace = await page.evaluate(() => window.__introTrace);
  assert.ok(trace.playing, 'playing transition was not recorded');
  const fading = trace.phaseEvents.find((event) => event.phase === 'fading');
  assert.ok(fading, 'fading transition was not recorded');
  const fadeDelay = fading.t - trace.playing.t;
  assert.ok(
    fadeDelay >= 4900 && fadeDelay <= 5700,
    `fade started after ${Math.round(fadeDelay)}ms`,
  );
  assert.ok(trace.removedAt, 'stage removal was not recorded');
  const finishDelay = trace.removedAt - trace.playing.t;
  assert.ok(
    finishDelay >= 5200 && finishDelay <= 6200,
    `intro finished after ${Math.round(finishDelay)}ms`,
  );
  assert.deepEqual(trace.playing.x, firstFrame.x);
  assert.equal(trace.playing.typography, 'loaded');
  assertFontResponsesOk('successful load');
  assert.deepEqual(fontFailures, []);
  console.log(
    `PASS fade at ${Math.round(fadeDelay)}ms and completion at ${Math.round(
      finishDelay,
    )}ms after playback`,
  );

  // ---------------------------------------------------------------------------
  // 2. Immediate Skip, no resurrected timers, query preservation.
  // ---------------------------------------------------------------------------
  await goto('/setup?destination=%2Fmarket&probe=1');
  await splash.waitFor();
  const skipUrl = page.url();
  await skipButton.click();
  await splash.waitFor({ state: 'detached' });
  assert.equal(page.url(), skipUrl);
  await page.waitForTimeout(5900);
  assert.equal(
    await splash.count(),
    0,
    'skip must not resurrect on pending font/playback timers',
  );
  console.log('PASS immediate skip, query preservation, no stale timer replay');

  // Skipping after playback has begun must also cancel the pending fade.
  await goto('/setup');
  await splash.waitFor();
  await waitForPlaying();
  const midPlaybackUrl = page.url();
  await page.waitForTimeout(1000);
  await skipButton.click();
  await splash.waitFor({ state: 'detached' });
  await page.waitForTimeout(4700);
  assert.equal(page.url(), midPlaybackUrl);
  assert.equal(
    await splash.count(),
    0,
    'mid-playback skip must not resurrect on the fade timer',
  );
  console.log('PASS mid-playback skip cancels the pending fade');

  // A full reload resets document memory and replays from the beginning.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await splash.waitFor();
  await waitForDetached(7500);
  assert.equal(page.url(), midPlaybackUrl);
  console.log('PASS refresh replay and automatic completion');

  // ---------------------------------------------------------------------------
  // 3. Escape and focus handling.
  // ---------------------------------------------------------------------------
  await goto('/login?next=%2Fmarket');
  await splash.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(
    (await page.evaluate(() => document.activeElement?.textContent?.trim())) ||
      '',
    'Skip intro',
  );
  await page.keyboard.press('Escape');
  await splash.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('tabindex')),
    '-1',
    'focus should move to the revealed content boundary',
  );
  console.log('PASS direct login, Tab to Skip, Escape and focus reveal');

  await page.evaluate(() => {
    window.__introDocument = 'same';
  });
  await page.locator('a[href="/"]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__introDocument), 'same');
  assert.equal(await splash.count(), 0);
  console.log('PASS Next internal navigation does not replay');

  // ---------------------------------------------------------------------------
  // 4. Reduced motion.
  // ---------------------------------------------------------------------------
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goto('/setup');
  await splash.waitFor();
  await splash.waitFor({ state: 'detached', timeout: 2000 });
  console.log('PASS reduced motion immediate reveal');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---------------------------------------------------------------------------
  // 5. Slow but successful font: playback waits, then measures the real face.
  // ---------------------------------------------------------------------------
  fontResponses.length = 0;
  fontFailures.length = 0;
  await page.route('**/fonts/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await goto('/setup');
  await splash.waitFor();
  await waitForPlaying(5000);
  const delayedTrace = await page.evaluate(() => window.__introTrace);
  const delayedState = await readIntro();
  assertCustomTypography(delayedState, 'slow successful font');
  assert.deepEqual(
    delayedState.x,
    firstFrame.x,
    'slow font load changed the measured position',
  );
  const delayedWait =
    delayedTrace.playing.t - delayedTrace.phaseEvents[0].t;
  assert.ok(
    delayedWait >= 700,
    `playback must wait for fonts, started after ${Math.round(delayedWait)}ms`,
  );
  await page.waitForTimeout(900);
  const delayedSteady = await readIntro();
  assert.deepEqual(delayedSteady.x, delayedState.x);
  assert.equal(delayedSteady.typography, 'loaded');
  await waitForDetached(8000);
  assertFontResponsesOk('slow successful font');
  assert.deepEqual(fontFailures, []);
  await page.unroute('**/fonts/**');
  console.log(
    `PASS 900ms font delay waited ${Math.round(
      delayedWait,
    )}ms and kept custom metrics`,
  );

  // ---------------------------------------------------------------------------
  // 6. Font timeout: a late face must not change a fallback playback.
  // ---------------------------------------------------------------------------
  fontResponses.length = 0;
  fontFailures.length = 0;
  await page.route('**/fonts/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.continue();
  });
  await goto('/setup');
  await splash.waitFor();
  await waitForPlaying(7000);
  const timeoutTrace = await page.evaluate(() => window.__introTrace);
  const timeoutState = await readIntro();
  assertFallbackTypography(timeoutState, 'font timeout');
  const timeoutWait =
    timeoutTrace.playing.t - timeoutTrace.phaseEvents[0].t;
  assert.ok(
    timeoutWait >= 2500,
    `timeout fallback started too early (${Math.round(timeoutWait)}ms)`,
  );
  assert.ok(
    timeoutWait <= 5000,
    `timeout fallback started too late (${Math.round(timeoutWait)}ms)`,
  );
  // The delayed request lands while the fallback sequence is already running.
  await page.waitForFunction(
    () =>
      document.fonts.check(
        '800 84px "Campus Galactic Syne"',
        'CAMPUS+',
      ),
    null,
    { timeout: 4000 },
  );
  const afterLateLoad = await readIntro();
  assertFallbackTypography(afterLateLoad, 'late font after timeout');
  assert.deepEqual(
    afterLateLoad.x,
    timeoutState.x,
    'late font moved the fallback wordmark',
  );
  assert.equal(
    afterLateLoad.campusFont,
    timeoutState.campusFont,
    'late font swapped fallback typography',
  );
  await waitForDetached(9000);
  assertFontResponsesOk('font timeout');
  assert.deepEqual(fontFailures, []);
  await page.unroute('**/fonts/**');
  console.log(
    `PASS timeout fallback after ${Math.round(
      timeoutWait,
    )}ms, late face ignored for the rest of the intro`,
  );

  // ---------------------------------------------------------------------------
  // 7. Font request failure: deliberate whole-intro fallback and cleanup.
  // ---------------------------------------------------------------------------
  fontResponses.length = 0;
  fontFailures.length = 0;
  await page.route('**/fonts/**', (route) => route.abort());
  await goto('/setup');
  await splash.waitFor();
  await waitForPlaying(3000);
  const failureState = await readIntro();
  assertFallbackTypography(failureState, 'font failure');
  await page.waitForTimeout(600);
  const failureSteady = await readIntro();
  assert.deepEqual(failureSteady.x, failureState.x);
  await waitForDetached(7500);
  assert.equal(await page.locator('[inert]').count(), 0);
  assert.notEqual(
    await page.evaluate(() => getComputedStyle(document.body).overflow),
    'hidden',
  );
  await page.unroute('**/fonts/**');
  console.log(
    'PASS font failure falls back consistently, completes, no inert/scroll lock',
  );

  // ---------------------------------------------------------------------------
  // 8. Desktop, mobile and landscape layout bounds.
  // ---------------------------------------------------------------------------
  const viewports = [
    { width: 320, height: 844 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await goto('/setup');
    await splash.waitFor();
    await waitForPlaying();
    const state = await readIntro();
    assertCustomTypography(
      state,
      `${viewport.width}x${viewport.height}`,
    );
    assert.ok(
      state.taglineRect.left >= -0.5 &&
        state.taglineRect.right <= state.viewport.width + 0.5 &&
        state.taglineRect.width > 0 &&
        state.taglineRect.height > 0,
      `${viewport.width}x${viewport.height}: tagline outside viewport`,
    );
    assert.ok(
      state.skipRect.top >= 0 &&
        state.skipRect.bottom <= state.viewport.height + 0.5 &&
        state.skipRect.width > 0 &&
        state.skipRect.height >= 48,
      `${viewport.width}x${viewport.height}: Skip intro outside viewport`,
    );
    await skipButton.click();
    await splash.waitFor({ state: 'detached' });
  }
  console.log('PASS desktop/mobile/landscape bounds and 24-unit gap');

  assertNoUnexpectedErrors();
  console.log('PASS no page errors, console errors or hydration warnings');
} finally {
  await browser.close();
}
