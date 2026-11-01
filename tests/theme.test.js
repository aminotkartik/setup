import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_PALETTES,
  THEME_PREHYDRATION_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  readTheme,
  writeTheme,
} from '@/lib/theme';

const read = (file) => fs.readFileSync(file, 'utf8');
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const appSources = [...walk('app'), ...walk('components'), ...walk('lib')].filter((name) =>
  /\.(js|css)$/.test(name),
);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function fakeRoot() {
  const attributes = new Map();
  return {
    attributes,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
}

describe('two-theme appearance architecture', () => {
  it('defines the exact requested light and dark foundations', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(THEME_PALETTES).toEqual({
      light: { background: '#E1D9D1', section: '#F1EBE5', accent: '#8DBCE3', text: '#292725' },
      dark: { background: '#191D21', section: '#252B30', accent: '#91BFE5', text: '#F0EEE9' },
    });
    const tokens = read('app/tokens.css');
    for (const value of ['#E1D9D1', '#F1EBE5', '#8DBCE3', '#292725', '#191D21', '#252B30', '#91BFE5', '#F0EEE9']) {
      expect(tokens).toContain(value);
    }
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain('color-scheme: light');
    expect(tokens).toContain('color-scheme: dark');
    expect(read('app/globals.css')).toContain('--cp-bg-page: var(--color-paper)');
    expect(read('app/globals.css')).toContain('--cp-text-primary: var(--color-ink)');
  });

  it('renders light first and restores an explicit choice before device colors', () => {
    const layout = read('app/layout.js');
    expect(layout).toContain('<html lang="en" data-theme="light" suppressHydrationWarning>');
    expect(layout).toContain("themeColor: '#E1D9D1'");
    expect(layout.indexOf('campusplus-theme')).toBeLessThan(layout.indexOf('campusplus-device-colors'));
    expect(layout).toContain('THEME_PREHYDRATION_SCRIPT');
    expect(layout).not.toContain('prefers-color-scheme');
  });

  it('validates and persists only light or dark in browser storage', () => {
    const storage = memoryStorage();
    expect(readTheme(storage)).toBe('light');
    expect(normalizeTheme('system')).toBeNull();
    expect(normalizeTheme('dark')).toBe('dark');
    expect(writeTheme(storage, 'dark')).toBe(true);
    expect(readTheme(storage)).toBe('dark');
    expect(writeTheme(storage, 'blue')).toBe(false);
    expect(readTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'blue' }))).toBe('light');
    expect(readTheme({ getItem() { throw new Error('blocked'); } })).toBe('light');
  });

  it('restores the saved theme in the pre-paint script without an OS lookup', () => {
    const root = fakeRoot();
    globalThis.window = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }) };
    globalThis.document = { documentElement: root, querySelector: () => null };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(root.getAttribute('data-theme')).toBe('dark');

    const invalidRoot = fakeRoot();
    globalThis.window = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: 'system' }) };
    globalThis.document = { documentElement: invalidRoot, querySelector: () => null };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(invalidRoot.getAttribute('data-theme')).toBe('light');
  });

  it('updates the root and browser chrome without a reload', () => {
    const root = fakeRoot();
    const meta = { setAttribute(name, value) { this[name] = value; } };
    globalThis.document = { querySelector: () => meta };
    expect(applyTheme(root, 'dark')).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(meta.content).toBe('#191D21');
    expect(applyTheme(root, 'invalid')).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(meta.content).toBe('#E1D9D1');
  });

  it('places the accessible switch immediately before the account menu on both layouts', () => {
    const header = read('components/layout/ShellHeader.js');
    expect(header.match(/<ThemeToggle \/>/g)).toHaveLength(2);
    expect(header).toMatch(/<ThemeToggle \/>\s*<AccountMenu/);
    const toggle = read('components/layout/ThemeToggle.js');
    expect(toggle).toContain('aria-label={`Switch to ${nextTheme} mode`}');
    expect(toggle).toContain('writeTheme');
    expect(toggle).toContain('applyTheme');
    expect(toggle).not.toContain('fetch(');
    expect(toggle).not.toContain('supabase');
  });

  it('moves the existing customizer to the account dialog and removes Settings Appearance', () => {
    const settings = read('app/(app)/settings/page.js');
    expect(settings).not.toContain("key: 'appearance'");
    expect(settings).not.toContain('DeviceColorSettings');
    const account = read('components/layout/AccountMenu.js');
    expect(account).toContain('Customize colors');
    expect(account).toContain('<Modal');
    expect(account).toContain('<DeviceColorSettings />');
    expect(read('components/settings/DeviceColorSettings.js')).toContain('type="color"');
    expect(read('components/settings/DeviceColorSettings.js')).toContain('type="text"');
  });

  it('keeps custom colors light-only and preserves the local-only boundary', () => {
    expect(read('app/styles/device-colors.css')).toContain(":root[data-theme='light'][data-device-colors='custom']");
    const colors = read('lib/device-colors.js');
    expect(colors).toContain("root.getAttribute?.('data-theme') === 'dark'");
    expect(colors).toContain('localStorage');
    expect(colors).not.toContain('document.cookie');
    expect(colors).not.toContain('supabase');
    expect(colors).not.toContain('fetch(');
    const toggle = read('components/layout/ThemeToggle.js');
    expect(toggle).toContain('clearDeviceColorOverrides');
    expect(toggle).toContain('readDeviceColors');
  });

  it('has no system theme variant or legacy cookie reactivation', () => {
    for (const file of appSources) {
      const source = read(file);
      expect(source, file).not.toContain("[data-theme='system']");
      expect(source, file).not.toContain('campus_theme');
      if (file.endsWith('.js')) expect(source, file).not.toContain('prefers-color-scheme');
    }
  });
});
