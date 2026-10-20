import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');
const source = read('components/layout/GalacticIntro.js');
const css = read('components/layout/GalacticIntro.module.css');
const layout = read('app/layout.js');

// Minimal TrueType/OpenType reader: the table directory plus the `fvar` weight
// axis. Enough to prove whether these files are variable and what their real
// weight range is, without adding a font-parsing dependency.
const sfntTables = (buffer) => {
  const tables = new Map();
  const count = buffer.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    tables.set(buffer.toString('ascii', record, record + 4), {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    });
  }
  return tables;
};
const fixed = (buffer, offset) => buffer.readInt32BE(offset) / 65536;
const weightAxis = (file) => {
  const buffer = fs.readFileSync(file);
  const tables = sfntTables(buffer);
  if (!tables.has('fvar')) return null;
  const fvar = tables.get('fvar').offset;
  const axisSize = buffer.readUInt16BE(fvar + 10);
  const axisCount = buffer.readUInt16BE(fvar + 8);
  for (let index = 0; index < axisCount; index += 1) {
    const axis = fvar + buffer.readUInt16BE(fvar + 4) + index * axisSize;
    if (buffer.toString('ascii', axis, axis + 4) !== 'wght') continue;
    return {
      min: fixed(buffer, axis + 4),
      default: fixed(buffer, axis + 8),
      max: fixed(buffer, axis + 12),
    };
  }
  return null;
};

