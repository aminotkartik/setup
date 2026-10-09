# Campus+ readability and contrast audit

## Outcome

The frontend now uses one role-based colour system, with **dark as the default** and an intentionally warm, blue-accented light palette. The work covers shared components and route families, rather than page-specific colour overrides. The cinematic sky, particles, gradient-frame buttons, Explore sheen, delete/keycap controls, celestial switch, restrained glass and intro choreography are retained.

**Verification, 8 October 2026:**

| Check | Result |
| --- | --- |
| Production build | PASS — Next.js 16.3.8 |
| `npm run verify` | PASS — lint, 23 migrations, 10 SQL test suites, 54 database audit checks, 159 unit tests / 12 files |
| Full production-build browser audit, both themes | PASS — 198 page audits, 560 paint checks, 37,922 foreground samples, 58 painted focus checks, 22 layout checks |
| Component follow-up, both themes | PASS — 6 page audits, 176 paint checks, 7,356 foreground samples, 42 painted focus checks |
| Chat-thread visual spot check, both themes | PASS — 2 page / 2 paint checks, 164 foreground samples |

All recorded runs above have **zero failures**. The component follow-up explicitly measures click-through toast ink; the final harness rejects empty foreground measurements instead of treating them as a pass. Counts are per run, not unique pages or independent accessibility certifications.

[Captured screens](contrast-evidence/README.md) · [Compact machine-readable evidence](contrast-evidence/results.json)

## Colour-system contract

`app/globals.css` owns the `--cp-*` roles. `light-dark()` pairs the two designed palettes in the same declaration. Explicit themes and System select `color-scheme`; an unset theme starts dark. Theme persistence, auth and server-side theme reading are unchanged.

| Role | Tokens / policy |
| --- | --- |
| Reading surfaces | `--cp-bg-page`, `--cp-bg-elevated`, `--cp-bg-subtle`, `--cp-bg-strong` |
| Reading ink | `--cp-text-primary`, `--cp-text-secondary`, `--cp-text-muted`, `--cp-text-subtle` |
| Inverse surfaces | `--cp-bg-inverse` + `--cp-text-inverse`; sky content has its own contextual roles |
| Accent | Separate `--cp-text-accent`, `--cp-bg-accent`, `--cp-text-on-accent`, and soft-accent pairs |
| Icons / edges | `--cp-icon*`, `--cp-border-control`, `--cp-focus`; subtle dividers are decorative, not the sole control boundary |
| Status | Paired `--cp-success-*`, `--cp-warning-*`, `--cp-danger-*`, `--cp-info-*` |
| Controls | Dedicated button, sheen, delete, keycap, input, search, checkbox and switch roles |
| Interaction | Dedicated hover, pressed, selected, disabled and disabled-selected pairs |
| Floating / glass | Strongly backed modal, dropdown, toast and glass surfaces; ink is not faded with the backing |

The existing `--c-*` and semantic Tailwind utilities bridge to this system. New component CSS should consume explicit role pairs. In particular, accent **text** and accent **fill** are different jobs; use the `accent-fill` utility for a coloured surface rather than assuming an accent-text colour is a button background.

### Contrast targets

- Normal text, descriptions, metadata, placeholders and disabled labels: **at least 4.5:1** on their intended surfaces.
- Large text: **at least 3:1**; the component palette generally retains the normal-text margin too.
- Meaningful icons, control boundaries and focus indicators: **at least 3:1**.
- Keyboard outlines: **2px**, visibly painted, rather than merely present in computed CSS.
- Disabled controls retain readable ink, their own backing/edge and appropriate native or ARIA state. Dashed edges distinguish unavailable buttons without relying only on colour.
- Selection uses existing native semantics, checks, markers and navigation indicators, not colour alone.

