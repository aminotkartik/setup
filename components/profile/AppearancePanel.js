'use client';

/**
 * Settings → Appearance.
 *
 * Two controls, two genuinely different jobs:
 *   - the day/night switch: flip this device between the light and dark campus;
 *   - the wheel: choose Light, Dark or System once, with the weight the choice
 *     deserves (System follows the operating system, including when it changes
 *     mid-session).
 *
 * The preference is stored on this device (cookie + `data-theme` on <html>), so
 * the server renders the correct palette on the first byte — no flash of the
 * wrong theme, and no invented account setting the database would not honour.
 */

import { useState, useSyncExternalStore } from 'react';
import { THEME_COOKIE, ThemeSwitch, WheelSelector, applyTheme } from '@/components/ui';

const OPTIONS = [
  { value: 'light', label: 'Light', note: 'Warm daylight' },
  { value: 'dark', label: 'Dark', note: 'Low-light campus' },
  { value: 'system', label: 'System', note: 'Follow this device' },
];

/** Live OS preference — server snapshot is light, so hydration is stable. */
function subscribeToSystem(onChange) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useSystemPrefersDark() {
  return useSyncExternalStore(
    subscribeToSystem,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
}

export function AppearancePanel({ theme = 'light' }) {
  const [current, setCurrent] = useState(theme === 'dark' ? 'dark' : theme === 'system' ? 'system' : 'light');
  const systemDark = useSystemPrefersDark();

  const resolved = current === 'system' ? (systemDark ? 'dark' : 'light') : current;

  const choose = (value) => {
    setCurrent(value);
    if (value === 'system') {
      // Paint the OS palette now, but keep the cookie saying "system" so the
      // server keeps following the device on the next request.
      applyTheme(systemDark ? 'dark' : 'light');
      writeSystemCookie();
      return;
    }
    applyTheme(value);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-4 p-4 sm:p-5">
        <div>
          <h2 className="t-section">Day and night</h2>
          <p className="t-caption mt-1">
            Two designed themes, not one theme inverted. The switch is instant and applies to every page.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-4">
          <ThemeSwitch
            key={resolved}
            theme={resolved}
            size="lg"
            className="mx-auto"
            onChange={(next) => setCurrent(next)}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-semibold">
              {current === 'system'
                ? `Following this device (currently ${resolved})`
                : resolved === 'dark'
                  ? 'Dark theme is on'
                  : 'Light theme is on'}
            </p>
            <p className="t-caption mt-0.5">Tap the switch for a quick flip between light and dark.</p>
          </div>
        </div>

        <WheelSelector
          key={current}
          name="appearance"
          legend="Appearance preference"
          options={OPTIONS}
          defaultValue={current}
          onChange={choose}
        />

        <p className="text-2xs text-muted-soft">
          Saved on this device only. A different phone or browser keeps its own choice.
        </p>
      </section>
    </div>
  );
}

/** Keeps the cookie saying "system" while the palette follows the OS right now. */
function writeSystemCookie() {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=system; path=/; max-age=${year}; samesite=lax`;
}