describe('document-level galactic intro architecture', () => {
  it('mounts above every page, not inside a route-specific layout', () => {
    expect(layout).toContain('<GalacticIntro>{children}</GalacticIntro>');
    expect(read('app/(app)/home/layout.js')).not.toContain('HomeLaunchGate');
  });

  it('never uses persistent playback state, routing or authentication', () => {
    expect(source).not.toMatch(
      /sessionStorage|localStorage|document.cookie|location\.|router\.|supabase|usePathname|location\.reload/,
    );
    expect(source).toContain('let completed = false');
    expect(source).toContain('inert={visible ? true : undefined}');
  });

  it('declares the real variable-font metadata and matching CSS/JS names', () => {
    // Both self-hosted files are variable fonts. The CSS ranges below are only
    // valid if they match the `fvar` weight axis exactly.
    expect(weightAxis('public/fonts/Syne.ttf')).toEqual({
      min: 400,
      default: 400,
      max: 800,
    });
    expect(weightAxis('public/fonts/SpaceGrotesk.ttf')).toEqual({
      min: 300,
      default: 300,
      max: 700,
    });
    const syne = weightAxis('public/fonts/Syne.ttf');
    const space = weightAxis('public/fonts/SpaceGrotesk.ttf');
    expect(css).toContain("font-family: 'Campus Galactic Syne'");
    expect(css).toContain("src: url('/fonts/Syne.ttf')");
    expect(css).toContain(`font-weight: ${syne.min} ${syne.max}`);
    expect(css).toContain("font-family: 'Campus Galactic Space'");
    expect(css).toContain("src: url('/fonts/SpaceGrotesk.ttf')");
    expect(css).toContain(`font-weight: ${space.min} ${space.max}`);

    // The Font Loading API must ask for the exact family descriptors used by
    // the @font-face rules above.
    expect(source).toContain("const SYNE_FAMILY = 'Campus Galactic Syne'");
    expect(source).toContain("const SPACE_FAMILY = 'Campus Galactic Space'");
    expect(source).toContain('fonts.load(SYNE_FONT, SYNE_GLYPHS)');
    expect(source).toContain('fonts.load(SPACE_FONT, SPACE_GLYPHS)');
  });

  it('verifies loaded faces and glyphs instead of trusting a fixed delay', () => {
    expect(source).toContain('const SYNE_FONT = `800 84px "${SYNE_FAMILY}"`');
    expect(source).toContain('const SPACE_FONT = `400 13px "${SPACE_FAMILY}"`');
    expect(source).toContain('const SYNE_GLYPHS = `${CAMPUS_TEXT}${PLUS_TEXT}`');
    expect(source).toContain(
      'const SPACE_GLYPHS = `${TAGLINE_TEXT}${SKIP_LABEL}`',
    );
    expect(source).toContain("face.status === 'loaded'");
    expect(source).toContain('await fonts.ready');
    expect(source).toContain('fonts.check(SYNE_FONT, SYNE_GLYPHS)');
    expect(source).toContain('fonts.check(SPACE_FONT, SPACE_GLYPHS)');
    expect(source).toContain('const FONT_WAIT_MS = 3000');
    expect(source).toContain('later(() => settle(true), FONT_WAIT_MS)');
    // The old 400 ms race must not come back.
    expect(source).not.toContain('later(start, 400)');
    expect(source).not.toMatch(/setTimeout\([^)]*,\s*400\)/);
  });

  it('has a single guarded startup and a whole-intro fallback', () => {
    expect(source).toContain('let settled = false');
    expect(source).toContain('let started = false');
    expect(source).toContain(
      'if (disposed || settled || started || finished || completed) return',
    );
    expect(source).toContain(
      'if (disposed || started || finished || completed) return',
    );
    expect(source).toContain('lockTypography(fallback)');
    expect(source).toContain(
      "stage.current.dataset.typography = fallback ? 'fallback' : 'loaded'",
    );
    for (const className of ['campus', 'plus', 'tagline', 'skip']) {
      expect(css).toContain(
        `.stage[data-typography='fallback'] .${className}`,
      );
    }
  });

  it('measures once, after typography is final, and applies both positions', () => {
    expect(source).toContain('positionLockup()');
    expect(source).toContain('textAdvance(campus.current)');
    expect(source).toContain('textAdvance(plus.current)');
    expect(source).toContain('760 - campusLength - 24 - plusLength');
    expect(source).toContain("campus.current.setAttribute('x'");
    expect(source).toContain("plus.current.setAttribute('x'");
    expect(source).toContain('await nextPaint()');
    // No measurement may happen before the font decision.
    expect(source.indexOf('lockTypography(fallback);')).toBeLessThan(
      source.indexOf('positionLockup();'),
    );
  });

  it('preserves the SVG proportions and the CSS choreography delays', () => {
    expect(source).toContain('viewBox="0 0 760 110"');
    expect(source).toContain('const FADE_AT_MS = 5250');
    expect(source).toContain('const FINISH_AT_MS = 5650');
    expect(css).toContain(
      'draw 1.65s cubic-bezier(0.77, 0, 0.175, 1) 0.95s',
    );
    expect(css).toContain('draw 1s cubic-bezier(0.77, 0, 0.175, 1) 2.45s');
    expect(css).toContain('fill 1.1s ease 2.8s');
    expect(css).toContain('fill 1s ease 3.55s');
    expect(css).toContain('tagIn 0.8s ease 4.45s');
    expect(css).toContain('breathe 3s ease 5s');
    expect(css).toContain('flare 2.6s ease 0.2s');
  });

  it('aligns the independent JS and CSS safety deadlines', () => {
    expect(source).toContain('const SAFETY_DEADLINE_MS = FONT_WAIT_MS + 6200');
    expect(source).toContain(
      'const SAFETY_CSS_DELAY_MS = SAFETY_DEADLINE_MS + 300',
    );
    expect(source).toContain('later(end, SAFETY_DEADLINE_MS)');
    expect(source).toContain("'--intro-safety-delay'");
    expect(css).toContain('var(--intro-safety-delay, 9.5s)');
  });

  it('preloads only the two critical variable faces', () => {
    expect(layout).toContain("preload('/fonts/Syne.ttf'");
    expect(layout).toContain("preload('/fonts/SpaceGrotesk.ttf'");
    expect(layout).toContain("crossOrigin: 'anonymous'");
    expect(layout).toContain("type: 'font/ttf'");
  });

  it('cleans up timers, frames, motion and keyboard listeners', () => {
    for (const text of [
      'timers.forEach(clearTimeout)',
      'cancelAnimationFrame',
      "removeEventListener('change'",
      "removeEventListener('keydown'",
    ]) {
      expect(source).toContain(text);
    }
  });

  it('has independent deadlines, immediate skip, and reduced motion', () => {
    expect(source).toContain('onClick={finish}');
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('later(end, 100)');
    expect(source).toContain('event.key === \'Escape\'');
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/(?:html|body)\s*\{/);
  });
});
