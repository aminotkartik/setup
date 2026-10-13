/**
 * Browser bootstrap for local visual checks (development tool).
 *
 * Why this exists in the repository: the sandbox has no system Chrome, and
 * Playwright's own browser download is not reachable from here. The Chromium
 * binary that *is* available comes from the `@sparticuz/chromium` npm package,
 * which ships the browser plus the Amazon Linux 2023 shared libraries it was
 * built against. Only three of those are missing on a Debian base image — the
 * NSS stack — and the package carries them inside `bin/al2023.tar.br`.
 *
 * So this module does two things and nothing else:
 *
 *   1. inflates `bin/al2023.tar.br` (and the SwiftShader bundle, which is what
 *      gives WebGL a software GL path) into a cache directory;
 *   2. returns a ready-to-use `{ executablePath, env, args }` for Playwright.
 *
 * It is deliberately not a test framework. `scripts/dev/visual-check.mjs` uses
 * it to drive the real application in a real browser.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CACHE = path.join(process.cwd(), 'node_modules', '.cache', 'browser');

/** Inflate a brotli-compressed tar into `target` (once). */
function inflateTar(archive, target) {
  mkdirSync(target, { recursive: true });
  const tarPath = path.join(CACHE, `${path.basename(archive, '.br')}`);
  if (!existsSync(tarPath)) {
    writeFileSync(tarPath, zlib.brotliDecompressSync(readFileSync(archive)));
  }
  execFileSync('tar', ['xf', tarPath, '-C', target], { stdio: 'ignore' });
}

/**
 * @returns {Promise<{executablePath: string, env: Record<string,string>, args: string[], libPath: string}>}
 */
export async function resolveBrowser() {
  const chromium = require('@sparticuz/chromium').default;
  // The package does not export its package.json, so the entry point is used to
  // locate `bin/` instead.
  const packageRoot = path.dirname(path.dirname(require.resolve('@sparticuz/chromium')));
  const bin = path.join(packageRoot, 'bin');

  mkdirSync(CACHE, { recursive: true });
  const libPath = path.join(CACHE, 'libs');
  const glPath = path.join(CACHE, 'swiftshader');
  if (!existsSync(path.join(libPath, 'lib', 'libnss3.so'))) {
    inflateTar(path.join(bin, 'al2023.tar.br'), libPath);
  }
  if (!existsSync(path.join(glPath, 'libEGL.so'))) {
    inflateTar(path.join(bin, 'swiftshader.tar.br'), glPath);
  }

  const executablePath = await chromium.executablePath();

  return {
    executablePath,
    libPath,
    // SwiftShader first, then the NSS stack: the loader resolves by directory
    // order, so the browser keeps its own copy of libEGL/libGLESv2 (the system
    // has none) without shadowing anything else.
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [glPath, path.join(libPath, 'lib')].join(':'),
    },
    // Two of the package's own flags are dropped on purpose: `--single-process`
    // and `--in-process-gpu` are what a serverless cold start wants, but they
    // make a browser that collapses when a second tab opens or a WebGL context
    // dies — neither is acceptable for something that has to look at pages.
    args: [
      ...chromium.args.filter((arg) => !['--single-process', '--in-process-gpu'].includes(arg)),
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      // A software GL path is what makes the shader-driven background render in
      // a headless sandbox at all.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--font-render-hinting=none',
    ],
  };
}

/** Playwright's chromium, launched the way this sandbox needs it. */
export async function launchBrowser(options = {}) {
  const { chromium } = await import('playwright-core');
  const resolved = await resolveBrowser();
  return chromium.launch({ ...resolved, headless: true, ...options });
}
