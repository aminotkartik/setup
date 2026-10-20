/** Run against a configured or unconfigured Next server:
 * INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs
 * Optional CHROMIUM_EXECUTABLE_PATH for a sandbox browser installation.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.INTRO_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox'],
});
const errors = [];
const page = await browser.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const splash = page.getByRole('region', { name: 'Campus+ intro' });
try {
  await page.goto(`${base}/setup?destination=%2Fmarket&probe=1`);
  await splash.waitFor();
  const url = page.url();
  await page.getByRole('button', { name: 'Skip intro' }).click();
  await splash.waitFor({ state: 'detached' });
  assert.equal(page.url(), url);
  await page.waitForTimeout(5900);
  assert.equal(
    await splash.count(),
    0,
    'skip must not resurrect on pending timers',
  );
  console.log(
    'PASS fresh load, immediate skip, query preservation, no stale timer replay',
  );

  await page.reload();
  await splash.waitFor();
  await splash.waitFor({ state: 'detached', timeout: 7500 });
  assert.equal(page.url(), url);
  console.log('PASS refresh replay and automatic completion');

  await page.goto(`${base}/login?next=%2Fmarket`);
  await splash.waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await splash.waitFor({ state: 'detached' });
  console.log('PASS direct login and Escape skip');
  await page.evaluate(() => {
    window.__introDocument = 'same';
  });
  await page.locator('a[href="/"]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__introDocument), 'same');
  assert.equal(await splash.count(), 0);
  console.log('PASS Next internal navigation does not replay');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await splash.waitFor({ state: 'detached', timeout: 2000 });
  console.log('PASS reduced motion immediate reveal');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const width of [320, 390, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    await page.goto(`${base}/setup`);
    await page.waitForFunction(() =>
      document.querySelector('[data-phase="playing"]'),
    );
    const metrics = await page
      .locator('svg[viewBox="0 0 760 110"]')
      .evaluate((svg) => {
        const [c, p] = svg.querySelectorAll('text');
        const cb = c.getBBox(),
          pb = p.getBBox();
        return {
          left: cb.x,
          right: pb.x + pb.width,
          gap: pb.x - cb.x - cb.width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
    assert.equal(metrics.overflow, false);
    assert.ok(
      metrics.left >= 0 && metrics.right <= 760,
      JSON.stringify(metrics),
    );
    assert.ok(Math.abs(metrics.gap - 24) < 1, JSON.stringify(metrics));
    await page.getByRole('button', { name: 'Skip intro' }).click();
  }
  console.log('PASS mobile/landscape/desktop logo bounds and 24-unit gap');

  await page.route('**/fonts/**', (route) => route.abort());
  await page.reload();
  await splash.waitFor({ state: 'detached', timeout: 7500 });
  assert.equal(await page.locator('[inert]').count(), 0);
  assert.notEqual(
    await page.evaluate(() => getComputedStyle(document.body).overflow),
    'hidden',
  );
  console.log(
    'PASS font failure completion, no inert or scroll lock left behind',
  );
  assert.deepEqual(errors, []);
  console.log('PASS no page/hydration errors');
} finally {
  await browser.close();
}
