'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import {
  DEFAULT_THEME,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  readTheme,
  writeTheme,
} from '@/lib/theme';
import {
  DEVICE_COLOR_STORAGE_KEY,
  applyDeviceColors,
  clearDeviceColorOverrides,
  readDeviceColors,
} from '@/lib/device-colors';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Custom colors belong to light mode; dark always uses its canonical palette. */
function syncDeviceColors(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    clearDeviceColorOverrides(root);
    return;
  }
  const saved = readDeviceColors(browserStorage());
  if (saved) applyDeviceColors(root, saved);
  else clearDeviceColorOverrides(root);
}

/**
 * One compact control is rendered in each responsive header composition. Both
 * instances listen to the same document event/storage key, so they never own
 * competing theme state and a change in another tab is reflected as well.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  const sync = useCallback((value, { persist = false, announce = false } = {}) => {
    const next = normalizeTheme(value) || DEFAULT_THEME;
    applyTheme(document.documentElement, next);
    syncDeviceColors(next);
    setTheme(next);
    if (persist) writeTheme(browserStorage(), next);
    if (announce) {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }));
    }
  }, []);

  useEffect(() => {
    // The pre-paint script is authoritative for the first client render. Read
    // its validated attribute rather than briefly applying a second default.
    const initial = normalizeTheme(document.documentElement.getAttribute('data-theme'))
      || readTheme(browserStorage());
    const frame = window.requestAnimationFrame(() => sync(initial));

    const onThemeChange = (event) => {
      const next = normalizeTheme(event.detail?.theme);
      if (next) sync(next);
    };
    const onStorage = (event) => {
      if (event.key === THEME_STORAGE_KEY) sync(readTheme(browserStorage()));
      // A custom palette edited in another tab must be restored when this tab
      // returns to light, without ever applying it while dark is active.
      if (event.key === DEVICE_COLOR_STORAGE_KEY) {
        syncDeviceColors(normalizeTheme(document.documentElement.getAttribute('data-theme')) || DEFAULT_THEME);
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [sync]);

  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="theme-toggle icon-btn icon-btn--glass"
      data-theme-toggle
      data-theme={theme}
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === 'dark'}
      title={`Switch to ${nextTheme} mode`}
      onClick={() => sync(nextTheme, { persist: true, announce: true })}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} />
      <span className="sr-only">{theme === 'light' ? 'Dark' : 'Light'} mode</span>
    </button>
  );
}
