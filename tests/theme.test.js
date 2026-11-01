import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Campus+ has one permanent dark default palette.
 *
 * There is no light mode, "follow the device" theme, account preference or
 * site-wide theme switch. The only exception is the explicit four-color,
 * browser-local customization in Settings; it cannot alter another device or
 * the canonical tokens. These guards pin that boundary by reading the sources.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const appSources = [...walk('app'), ...walk('components'), ...walk('lib')].filter((name) =>
  /\.(js|css)$/.test(name),
);

describe('permanent dark theme', () => {
  it('always renders the root as dark, with the dark browser chrome color', () => {
    const layout = read('app/layout.js');
    expect(layout).toContain('<html lang="en" data-theme="dark" suppressHydrationWarning>');
    expect(layout).toContain("themeColor: '#060510'");
    // Nothing about the root is chosen at runtime any more.
    expect(layout).not.toContain('readTheme');
    expect(layout).not.toContain('prefers-color-scheme');
    expect(layout).not.toContain('data-theme={');
  });

  it('ships exactly one palette, keyed to a dark color-scheme', () => {
    const globals = read('app/globals.css');
    expect(globals).toMatch(/:root,\s*\[data-theme='dark'\]\s*\{\s*color-scheme: dark/);
    expect(globals).not.toMatch(/color-scheme: light/);
    expect(globals).not.toContain("[data-theme='light']");
    expect(globals).not.toContain("[data-theme='system']");
    expect(globals).not.toContain('light-dark(');
    expect(globals).not.toMatch(/@media \(prefers-color-scheme/);
    // The canonical Hallmark Lumen night palette is the one that ships.
    const tokens = read('app/tokens.css');
    expect(tokens).toContain('--color-paper: oklch(12.5% 0.027 290)');
    expect(tokens).toContain('--color-ink: oklch(96% 0.01 300)');
    expect(globals).toContain('--cp-bg-page: var(--color-paper)');
    expect(globals).toContain('--cp-text-primary: var(--color-ink)');
  });

  it('has no light-theme overrides left in component CSS', () => {
    for (const file of walk('app/styles')) {
      if (!file.endsWith('.css')) continue;
      expect(read(file), file).not.toContain("[data-theme='light']");
      expect(read(file), file).not.toContain("[data-theme='system']");
    }
  });

  it('has deleted the theme machinery instead of hiding it', () => {
    for (const file of [
      'components/ui/theme.js',
      'components/profile/AppearancePanel.js',
      'lib/theme.js',
      'app/styles/theme-switch.css',
    ]) {
      expect(fs.existsSync(file), file).toBe(false);
    }
  });

  it('offers only device-local colors, never a global theme switch', () => {
    for (const file of appSources) {
      const source = read(file);
      expect(source, file).not.toContain('ThemeSwitch');
      expect(source, file).not.toContain('theme-switch');
      expect(source, file).not.toContain('AppearancePanel');
      expect(source, file).not.toContain('applyTheme');
    }
    const settings = read('app/(app)/settings/page.js');
    expect(settings).toContain("{ key: 'appearance', label: 'Appearance' }");
    expect(settings).toContain('<DeviceColorSettings />');
    expect(settings).toContain("TABS.some((item) => item.key === params?.tab) ? params.tab : 'profile'");

    const colors = read('lib/device-colors.js');
    expect(colors).toContain('localStorage');
    expect(colors).not.toContain('document.cookie');
    expect(colors).not.toContain('supabase');
    expect(colors).not.toContain('fetch(');
    expect(read('app/styles/device-colors.css')).toContain(":root[data-device-colors='custom']");
  });

  it('cannot be reactivated by a legacy preference cookie', () => {
    for (const file of appSources) {
      expect(read(file), file).not.toContain('campus_theme');
    }
  });

  it('never consults the operating system colour scheme in client code', () => {
    for (const file of appSources.filter((name) => name.endsWith('.js'))) {
      expect(read(file), file).not.toContain('prefers-color-scheme');
    }
  });
});
