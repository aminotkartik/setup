import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_COLORS,
  DEVICE_COLOR_FIELDS,
  DEVICE_COLOR_PREHYDRATION_SCRIPT,
  DEVICE_COLOR_STORAGE_KEY,
  applyDeviceColors,
  clearDeviceColorOverrides,
  contrastRatio,
  deviceAccentInk,
  normalizeDeviceColors,
  normalizeHex,
  readDeviceColors,
  removeDeviceColors,
  writeDeviceColors,
} from '@/lib/device-colors';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeRoot() {
  const properties = new Map();
  const attributes = new Map();
  return {
    properties,
    attributes,
    style: {
      setProperty(name, value) { properties.set(name, value); },
      removeProperty(name) { properties.delete(name); },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
  };
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

describe('device-local color values', () => {
  it('uses the canonical light sRGB foundations for picker defaults and reset', () => {
    expect(DEFAULT_DEVICE_COLORS).toEqual({
      background: '#e1d9d1',
      section: '#f1ebe5',
      theme: '#8dbce3',
      text: '#292725',
    });
    expect(DEVICE_COLOR_FIELDS.map((field) => field.key)).toEqual(['background', 'section', 'theme', 'text']);
  });

  it('normalizes short, hashless and uppercase hex without accepting malformed values', () => {
    expect(normalizeHex('#AbC')).toBe('#aabbcc');
    expect(normalizeHex('FFA54B')).toBe('#ffa54b');
    expect(normalizeHex(' #060510 ')).toBe('#060510');
    for (const value of ['', '#12', '#1234', '#1234567', 'red', null, undefined, 123456]) {
      expect(normalizeHex(value)).toBeNull();
    }
    expect(normalizeDeviceColors({ background: '#060510', theme: '#ffa54b' })).toBeNull();
    expect(normalizeDeviceColors({ background: '#060510', theme: '#ffa54b', text: '#f3f0f8' })).toBeNull();
  });

  it('round-trips only the four colors in device storage', () => {
    const storage = memoryStorage();
    const colors = { background: '#101010', section: '#181818', theme: '#224466', text: '#eeeeee' };
    expect(writeDeviceColors(storage, colors)).toBe(true);
    expect(readDeviceColors(storage)).toEqual(colors);
    expect(JSON.parse(storage.getItem(DEVICE_COLOR_STORAGE_KEY))).toEqual(colors);
    expect(removeDeviceColors(storage)).toBe(true);
    expect(readDeviceColors(storage)).toBeNull();
  });

  it('keeps legacy three-color saves and supplies the new section default', () => {
    const legacy = { background: '#101010', theme: '#224466', text: '#eeeeee' };
    const storage = memoryStorage({ [DEVICE_COLOR_STORAGE_KEY]: JSON.stringify(legacy) });
    expect(readDeviceColors(storage)).toEqual({ ...legacy, section: DEFAULT_DEVICE_COLORS.section });
    // Reading is non-destructive; the next intentional edit writes the 4-color shape.
    expect(JSON.parse(storage.getItem(DEVICE_COLOR_STORAGE_KEY))).toEqual(legacy);
  });

  it('fails closed when storage is blocked or malformed', () => {
    const denied = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(readDeviceColors(denied)).toBeNull();
    expect(writeDeviceColors(denied, DEFAULT_DEVICE_COLORS)).toBe(false);
    expect(removeDeviceColors(denied)).toBe(false);
    expect(readDeviceColors(memoryStorage({ [DEVICE_COLOR_STORAGE_KEY]: '{not json' }))).toBeNull();
    expect(readDeviceColors(memoryStorage({ [DEVICE_COLOR_STORAGE_KEY]: '{"background":"#fff"}' }))).toBeNull();
  });

  it('changes only the supplied document root and can restore the default cascade', () => {
    const local = fakeRoot();
    const anotherDevice = fakeRoot();
    const colors = { background: '#112233', section: '#223344', theme: '#445566', text: '#ddeeff' };
    expect(applyDeviceColors(local, colors)).toBe(true);
    expect(local.properties.get('--color-paper')).toBe(colors.background);
    expect(local.properties.get('--color-paper-2')).toBe(colors.section);
    expect(local.properties.get('--color-accent')).toBe(colors.theme);
    expect(local.properties.get('--color-ink')).toBe(colors.text);
    expect(local.attributes.get('data-device-colors')).toBe('custom');
    expect(anotherDevice.properties.size).toBe(0);
    expect(anotherDevice.attributes.size).toBe(0);

    clearDeviceColorOverrides(local);
    expect(local.properties.size).toBe(0);
    expect(local.attributes.size).toBe(0);
  });

  it('never applies custom inline colors over the dark palette', () => {
    const root = fakeRoot();
    const colors = { background: '#112233', section: '#223344', theme: '#445566', text: '#ddeeff' };
    expect(applyDeviceColors(root, colors)).toBe(true);
    root.setAttribute('data-theme', 'dark');
    expect(applyDeviceColors(root, colors)).toBe(false);
    expect(root.properties.size).toBe(0);
    expect(root.attributes.has('data-device-colors')).toBe(false);
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('chooses a readable filled-button label and measures text contrast', () => {
    const colors = { ...DEFAULT_DEVICE_COLORS };
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThan(4.5);
    expect(contrastRatio(deviceAccentInk(colors), colors.theme)).toBeGreaterThan(4.5);
    expect(contrastRatio('not-a-color', colors.background)).toBe(0);
  });
});

describe('pre-paint device color restoration', () => {
  it('applies a valid saved palette before application hydration', () => {
    const storage = memoryStorage();
    const colors = { background: '#121212', section: '#242424', theme: '#336699', text: '#eeeeee' };
    writeDeviceColors(storage, colors);
    const root = fakeRoot();
    globalThis.window = { localStorage: storage };
    globalThis.document = { documentElement: root };

    new Function(DEVICE_COLOR_PREHYDRATION_SCRIPT)();

    expect(root.properties.get('--color-paper')).toBe(colors.background);
    expect(root.properties.get('--color-paper-2')).toBe(colors.section);
    expect(root.properties.get('--color-accent')).toBe(colors.theme);
    expect(root.properties.get('--color-ink')).toBe(colors.text);
    expect(root.attributes.get('data-device-colors')).toBe('custom');
  });

  it('skips a valid saved light palette when dark was restored first', () => {
    const storage = memoryStorage();
    const colors = { background: '#121212', section: '#242424', theme: '#336699', text: '#eeeeee' };
    writeDeviceColors(storage, colors);
    const root = fakeRoot();
    root.setAttribute('data-theme', 'dark');
    root.style.setProperty('--color-paper', colors.background);
    root.setAttribute('data-device-colors', 'custom');
    globalThis.window = { localStorage: storage };
    globalThis.document = { documentElement: root };

    new Function(DEVICE_COLOR_PREHYDRATION_SCRIPT)();

    expect(root.properties.size).toBe(0);
    expect(root.attributes.has('data-device-colors')).toBe(false);
    expect(readDeviceColors(storage)).toEqual(colors);
  });

  it('restores a legacy saved palette with the canonical section color', () => {
    const legacy = { background: '#121212', theme: '#336699', text: '#eeeeee' };
    const root = fakeRoot();
    globalThis.window = {
      localStorage: memoryStorage({ [DEVICE_COLOR_STORAGE_KEY]: JSON.stringify(legacy) }),
    };
    globalThis.document = { documentElement: root };

    new Function(DEVICE_COLOR_PREHYDRATION_SCRIPT)();

    expect(root.properties.get('--color-paper')).toBe(legacy.background);
    expect(root.properties.get('--color-paper-2')).toBe(DEFAULT_DEVICE_COLORS.section);
    expect(root.properties.get('--color-accent')).toBe(legacy.theme);
    expect(root.properties.get('--color-ink')).toBe(legacy.text);
  });

  it('does nothing for an absent or invalid saved palette', () => {
    const root = fakeRoot();
    globalThis.window = { localStorage: memoryStorage({ [DEVICE_COLOR_STORAGE_KEY]: '{"theme":"bad"}' }) };
    globalThis.document = { documentElement: root };

    new Function(DEVICE_COLOR_PREHYDRATION_SCRIPT)();

    expect(root.properties.size).toBe(0);
    expect(root.attributes.size).toBe(0);
  });
});

describe('account color customizer contract', () => {
  it('uses native pickers and hex fields without a server or account write path', () => {
    const panel = fs.readFileSync('components/settings/DeviceColorSettings.js', 'utf8');
    const settings = fs.readFileSync('app/(app)/settings/page.js', 'utf8');
    const account = fs.readFileSync('components/layout/AccountMenu.js', 'utf8');
    expect(panel).toContain('type="color"');
    expect(panel).toContain('type="text"');
    expect(panel).toContain('Reset to site colors');
    expect(panel).toContain('writeDeviceColors');
    expect(panel).not.toContain('fetch(');
    expect(panel).not.toContain('supabase');
    expect(settings).not.toContain("key: 'appearance'");
    expect(account).toContain('<DeviceColorSettings />');
  });
});
