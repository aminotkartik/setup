'use client';

/**
 * Appearance control.
 *
 * The theme lives in a cookie so the server can render the correct palette on
 * the first paint (no flash, no inline bootstrap script, and the value survives
 * a hard reload). `applyTheme` writes both the cookie and the attribute, so
 * switching is instant and the next request agrees.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

export const THEME_COOKIE = 'campus_theme';

/** Writes the cookie through a module-level helper so component bodies never
 * touch `document` directly (React's immutability rules). */
function writeThemeCookie(theme) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${year}; samesite=lax`;
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  writeThemeCookie(theme);
}

/**
 * The signature Campus+ appearance control: day sky, rotating sun, drifting
 * clouds; night sky with a crescent moon, stars, a shooting star and an aurora.
 */
export function ThemeSwitch({ theme = 'light', size = 'sm', label = 'Dark mode', className = '', onChange = null }) {
  const isDark = theme === 'dark';
  const [pending, setPending] = useState(null);

  const checked = pending ?? isDark;

  const toggle = () => {
    const next = checked ? 'light' : 'dark';
    setPending(next === 'dark');
    applyTheme(next);
    // Lets a parent (Settings → Appearance) keep its own state in step.
    if (onChange) onChange(next);
  };

  return (
    <label className={cn('theme-switch', size === 'lg' ? 'theme-switch-lg' : null, className)}>
      <input
        type="checkbox"
        role="switch"
        className="theme-switch__input"
        aria-label={label}
        checked={checked}
        onChange={toggle}
      />
      <span className="theme-switch__container" aria-hidden="true">
        <span className="theme-switch__clouds" />
        <span className="theme-switch__night">
          <span className="theme-switch__stars" />
          <span className="theme-switch__shooting" />
          <span className="theme-switch__shooting theme-switch__shooting-2" />
          <span className="theme-switch__meteor" />
          <span className="theme-switch__cluster">
            <span className="theme-switch__twinkle" />
            <span className="theme-switch__twinkle" />
            <span className="theme-switch__twinkle" />
            <span className="theme-switch__twinkle" />
            <span className="theme-switch__twinkle" />
          </span>
          <span className="theme-switch__comets">
            <span className="theme-switch__comet" />
            <span className="theme-switch__comet" />
          </span>
          <span className="theme-switch__aurora" />
        </span>
        <span className="theme-switch__orb">
          <span className="theme-switch__moon">
            <span className="theme-switch__spot" />
            <span className="theme-switch__spot" />
            <span className="theme-switch__spot" />
          </span>
        </span>
      </span>
    </label>
  );
}
