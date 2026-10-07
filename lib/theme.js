import 'server-only';
import { cookies } from 'next/headers';

/**
 * Appearance storage (server side).
 *
 * The choice lives in a cookie so the server can render the correct palette in
 * the first byte of HTML. `components/ui/theme.js` owns the client half — it
 * writes the same cookie and flips `data-theme` on <html> instantly.
 */

export const THEME_COOKIE = 'campus_theme';

/** "light" | "dark" | "system" — resolved for this request. */
export async function readTheme() {
  const jar = await cookies();
  const value = jar.get(THEME_COOKIE)?.value;
  if (value === 'dark') return 'dark';
  if (value === 'system') return 'system';
  return 'light';
}
