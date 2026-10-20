# Galactic document intro

## Integration

- `components/layout/GalacticIntro.js` and its CSS module implement the supplied galactic SVG choreography, including the 760×110 stage, 24-unit plus gap, stroke/fill timing, flare, stars, nebula, tagline and breathing glow.
- `app/layout.js` mounts it above all page routes. Children render immediately underneath an inert boundary; there is no auth/data readiness dependency.
- `app/(app)/home/layout.js` is now a pass-through, and the obsolete readiness signal was removed from `home/page.js`.
- Removed superseded `HomeLaunchGate.js`, `CampusIntroLoader.js`, `lib/intro.js`, and `app/styles/intro.css`, plus its global import. Existing old intro cookies are ignored, not read or modified.
- `public/fonts/` contains self-hosted Syne and Space Grotesk with their OFL licenses. No dependency manifest changes or new runtime services.
- `tests/intro.test.js` now guards the new architecture. `scripts/tests/galactic-intro.mjs` adds executable Playwright checks.

## Lifecycle

The root layout persists across Next client navigation. Component state controls playback; a document-memory completion flag additionally protects against subsequent remounts. A full document load resets that memory. No route mutations, cookies, local storage, or session storage are used.

Explicit font loads precede SVG text measurement. A 400ms bounded wait falls back to system typography, frozen for the current playback to prevent late font swaps moving the plus. Animations begin only after measurement. Normal completion is 5.65 seconds after start, including a 400ms fade; an independent 6.2-second deadline does not depend on animation events. Timers, frame requests and listeners are cleaned up, including during Strict Mode effect replay.

Skip intro and Escape remove the overlay immediately without changing the URL. Focus returns to the content boundary when Skip held focus. Reduced motion reveals the application after approximately 100ms without running the choreography. Only the fixed overlay clips overflow; document scroll styles are never changed. CSS is module-scoped.

Authentication, proxy protection, OAuth/PKCE processing, authorization, sign-out implementation and database schema are unchanged. The OAuth server route does not render the root layout or wait for the animation. Existing server redirects still apply; the intro never overrides their destinations.

## Executed verification

- `npm run lint`: passed.
- `npm test`: 18 files / 216 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Playwright against the production build: passed fresh playback, immediate Skip, query preservation, no stale timer replay after Skip, refresh replay, automatic completion, Escape, client navigation via an existing Next Link, reduced motion, 320/390/844/1440 viewport bounds, 24-unit measured logo gap, aborted font requests, removal of inert state, no body scroll lock, and no page/hydration errors.
- HTTP smoke requests for `/`, `/login`, `/home`, `/market`, `/user/student`, `/onboarding`, and `/setup` returned rendered responses under the existing unconfigured deployment behavior. Missing-code `/auth/callback` returned its existing 307 to `/login?error=missing_code`, with no Set-Cookie header.

Browser command: `INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs`. Supports `CHROMIUM_EXECUTABLE_PATH`. In this sandbox Chromium was provided via a temporary, untracked npm installation, using its bundled shared libraries; no browser binaries or tooling dependencies were added to Git.

## Limitations

No live Supabase credentials/accounts were available. Login and protected routes use the existing unconfigured redirect to setup, so signed-in refresh, incomplete onboarding, sign-out and a real Google OAuth/PKCE round trip were not browser-verified. Existing auth and sign-out unit suites passed, but do not replace those integration checks. Chromium viewport tests are not physical iOS Safari/Android Chrome testing; WebKit was unavailable. Real-device orientation and browser-chrome viewport changes remain a manual verification task. Replay is intentionally omitted.
