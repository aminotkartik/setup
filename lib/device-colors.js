/**
 * Optional appearance colors for this browser only.
 *
 * The Campus+ palette in app/tokens.css remains the default everywhere. These
 * helpers only ever read/write four color values in localStorage; there is no
 * account, cookie, server action, or platform-setting involved.
 */

export const DEVICE_COLOR_STORAGE_KEY = 'campusplus:device-colors-v1';
export const DEVICE_COLOR_ATTRIBUTE = 'data-device-colors';

export const DEVICE_COLOR_FIELDS = [
  { key: 'background', variable: '--color-paper', label: 'Background color' },
  { key: 'section', variable: '--color-paper-2', label: 'Section color' },
  { key: 'theme', variable: '--color-accent', label: 'Theme color' },
  { key: 'text', variable: '--color-ink', label: 'Text color' },
];

// sRGB equivalents of the canonical Lumen OKLCH tokens. They are used only to
// display/reset the controls; no saved value means the original CSS wins.
export const DEFAULT_DEVICE_COLORS = Object.freeze({
  background: '#060510',
  section: '#0d0b19',
  theme: '#ffa54b',
  text: '#f3f0f8',
});

const HEX_3 = /^[0-9a-f]{3}$/i;
const HEX_6 = /^[0-9a-f]{6}$/i;

/** Accept #rgb, #rrggbb, or the same values without the leading hash. */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let digits = value.trim().replace(/^#/, '');
  if (HEX_3.test(digits)) digits = [...digits].map((digit) => digit + digit).join('');
  if (!HEX_6.test(digits)) return null;
  return `#${digits.toLowerCase()}`;
}

export function normalizeDeviceColors(value) {
  if (!value || typeof value !== 'object') return null;
  const colors = {};
  for (const { key } of DEVICE_COLOR_FIELDS) {
    const color = normalizeHex(value[key]);
    if (!color) return null;
    colors[key] = color;
  }
  return colors;
}

function normalizeStoredDeviceColors(value) {
  // Version 1 originally stored three values. Keep those preferences usable
  // and add only the new canonical section default; the next edit writes all 4.
  if (value && typeof value === 'object' && value.section === undefined) {
    return normalizeDeviceColors({ ...value, section: DEFAULT_DEVICE_COLORS.section });
  }
  return normalizeDeviceColors(value);
}

export function readDeviceColors(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(DEVICE_COLOR_STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredDeviceColors(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDeviceColors(storage, value) {
  const colors = normalizeDeviceColors(value);
  if (!colors || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(DEVICE_COLOR_STORAGE_KEY, JSON.stringify(colors));
    return true;
  } catch {
    return false;
  }
}

export function removeDeviceColors(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(DEVICE_COLOR_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function rgb(hex) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

/** WCAG contrast ratio for two valid hex colors; invalid input is not a pair. */
export function contrastRatio(first, second) {
  const a = normalizeHex(first);
  const b = normalizeHex(second);
  if (!a || !b) return 0;
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** Pick a readable label color for filled theme-color buttons. */
export function deviceAccentInk(value) {
  const colors = normalizeDeviceColors(value);
  if (!colors) return '#000000';
  const candidates = [colors.background, colors.text, '#000000', '#ffffff'];
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, colors.theme) > contrastRatio(best, colors.theme) ? candidate : best,
  candidates[0]);
}

/** Apply an override to one document root, never to a shared/server payload. */
export function applyDeviceColors(root, value) {
  const colors = normalizeDeviceColors(value);
  if (!colors || !root?.style) return false;
  for (const { key, variable } of DEVICE_COLOR_FIELDS) {
    root.style.setProperty(variable, colors[key]);
  }
  root.style.setProperty('--color-accent-ink', deviceAccentInk(colors));
  root.setAttribute(DEVICE_COLOR_ATTRIBUTE, 'custom');
  return true;
}

export function clearDeviceColorOverrides(root) {
  if (!root?.style) return;
  for (const { variable } of DEVICE_COLOR_FIELDS) root.style.removeProperty(variable);
  root.style.removeProperty('--color-accent-ink');
  root.removeAttribute(DEVICE_COLOR_ATTRIBUTE);
}

/*
 * This function is serialized into a tiny inline script by the root layout.
 * Keep it self-contained: imports and module variables are not available when
 * the script executes. It is static code, not HTML built from user data.
 */
function prehydrateDeviceColors(storageKey, fields, legacySection) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const colors = {};
    for (const [key] of fields) {
      const stored = saved?.[key] === undefined && key === 'section' ? legacySection : saved?.[key];
      if (typeof stored !== 'string') return;
      let digits = stored.trim().replace(/^#/, '');
      if (/^[0-9a-f]{3}$/i.test(digits)) digits = [...digits].map((digit) => digit + digit).join('');
      if (!/^[0-9a-f]{6}$/i.test(digits)) return;
      colors[key] = `#${digits.toLowerCase()}`;
    }

    const luminance = (hex) => {
      const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
      const [r, g, b] = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    };
    const contrast = (first, second) => {
      const light = Math.max(luminance(first), luminance(second));
      const dark = Math.min(luminance(first), luminance(second));
      return (light + 0.05) / (dark + 0.05);
    };
    const candidates = [colors.background, colors.text, '#000000', '#ffffff'];
    const accentInk = candidates.reduce((best, candidate) =>
      contrast(candidate, colors.theme) > contrast(best, colors.theme) ? candidate : best,
    candidates[0]);

    const root = document.documentElement;
    for (const [key, variable] of fields) root.style.setProperty(variable, colors[key]);
    root.style.setProperty('--color-accent-ink', accentInk);
    root.setAttribute('data-device-colors', 'custom');
  } catch {
    // A blocked or malformed device store must never block the application.
  }
}

export const DEVICE_COLOR_PREHYDRATION_SCRIPT = `(${prehydrateDeviceColors.toString()})(${JSON.stringify(DEVICE_COLOR_STORAGE_KEY)},${JSON.stringify(DEVICE_COLOR_FIELDS.map(({ key, variable }) => [key, variable]))},${JSON.stringify(DEFAULT_DEVICE_COLORS.section)});`;
