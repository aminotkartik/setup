import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');
const source = read('components/layout/GalacticIntro.js');
const css = read('components/layout/GalacticIntro.module.css');

describe('document-level galactic intro architecture', () => {
  it('mounts above every page, not inside a route-specific layout', () => {
    expect(read('app/layout.js')).toContain(
      '<GalacticIntro>{children}</GalacticIntro>',
    );
    expect(read('app/(app)/home/layout.js')).not.toContain('HomeLaunchGate');
  });
  it('never uses persistent playback state, routing or authentication', () => {
    expect(source).not.toMatch(
      /sessionStorage|localStorage|document.cookie|location\.|router\.|supabase|usePathname/,
    );
    expect(source).toContain('let completed = false');
    expect(source).toContain('inert={visible ? true : undefined}');
  });
  it('measures fonts before animating and retains source proportions', () => {
    expect(source).toContain('fonts.load');
    expect(source).toContain('getComputedTextLength');
    expect(source).toContain('760 - c - 24 - p');
    expect(source).toContain('viewBox="0 0 760 110"');
    expect(css).toContain('2.45s');
    expect(css).toContain('4.45s');
  });
  it('cleans up timers, frames, motion and keyboard listeners', () => {
    for (const text of [
      'timers.forEach(clearTimeout)',
      'cancelAnimationFrame',
      "removeEventListener('change'",
      "removeEventListener('keydown'",
    ])
      expect(source).toContain(text);
  });
  it('has independent deadlines, immediate skip, and reduced motion', () => {
    expect(source).toContain('later(end, 6200)');
    expect(source).toContain('later(start, 400)');
    expect(source).toContain('onClick={finish}');
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('later(end, 100)');
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/(?:html|body)\s*\{/);
  });
});
