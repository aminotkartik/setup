# Campus+ — Deployment

Everything in this document is operator work: accounts, keys, migrations, email
auth, Vercel and the first Super Admin. **No application code has to be written
or edited to deploy Campus+.**

Order of operations: Supabase project → environment variables → migrations →
auth configuration → GIPHY (optional) → Vercel → first Super Admin → verification
→ moderation handover.

---

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard> (region closest to Pune:
   `ap-south-1` / Mumbai).
2. **Project Settings → Data API**: copy the *Project URL*.
3. **Project Settings → API Keys**: copy the *Publishable key* (older projects:
   "anon") and the *Secret key* (older projects: `service_role`).
4. Keep the secret key on your machine only — it bypasses RLS and is used solely
   by the maintenance scripts (`check:env`, `seed:dev`, `role:grant`,
   `role:list`, `verify:security`).

## 2. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase → API Keys → Publishable key |
| `SUPABASE_SECRET_KEY` | scripts only | Supabase → API Keys → Secret key |
| `CAMPUS_ALLOWED_EMAIL_DOMAINS` | yes | comma-separated institutional domains, e.g. `pccoepune.org` |
| `GIPHY_API_KEY` | optional | <https://developers.giphy.com/dashboard> → Create an App |
| `GIPHY_CLIENT_ID` | optional | any non-secret app id, default `campus_plus` |
| `GIPHY_CONTENT_RATING` | optional | `g` \| `pg` \| `pg-13` \| `r`, default `pg-13` |
| `NEXT_PUBLIC_PLATFORM_NAME` | optional | display name, default `Campus+` |
| `NEXT_PUBLIC_COLLEGE_NAME` | optional | display name, default `PCCOE` |

`npm run check:env` verifies all of this, refuses placeholders, and fails if a
secret has been placed in a `NEXT_PUBLIC_*` variable. Campus+ boots without
Supabase configured and shows `/setup` with the missing pieces — it never
fabricates credentials.

## 3. Migrations

The schema lives in `supabase/migrations/` (19 ordered files: extensions and
enums, identity/roles, blocks, communities, social, moderation core, messaging,
marketplace, campus, Random, platform, auth hooks, reference data, realtime and
grants, column privileges, staff actions, marketplace hardening, function grants,
staff visibility).

**Option A — Supabase CLI (recommended)**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — SQL editor**

Paste each file from `supabase/migrations/` into the SQL editor in filename order
and run it. Do not rename or reorder the files.

Reference data included in the migrations, ready to use:

* the `pccoe` college row with the `pccoepune.org` domain,
* 4 roles and ~47 permissions with their default role→permission mapping,
* marketplace categories, notice categories, branches, years, divisions,
* ~30 feature flags and ~16 platform settings,
* the notification/summary helper functions, realtime policies and audits.

After migrating, confirm the schema is intact:

```bash
npm run verify:db     # throwaway Postgres: applies every migration + 8 suites
npm run audit:db      # 54 static assertions: RLS, policies, grants, columns
```

## 4. Authentication configuration

Supabase dashboard → **Authentication**:

1. **Providers → Email**: enable Email, *disable* "Confirm email" (Campus+ uses
   one-time codes), and keep password sign-in off. There are no passwords in
   Campus+.
2. **Email templates → Magic Link**: the code is what students type, so keep
   `{{ .Token }}` in the template (the default template is fine).
3. **Auth → URL configuration**: set *Site URL* to the production origin and add
   `https://<your-domain>/login/verify` (and `http://localhost:3000/login/verify`
   for local work) to *Redirect URLs*.
4. **SMTP (production)**: Authentication → Emails → SMTP settings. The default
   Supabase sender is fine for a pilot but is rate-limited and often lands in
   spam; configure the college SMTP relay for real use.

Domain enforcement is server-side and lives in the database
(`colleges.email_domains`, `platform_settings.allowed_email_domains`,
`enforce_institutional_domain`) plus `CAMPUS_ALLOWED_EMAIL_DOMAINS` as the
deployment default. Adding a second domain is a row update — see §8.

## 5. GIPHY (optional)

1. Create an app at <https://developers.giphy.com/dashboard> and copy the API key.
2. Set `GIPHY_API_KEY` (server only) and, if required by your approval, a
   `GIPHY_CLIENT_ID` and `GIPHY_CONTENT_RATING`.
3. Nothing else to configure: the browser calls `/api/giphy/search`, the key never
   ships, attribution is rendered, and the picker degrades to a configuration
   notice when the key is absent.

## 6. Vercel

1. Import the repository (Framework preset: **Next.js**, build `npm run build`).
2. Add the environment variables from §2 for **Production**, **Preview** and
   **Development**. Only the two `NEXT_PUBLIC_*` values are inlined into the
   bundle; the rest stay server-side.
3. Deploy, then visit `/` — it routes to `/login`, `/setup` or `/home`
   depending on configuration and session state.
4. Local production check:

   ```bash
   npm install
   npm run build
   npm run start
   ```

Campus+ needs no cron jobs, no background workers and no extra services.

## 7. First Super Admin

Roles are database rows, so the very first one is granted from the command line
(the same audited RPC the admin UI uses):

