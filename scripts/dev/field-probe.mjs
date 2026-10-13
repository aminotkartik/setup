#!/usr/bin/env node
/**
 * Depth-field probe (development tool).
 *
 * Answers one question the screenshots cannot answer on their own: is the WebGL
 * background actually painting something, and how strong is it? It loads the
 * page in the real browser, waits for the scene, reads a strip of pixels out of
 * the canvas during the frame that draws them (a WebGL canvas without
 * `preserveDrawingBuffer` is empty to any later reader), and reports the
 * brightest, mean and darkest values per row — which is exactly what tells a
 * flat dark rectangle apart from a lit surface.
 *
 *   node scripts/dev/field-probe.mjs [--url http://127.0.0.1:3300/home]
 */

import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({ options: { url: { type: 'string' } }, allowPositionals: true });
const TARGET = values.url || process.env.FIELD_URL || 'http://127.0.0.1:3300/home';
const ORIGIN = new globalThis.URL(TARGET).origin;

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await context.addCookies([
  { name: 'campus_intro', value: '1', url: ORIGIN },
  { name: 'campus_theme', value: 'dark', url: ORIGIN },
]);
const page = await context.newPage();
await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(2500);

const report = await page.evaluate(async () => {
  const canvas = document.querySelector('.depth-field__canvas');
  if (!canvas) return { ok: false, reason: 'no canvas (fallback mode?)' };
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { ok: false, reason: 'no webgl context' };

  // Read inside a frame the scene itself draws: ask for the pixels right after
  // the next animation frame callback has run.
  const rows = [];
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const width = canvas.width;
        const height = canvas.height;
        for (let step = 0; step < 10; step += 1) {
          const y = Math.floor((step / 10) * height);
          const px = new Uint8Array(4 * width);
          gl.readPixels(0, y, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let max = 0;
          let sum = 0;
          let lit = 0;
          for (let i = 0; i < width; i += 1) {
            const v = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
            if (v > max) max = v;
            sum += v;
            if (v > 40) lit += 1;
          }
          rows.push({ y, max, mean: Math.round(sum / width), litPercent: Math.round((lit / width) * 100) });
        }
        resolve();
      });
    });
  });
  return { ok: true, size: { width: canvas.width, height: canvas.height }, rows };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
