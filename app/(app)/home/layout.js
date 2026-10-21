import { preload } from 'react-dom';

/**
 * Home — the one route that shows the landing animation.
 *
 * The intro itself is mounted by the root layout's `<LandingIntro>` gate (it
 * has to sit above the app shell to cover it, and above `/` so the `/` → `/home`
 * redirect does not tear it down). This layout adds the two self-hosted faces
 * that only the intro paints, so the critical font hints ship with the only
 * route that can use them: `/login`, `/setup` and every app page no longer
 * preload fonts they never render.
 *
 * Each file is a single variable face covering every weight the intro uses, so
 * these hints do not preload unused weights. `crossOrigin: 'anonymous'` matches
 * the CORS mode browsers use for fonts; without it the preload would be
 * fetched twice.
 */
export default function HomeLayout({ children }) {
  preload('/fonts/Syne.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });
  preload('/fonts/SpaceGrotesk.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });

  return children;
}
