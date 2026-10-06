# Campus+

An unofficial, **text-first** digital layer for campus life at PCCOE — built for
students who need the practical parts of a college community (feed, communities,
marketplace, events, notices, chat, anonymous Random conversations) without the
noise: no photo posts, no file uploads, no algorithms, no presence dots, no ads,
no tracking, and no AI anywhere.

> Campus+ is not an official PCCOE product and is not affiliated with the
> college. Sign-in is restricted to institutional Google accounts
> (`@pccoepune.org` by default) — there are no passwords and no codes to type.

---

## What it is

| | |
| --- | --- |
| **Text only** | Posts, comments, messages, listings and notices are text. The single media exception is a GIF from GIPHY. |
| **No AI** | No provider models, no embeddings, no vector search, no ranking service. Feeds are deterministic and configured in the database. |
| **Human moderation** | One report system, one queue, soft deletes, and an audit entry for every staff action. |
| **Privacy by default** | Public identity is `@username`; email is never rendered. No presence, no typing indicators, no read receipts beyond `Sent`/`Seen`. |
| **Real permissions** | Roles and permissions are database rows, enforced by RLS and `SECURITY DEFINER` functions — never by hiding a button. |
| **One stack** | Next.js (App Router) + Supabase (Postgres, Auth, Realtime). No queue, no cache server, no container, no extra service. |

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in the Supabase URL + publishable key
npm run check:env              # verify configuration (never prints secrets)
npm run dev                    # http://localhost:3000
```

With Supabase configured but no data, every surface shows an honest empty state —
Campus+ never invents students, listings or statistics.

To see a populated development database (clearly labelled dev fixtures):

```bash
npm run seed:dev -- --confirm
```

## First-time setup

1. **Supabase project** — create one and copy the Project URL and publishable key.
2. **Schema** — Dashboard only? Paste
   [`supabase/bundle/campus-plus-schema.sql`](supabase/bundle/campus-plus-schema.sql)
   into **SQL Editor → New query → Run** (one script, ends with an install
   report). With the CLI? `supabase link --project-ref <ref> && supabase db push`.
3. **Auth** — enable the Google provider with your Google OAuth client ID
   and secret, then allow `<your-origin>/auth/callback`. See
   `docs/DEPLOYMENT.md` §4.
4. **First Super Admin** — sign in once, then
   `npm run role:grant -- --email you@pccoepune.org --role super_admin`.
5. **GIPHY (optional)** — add `GIPHY_API_KEY` to enable GIF search.

The full walkthrough, including Vercel and the operator-only configuration, is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | develop, build, run production |
| `npm run lint` | ESLint (no dead code, no raw HTML, no stray `console.log`) |
| `npm test` | Vitest: validation, authorization, helpers, data contracts, moderation map, architecture guards |
| `npm run verify` | lint + migrations + audit + tests in one go |
| `npm run verify:db` | apply every migration to a throwaway Postgres and run the 8 database suites |
| `npm run audit:db` | 54 static assertions about RLS, policies and grants |
| `npm run verify:security` | live probe: anonymous access must be denied everywhere |
| `npm run check:env` | configuration audit (placeholders, secrets in `NEXT_PUBLIC_*`, git-ignored `.env.local`) |
| `npm run seed:dev -- --confirm` | development-only sample content |
| `npm run role:grant` / `role:list` | grant roles, inspect roles/permissions/settings |
| `npm run db:migrate` / `db:reset` / `db:test` | Supabase CLI passthroughs |
| `npm run db:bundle` | regenerate `supabase/bundle/campus-plus-schema.sql` (tracked; `-- --check` fails if stale) |

## Project layout

```
app/
  (app)/            authenticated surface (AppShell: sidebar + bottom nav)
    home  explore  market  communities  campus  chat  random
    profile  settings  notifications  moderator  admin
    post/[id]  user/[username]  communities/[slug]  market/listing/[id] …
  login  login/verify  onboarding  setup  account-status  rules  community/[slug]
  api/search  api/giphy/search        the only two JSON endpoints
components/         presentation + client interaction (never data access)
  ui/ layout/ posts/ chat/ marketplace/ campus/ communities/ moderation/
  admin/ random/ notifications/ search/ social/ identity/ media/ forms/
lib/
  actions/          'use server' mutations: validate → authorize → RPC
  data/             'server-only' reads, always RLS-scoped
  auth/ permissions/ validation/ giphy/ search/ notifications/ blocks/
  mentions/ ratelimit/ errors.js config.js config.server.js constants.js
supabase/migrations/  19 ordered migrations (schema, RLS, RPCs, seed data)
supabase/bundle/      campus-plus-schema.sql — the same 19 migrations as ONE
                      script, for deploying from the Supabase SQL Editor with
                      no CLI (generated + staleness-tested; not hand-edited)
database/tests/       8 SQL test suites run by npm run verify:db
tests/                Vitest suites (including the architecture guards)
scripts/              operator tooling (env check, seeding, roles, security probe)
docs/                 ARCHITECTURE.md · SECURITY.md · DEPLOYMENT.md · IMPLEMENTATION-REPORT.md
```

## Documentation

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, request lifecycle, data
  access, permissions, moderation, realtime, styling, testing.
* [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, RLS, secrets, privacy,
  rate limits and the pre-deployment checklist.
* [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase, auth, GIPHY, Vercel,
  first admin, runtime settings and troubleshooting.
* [`docs/IMPLEMENTATION-REPORT.md`](docs/IMPLEMENTATION-REPORT.md) — what was
  built, verified and what remains for the operator.

## Ground rules for contributors

1. **No AI, ever** — no provider SDKs, embeddings, vector stores or
   "smart" ranking. `tests/spec.test.js` fails the build if one appears.
2. **Text first** — no uploads, no image posts, no attachments. GIFs from the
   validated provider client are the only media.
3. **The database decides** — every rule is enforced in RLS/RPC as well as in the
   UI. A hidden button is not a permission check.
4. **No invented content** — empty states, never fake students, listings or
   numbers. Dev seed data stays clearly labelled and dev-only.
5. **Honest UI** — loading, empty and error states everywhere; never a raw
   database error, never a spinner that hides a failure.
6. **Accessibility and calm** — keyboard reachable, labelled controls, semantic
   markup, sufficient contrast, one warm off-white palette (no gradients, neon or
   glassmorphism).