`tests/contrast.test.js` adds **22 numerical/architecture guards**. They cover both palettes, all text tiers across reading surfaces, gradient endpoints, status pairs, controls/placeholders, disabled and selected pairs, translucent backings over extreme underlays, celestial-switch glyphs, the search-glow budget, default/System behaviour and wheel focus/layering.

## Changes by component family

### Buttons and fields

Gradient-frame buttons keep the navy face and blue reveal, with a readable label at rest, hover and pressed endpoints. The Explore sheen, delete and keycap designs use their own foreground/background pairs. Disabled and loading labels no longer depend on low whole-control opacity.

Inputs, textareas, selects, composer fields, placeholders, icons, invalid borders and focus rings are theme-owned. Checkbox checks and tactile/celestial switch glyphs have explicit contrast pairings. The celestial switch retains its day/night animation; the light-day backing was darkened enough for its sun and thumb to remain visible.

### Search

The supplied pill/frame design remains recognisable: its gradient frame, icon, shortcut, typed value, placeholder and focus outline are retained and theme-aware. Blue decorative shadows are now restrained, short-radius semantic glows. A production scroll regression exposed the old shadow spilling below a sticky header and washing a light-mode Report label to **4.29:1**. The glow correction, not a ReportDialog workaround, fixes that case; both-theme rendered regression checks pass.

### Surfaces, navigation and content

Glass is backed strongly enough to read over light/dark images and gradients. Sheen/reflection layers sit below content. Cards, tabs, navigation, menus, badges, chips, avatars, notices, dialogs, toasts and loading/empty/error presentation share these roles. Notification read states and unavailable reactions retain readable copy rather than whole-row fades.

Chat bubbles, sender/timestamp metadata, message composers and poll options use scoped component classes. Marketplace, lost-found, community, profile and staff interfaces inherit the shared system; permission decisions, submission handlers and query behaviour are not replaced.

### Wheel and tilt

The three-way dial keeps its rotating-arc character, but uses 120-degree separation, upright copy, wrapped notes and explicit spacing. Other option counts get a non-clipping list layout. Optional native disabled states remain readable.

Two rendered regressions were corrected:

1. A hidden radio at the rotating arc's corner could make a narrow `overflow:hidden` panel scroll when focused, clipping visible choices. Native focus targets now stay at the rotation centre.
2. A transformed arc creates a stacking context. Its explicit foreground layer now sits above the panel reflection, preventing that reflection from washing out light-mode ink and keyboard outlines.

All three appearance choices were checked at desktop, 390px and **320px** widths. Labels neither overlap nor clip. Tilt glare is below its dedicated content layer; links/buttons remain usable.

### Home, Login and launch intro

Home and Login retain the deep-blue cinematic sky in both themes. Sky headings, descriptions, facts and footer links use contextual inverse ink; the form/composer uses its own theme-owned backing. The PCCOE crest is compiled to a public static asset URL, with no auth exception or remote asset dependency.

The real Home launch gate was rendered in desktop and portrait viewports in both themes. The complete CAMPUS wordmark and plus are visible; the existing deep-blue/white branding, choreography, reduced-motion path, Escape dismissal and failsafe remain unchanged. Animated Home samples at multiple phases also pass.

## Rendered coverage

The production-build matrix includes the required `/login`, `/home`, `/explore`, `/communities`, `/chat`, `/market`, `/notifications`, `/settings?tab=appearance`, `/profile`, `/moderator` and `/admin` screens **in both themes**. Student, moderator, administrator and anonymous contexts are separate. Additional routes cover campus modules, creation/edit/detail screens, posts/comments/polls, chat threads, public profiles, settings tabs, staff tabs, empty search, login notices/errors, onboarding and suspended-account presentation.

Visual review includes all required representative screens in both themes, plus actual chat bubbles, narrow-wheel choices, button/field states, dialogs and the launch intro. The evidence index preserves those captures using fake local accounts.

