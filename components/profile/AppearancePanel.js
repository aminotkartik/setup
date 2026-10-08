'use client';

/**
 * Settings → Appearance.
 *
 * Two controls, two genuinely different jobs — but ONE state:
 *   - the moon/sun pill: flip this device between the light and dark campus;
 *   - the wheel: choose Light, Dark or System once, with the weight the choice
 *     deserves (System follows the operating system, including when it changes
 *     mid-session).
 *
 * Both read the same module store (components/ui/theme.js) as the header and
 * account-menu switches, so there is no second toggle state anywhere: the
 * controls cannot disagree, and this page stays a view over the one truth.
 * The preference is stored on this device (cookie + `data-theme` on <html>),
 * so the server renders the correct palette on the first byte — no flash of
 * the wrong theme, and no invented account setting the database would not
 * honour.
 */

import { useSyncExternalStore } from 'react';
import {
  ThemeSwitch,
  WheelSelector,
  applyTheme,
  subscribeTheme,
  readThemeSnapshot,
  readThemePreference,
} from '@/components/ui';

const OPTIONS = [
  { value: 'light', label: 'Light', note: 'Warm daylight' },
  { value: 'dark', label: 'Dark', note: 'Low-light campus' },
  { value: 'system', label: 'System', note: 'Follow this device' },
];

/** Live OS preference — server snapshot is dark, so hydration is stable. */
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

export function AppearancePanel({ theme = 'dark' }) {
  const current = useSyncExternalStore(subscribeTheme, readThemePreference, () =>
    theme === 'light' || theme === 'system' ? theme : 'dark',
  );
  const resolved = useSyncExternalStore(subscribeTheme, readThemeSnapshot, () =>
    theme === 'light' ? 'light' : 'dark',
  );
  const systemDark = useSystemPrefersDark();

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
          <ThemeSwitch theme={resolved} size="lg" className="mx-auto" />
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
          name="appearance"
          legend="Appearance preference"
          options={OPTIONS}
          value={current}
          onChange={(value) => applyTheme(value)}
        />

        <p className="text-2xs text-muted-soft">
          Saved on this device only. A different phone or browser keeps its own choice.
          {current === 'system' ? ` This device is ${systemDark ? 'dark' : 'light'} right now.` : ''}
        </p>
      </section>
    </div>
  );
}
