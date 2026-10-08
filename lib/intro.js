import 'server-only';
import { cookies } from 'next/headers';

/**
 * Launch intro storage (server side).
 *
 * Mirrors the appearance-cookie pattern (`lib/theme.js`): the Home launch
 * intro is a once-per-browser-session experience, so its "seen" mark lives in
 * a session cookie — no `max-age`, it dies with the browsing session. The
 * server reads it to decide whether a Home response should carry the cinematic
 * overlay at all; `components/layout/HomeLaunchGate.js` owns the client half,
 * which writes the same cookie (plus a sessionStorage mirror) the moment the
 * intro starts, so it never replays mid-session — not on navigation, not on a
 * reload, not after a skip.
 */

export const INTRO_COOKIE = 'campus_intro';

/** Whether this session has already seen the launch intro. */
export async function readIntroSeen() {
  const jar = await cookies();
  return jar.get(INTRO_COOKIE)?.value === '1';
}
