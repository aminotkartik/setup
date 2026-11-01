/**
 * The two product themes.
 *
 * Theme preference is deliberately small and browser-local: it is not an
 * account setting, a cookie, or a server payload. The root's inline script
 * restores the same validated value before the first paint, and the header
 * control uses these helpers for subsequent changes.
 */

export const THEME_STORAGE_KEY = 'campusplus:theme-v1';
export const THEME_ATTRIBUTE = 'data-theme';
export const THEME_CHANGE_EVENT = 'campus:theme-change';
export const DEFAULT_THEME = 'light';

export const THEME_PALETTES = Object.freeze({
  light: Object.freeze({
    background: '#E1D9D1',
    section: '#F1EBE5',
    accent: '#8DBCE3',
    text: '#292725',
  }),
  dark: Object.freeze({
    background: '#191D21',
    section: '#252B30',
    accent: '#91BFE5',
    text: '#F0EEE9',
  }),
});

export function normalizeTheme(value) {
  return value === 'light' || value === 'dark' ? value : null;
}

export function readTheme(storage) {
  if (!storage || typeof storage.getItem !== 'function') return DEFAULT_THEME;
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY)) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(storage, value) {
  const theme = normalizeTheme(value);
  if (!theme || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Keep browser chrome aligned when the document theme changes. */
export function syncThemeChrome(root, value) {
  const theme = normalizeTheme(value) || DEFAULT_THEME;
  const documentRef = root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const meta = documentRef?.querySelector?.('meta[name="theme-color"]');
  meta?.setAttribute?.('content', THEME_PALETTES[theme].background);
  return theme;
}

export function applyTheme(root, value) {
  const theme = normalizeTheme(value) || DEFAULT_THEME;
  if (!root?.setAttribute) return theme;
  root.setAttribute(THEME_ATTRIBUTE, theme);
  syncThemeChrome(root, theme);
  return theme;
}

/*
 * Serialized into the root layout. Keep this function self-contained: imports
 * and module variables do not exist when the inline script executes. There is
 * intentionally no operating-system theme lookup; an explicit saved choice is
 * the only thing that can change the light default.
 */
function prehydrateTheme(storageKey, defaultTheme, palettes) {
  const root = document.documentElement;
  let theme = defaultTheme;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // A blocked store still gets the deterministic light default.
  }
  root.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', palettes[theme].background);
}

export const THEME_PREHYDRATION_SCRIPT = `(${prehydrateTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)},${JSON.stringify(DEFAULT_THEME)},${JSON.stringify(THEME_PALETTES)});`;