The real reusable components also run in an isolated browser gallery using production CSS. This is not a shipped route. It exercises rest/hover/keyboard-focus/pressed/disabled buttons, typed/placeholder/invalid/disabled fields, checked/unchecked controls, dropdowns, dialogs, passive toasts and wheel selections.

The browser checker combines axe colour-contrast checks with computed foreground/effective opacity and sampled **rendered backgrounds**. Temporarily hiding ink captures gradients, glass and effects beneath it; styles are always restored. A rerender causes a bounded retry. Focus checks count painted outline pixels. Image decode waits are bounded, and readiness uses load/font/DOM state rather than network-idle, which is unsuitable for realtime and inactive-account prefetch traffic.

## Reproduce locally

Use the existing disposable performance fixture backend. **Never point this tool at production.** The contrast account seeder only permits a local `campus_plus_perf` database; it creates two extra fixture accounts through the existing provisioning trigger to exercise real onboarding/account-state gates.

```bash
npm ci

# Optional PostgreSQL harness dependencies, isolated so app lockfile versions
# are not upgraded by a root-level no-save install.
npm install --prefix node_modules/.cache/contrast-tools --no-save --package-lock=false \
  embedded-postgres@18.4.0-beta.17 pg@8.23.1
[ -e node_modules/embedded-postgres ] || ln -s .cache/contrast-tools/node_modules/embedded-postgres node_modules/embedded-postgres
[ -e node_modules/pg ] || ln -s .cache/contrast-tools/node_modules/pg node_modules/pg
npx playwright install chromium

# Terminal 1: local PostgreSQL + authenticated Supabase fixture stub.
npm run perf:serve -- --rtt 0
```

In another terminal, build and serve with the **dummy fixture constants** (not real credentials):

```bash
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3111
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_perf_harness_key
export SUPABASE_SECRET_KEY=sb_secret_perf_harness_key
npm run build
npm run start -- --hostname 0.0.0.0 --port 3100
```

Then:

```bash
npm run test:contrast
npm run test:contrast -- --suite components
npm run test:contrast -- --suite mobile --theme both
npm run test:contrast -- --suite intro
npm run test:contrast -- --suite routes --route /campus/lost-found \
  --route '/explore?q=no_such_contrast_fixture_result'
npm run verify
```

Suites: `all`, `routes`, `components`, `mobile`, `motion`, `intro`. Themes: `both`, `dark`, `light`. `--quick` skips route mid/bottom samples. Repeatable `--route` and `--role` narrow a route run; roles include `student`, `moderator`, `admin`, `anonymous`, `onboarding`, `suspended`. `CONTRAST_APP_URL` overrides the local app URL; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing browser.

Reports/screenshots are written to `node_modules/.cache/contrast` and are deliberately not committed. Suite/theme reports are separate; generic report files are overwritten by the next run. In this network-restricted, GPU-less sandbox, optional packaged Chromium 153 used its CPU rasterizer; no product effects or animations were disabled to get a passing capture.

## Limits and preservation

- The existing production backend, auth/OAuth, RLS/migrations, realtime implementation, proxy/security configuration and theme persistence files are unchanged. `npm run verify` confirms the database/privacy/permission contracts still pass.
- Fixtures contain fake accounts/data and genuine local SQL/RLS execution, not a deployed Supabase service. Google sign-in, realtime transport, Giphy availability and live production data are **not** end-to-end validated by this readability audit.
- The fixture stub cannot resolve the blocked-users relationship; that settings tab renders the existing error presentation. Its normal blocked-list state is not claimed as rendered coverage. The unconfigured `/setup` screen was source-reviewed rather than rendered under a separate unconfigured build.
- Native OS select menus/tooltips, branding logos, every possible user-generated string, and every intermediate animation frame are not a universal WCAG certification. Native semantics, source guards, representative animated frames and visual review complement the numerical checks.
- No production audit route, fake auth branch, blanket foreground override or global raw-button/input/container patch was added. The standalone gallery and account seeding are development tooling only.
