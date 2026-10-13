# Campus+ — UI/UX revamp log

Living changelog for the "BUILD A NEW CAMPUS+" frontend replacement. The engine
(Next.js, Supabase, server actions, RLS, auth, realtime chat) is untouched; this
tracks the cockpit being replaced.

## Shipped

| Area | State |
| --- | --- |
| Cinematic launch intro | ✅ PR #6 — black → emblem → wordmark → tagline → blinds open onto Home; one intro per browser (`campus_intro` cookie); skippable; reduced-motion still frame |
| Theme system | ✅ Dark default (`lib/theme.js`), one shared store (`components/ui/theme.js`), supplied moon/sun pill toggle everywhere, `'system'` passes through the cookie, no flash |
| Primary button | ✅ Supplied gradient-frame button adapted to warm vibrant blue (`cp-btn-face`), animated frame, hover reveal, active scale `.9`, idle drift |
| Explore / Delete buttons | ✅ Explore = bright sheen, **hard black label**; Delete stays dedicated destructive |
| Search | ✅ Supplied pill as scoped `SearchField` (Explore results, feed entry, shell header); search backend untouched |
| Glass system | ✅ Four levels in `surfaces.css`: soft (cards) / floating (chrome) / featured (composer) / cinematic (Login + Home) |
| Depth field | ✅ `components/atmosphere/DepthField.js` + `depth/createDepthField.js` — one shared Three.js surface for Home: a single displaced mesh with three contour families (height levels, a slower echo, and distance rings) plus a horizon glow, all shader-driven; transparent far dissolve so the field has no visible edge; no post-processing, no textures, no lights. Reduced-motion still frame, hidden-tab and off-screen pause, DPR/segment budget by device, shader-compile detection that swaps in the CSS ridge fallback, full teardown. Login keeps its own ghost scene; the superseded 2D `ParticleField` is retired |
| Login | ✅ Cinematic stage + warm light glass panel + ghost scene |
| Home | ✅ **Campus+ after dark** — three movements: a threshold (live marker, display-size greeting with a selective electric-blue highlight, Explore + search, mono counts of what the page loaded), the works (composer band + one stream of entries whose kind drives a lit left marker, an event date plate, a price plate, editorial notices — plus a rail of five differently-composed destinations: event timeline, noticeboard, activity counters, marketplace, keypad), and a coda. Entries sweep a hairline of light on hover; islands share one elevation scale; the rail detaches and becomes a normal stacked column below 1200px. Composer, feed data, permissions, empty/unavailable states and light/dark all preserved (`app/styles/home.css`, `components/home/*`, `components/content/ContentCard.js` + `components/posts/PostCard.js` `variant="stream"`) |
| Team finder routing | ✅ Root cause fixed (dead `/explore/team-finder` link in Explore card); canonical `/campus/teams` (`ROUTES.teams`); stale `revalidatePath` fixed; proxy 307s legacy spellings |
| Lost & found | ✅ Explicit [LOST ITEM] / [FOUND ITEM] choice first; kind leads cards/forms/banners; detail page `/campus/lost-found/[id]`; backend untouched |
| Mobile nav | ✅ Floating glass bottom pill, active accent pill, safe-area padding |
| Appearance panel | ✅ Pure view over the shared theme store |

## Verification snapshot (revamp commit `ffd525d`)

- `npm test` 137/137 · `npm run lint` clean · `npm run build` all routes incl. `/campus/lost-found/[id]`
- Legacy redirects smoke-tested 307 → canonical; compiled CSS contains every new material
- Toggle geometry mock-rasterized both states (gold moon left / warm sun right)

## In flight

- Secondary-page sweep (Chat, Communities, Marketplace, Forms) through the new system
- Responsive QA at 320 / 375 / 390 / 430 + tablet + desktop
- End-to-end theme-toggle sync check in a live session (header ↔ account menu ↔ Appearance)

## Readability and contrast follow-up

See [CONTRAST-AUDIT.md](CONTRAST-AUDIT.md) for the paired semantic palettes, rendered state/route coverage, regression checks and preserved backend boundaries. [Captured evidence](contrast-evidence/README.md) includes both themes and narrow-screen examples.
