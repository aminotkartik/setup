'use client';

/**
 * Appearance control — one theme state, one switch.
 *
 * The Campus+ theme toggle is the supplied moon/sun pill switch, integrated
 * into the design system: the checkbox is checked in light mode (exactly like
 * the source), the gold moon gives way to the warm sun, and the sky moves
 * from deep Campus+ blue to luminous cyan.
 *
 * Every placement — desktop header, account menu, mobile sheet and Settings →
 * Appearance — reads the SAME state through the module store below, so two
 * controls can never show different themes or fight over the cookie. The
 * preference is stored on this device (cookie + `data-theme` on <html>), so
 * the server paints the right palette on the first byte: no flash.
 *
 * Dark is the product default (see `lib/theme.js`): no saved preference means
 * dark. The wheel in Settings can still choose "follow this device"; when it
 * does, the switch tracks the OS live.
 */

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

export const THEME_COOKIE = 'campus_theme';

/* ── Shared theme state ───────────────────────────────────────────────────── */

const LISTENERS = new Set();
let snapshot = null;
let osListening = false;

function resolveNow() {
  const mode = document.documentElement.dataset.theme || 'dark';
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode === 'light' ? 'light' : 'dark';
}

function ensureListeners() {
  if (typeof window === 'undefined' || osListening) return;
  osListening = true;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if ((document.documentElement.dataset.theme || 'dark') === 'system') {
      snapshot = resolveNow();
      LISTENERS.forEach((listener) => listener());
    }
  });
}

export function subscribeTheme(listener) {
  ensureListeners();
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** Resolved mode ("light" | "dark") — what the screen is showing right now. */
export function readThemeSnapshot() {
  if (typeof document === 'undefined') return 'dark';
  if (snapshot === null) snapshot = resolveNow();
  return snapshot;
}

/** Stored preference ("light" | "dark" | "system") — what the user chose. */
export function readThemePreference() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' || document.documentElement.dataset.theme === 'system'
    ? document.documentElement.dataset.theme
    : 'dark';
}

function notifyTheme() {
  if (typeof document === 'undefined') return;
  snapshot = resolveNow();
  LISTENERS.forEach((listener) => listener());
}

/** Writes the cookie through a module-level helper so component bodies never
 * touch `document` directly (React's immutability rules). */
function writeThemeCookie(mode) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${year}; samesite=lax`;
}

/**
 * Apply a theme now and persist it. `mode` is "light" | "dark" | "system" —
 * "system" keeps the cookie on "system" while the palette follows the OS
 * immediately (and keeps following it if the OS changes mid-session).
 */
export function applyTheme(mode) {
  if (typeof document === 'undefined') return;
  const next = mode === 'system' ? 'system' : mode === 'light' ? 'light' : 'dark';
  writeThemeCookie(next);
  document.documentElement.dataset.theme = next;
  notifyTheme();
}

/* ── The switch ──────────────────────────────────────────────────────────── */

const SIZE = { sm: 'sm', md: 'md', lg: 'lg' };

/**
 * The moon/sun pill switch. Checked = light mode, unchecked = dark mode.
 * Controlled by the shared store, so every instance in the app always agrees.
 */
export function ThemeSwitch({ theme = 'dark', size = 'md', className = '', onChange = null, label = 'Light mode', disabled = false }) {
  const resolved = useSyncExternalStore(subscribeTheme, readThemeSnapshot, () =>
    theme === 'light' ? 'light' : 'dark',
  );
  const checked = resolved === 'light';

  const toggle = () => {
    const next = checked ? 'dark' : 'light';
    applyTheme(next);
    if (onChange) onChange(next);
  };

  return (
    <label
      className={cn('theme-switch', className)}
      data-size={SIZE[size] || SIZE.md}
      title={checked ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <input
        type="checkbox"
        role="switch"
        className="theme-switch__input"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={toggle}
      />
      <span className="theme-switch__back" aria-hidden="true" />
      <svg className="theme-switch__moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true">
        <path d="M223.5 32C100 32 0 132.3 0 256S100 480 223.5 480c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z"></path>
      </svg>
      <svg className="theme-switch__sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true">
        <path d="M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z"></path>
      </svg>
    </label>
  );
}