```bash
# 1. Sign in once with the institutional address (so the account exists).
# 2. Grant the highest role:
npm run role:grant -- --email you@pccoepune.org --role super_admin

# Inspect:
npm run role:list
```

Afterwards use the application: **Admin → Users → Grant role**. `grant_role()`
refuses to grant `student` (it is the default) and requires the `assign_roles`
permission. Moderator and Admin accounts are created the same way — never by
editing an environment variable or a hardcoded list.

Development accounts created by the seeder (`npm run seed:dev -- --confirm`) are
clearly labelled (`dev_arjun`, `dev_meera`, `dev_kabir`, `@… (dev seed)`) and are
dev-only; they must not exist in production.

## 8. Platform configuration (runtime, no deploy)

Admin → Settings (permission `manage_platform_settings`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `allowed_email_domains` | `["pccoepune.org"]` | domains that may sign in |
| `marketplace_approval_mode` | `post_moderation` | publish immediately vs. staff approval first |
| `moderate_community_submissions` | `{resource:false, opportunity:false}` | send student submissions to review |
| `username_change_cooldown_days` | `30` | cooldown between username changes |
| `feed_marketplace_highlights` | `true` | include marketplace in the home feed |
| `random_session_max_minutes` | `60` | hard cap on a Random session |
| `random_retention_days` | `90` | retention before purge (reported sessions kept) |
| `announcement_banner`, `support_contact` | empty | optional Home banner and help address |

Feature flags (Admin → Feature flags) switch whole modules on and off —
`feed`, `discussions`, `polls`, `communities`, `group_chat`, `direct_messages`,
`gifs`, `random_chat`, `marketplace`, `gigs`, `free_stuff`, `deals`, … and more
for campus modules. Disabling one hides the surface and its actions.

### Two deliberate operator-only operations

Some changes are *configuration*, not content, and the migrations revoke
client-side `UPDATE` on them (migration 015) so that every change is reviewed and
versioned rather than clicked. Run them in the SQL editor:

```sql
-- a) Change which permissions a role holds
insert into public.role_permissions (role_key, permission_key)
values ('moderator', 'manage_events')
on conflict do nothing;

delete from public.role_permissions
 where role_key = 'moderator' and permission_key = 'manage_events';

-- b) Create a custom role (rare; rank decides authority)
insert into public.roles (key, label, description, rank, is_system)
values ('coordinator', 'Coordinator', 'Department event coordinator.', 15, false);

-- c) Approve a community-submitted resource or opportunity
--    (the status column is intentionally not client-writable)
update public.official_resources
   set status = 'published', approved_by = <admin profile uuid>, published_at = now()
 where id = '<resource uuid>';

update public.opportunities
   set status = 'published', approved_by = <admin profile uuid>, published_at = now()
 where id = '<opportunity uuid>';
```

Everything else — names, categories, official notices, events, deals, campus
information, settings and flags — is editable inside the application.

## 9. Verification before handing over

```bash
npm run check:env        # configuration complete, no secret in NEXT_PUBLIC_*
npm run verify           # lint + migrations + audit + tests
npm run verify:security  # live probe with the public key
npm run build            # production build covers every route
```

Then walk through the operator checklist (§9 of `docs/SECURITY.md`) and confirm
the empty states: a fresh database shows "nothing here yet" everywhere instead of
sample or invented content.

## 10. Operations

* **Moderation**: `/moderator` — report queue, marketplace review, Random reports,
  content actions, audit history. All human, all audited.
* **Administration**: `/admin` — users, roles, permissions (read-only by design),
  reports, official content, marketplace, events, settings, feature flags, audit
  logs and real operational counts.
* **Official content**: notices, events, campus information and deals are created
  in the UI by staff whose roles hold the matching permission; every row stores
  `created_by`, `updated_by`, `published_at` and `status`.
* **Suspensions and bans**: Admin → Users → *Change account status*, with a reason
  that is recorded in the audit log and shown to the student on
  `/account-status`.
* **Backups**: use Supabase's scheduled backups; Campus+ keeps no second copy of
  anything and stores no user files.
* **Retention**: `purge_random_data(retention_days)` clears expired Random
  sessions. Run it from the SQL editor (or a scheduled query) if you want the
  data minimised on a timetable.

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/` shows `/setup` | Supabase environment variables missing or still placeholders | set them in `.env.local` **and** Vercel |
| Login says "email domain not allowed" | address outside the allow-list | check `CAMPUS_ALLOWED_EMAIL_DOMAINS` and `platform_settings.allowed_email_domains` |
| No code email arrives | SMTP not configured or rate limit hit | configure SMTP (§4) and check Supabase Auth logs |
| GIF search says "not configured" | `GIPHY_API_KEY` missing | optional — add the key to enable GIFs |
| Moderator page shows the lock notice | the account holds no moderation permission | `npm run role:grant -- --username <name> --role moderator` |
| Admin action returns "you do not have permission" | UI gate passed but the database disagreed | expected: the database is authoritative. Check the role's permission mapping (§8a) |
| Build fails on a missing env var | only the public Supabase pair is required at build time | set `NEXT_PUBLIC_*` in Vercel for all environments |
