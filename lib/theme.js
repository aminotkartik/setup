import 'server-only';
import { cookies } from 'next/headers';

/**
 * Appearance storage (server side).
 *
 * The choice lives in a cookie so the server can render the correct palette in
 * the first byte of HTML. `components/ui/theme.js` owns the client half — it
 * writes the same cookie and flips `data-theme` on <html> instantly, and its
 * shared store keeps every toggle in the app synchronized.
 *
 * Campus+ is dark-first: a device with no saved preference gets the deep,
 * cozy, blue-tinted dark theme — not because dark is fashionable, but because
 * it is the product's designed default. The saved preference always wins.
 */

export const THEME_COOKIE = 'campus_theme';

/** "light" | "dark" | "system" — resolved for this request. Dark by default. */
export async function readTheme() {
  const jar = await cookies();
  const value = jar.get(THEME_COOKIE)?.value;
  if (value === 'light') return 'light';
  if (value === 'system') return 'system';
  // No preference (or an unknown value) → the designed default: dark.
  return 'dark';
}
