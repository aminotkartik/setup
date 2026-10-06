# Campus+ — Security

Campus+ runs on student data inside an institutional context, so the security
model is deliberately conservative: **the database decides, the application only
asks.** This document describes what is protected, how, and what to check before
and after every deployment.

---

## 1. Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| Student email addresses | harvesting, enumeration | email is never rendered; public identity is `@username`; `profile_private` holds contact/status columns and is staff-only |
| Anonymous Random identity | deanonymisation by a partner or by a curious student | identities live in `random_sessions` / `random_messages`, are exposed only through participant-checked views, and staff need the separate `view_random_sessions` permission (every access audited) |
| Moderation evidence | deletion by the reported student | soft delete only (`status` column); `delete_own_content()` never removes moderation rows |
| Audit trail | tampering, forgery | `notifications` and `audit_logs` have no client INSERT policy; audit rows are written only from inside `SECURITY DEFINER` functions |
| Service credentials | leakage into the browser bundle | only two `NEXT_PUBLIC_*` values exist (Supabase URL + publishable key); secrets are behind `import 'server-only'` |
| Abuse (spam, flooding) | scripted posting/DMs/OTP | database-side rate limiting via `consume_rate_limit()` with named buckets |
| Cross-site scripting | stored HTML/JS in posts, bios, messages | React text rendering only, `no dangerouslySetInnerHTML` (lint + test), external URLs restricted to `http(s)` |
| Privilege escalation | a student granting themselves a role | `user_roles`/`roles`/`role_permissions` UPDATE revoked from client roles; `grant_role`/`revoke_role` are `SECURITY DEFINER` with `assign_roles` checks and audit |

---

## 2. Authentication

* **Email one-time code only.** No passwords are stored anywhere, and no PRN or
  roll number is used as an identifier.
* The institutional domain is enforced **server-side twice**: in the login action
  (`lib/auth/domains.js`) and in the database (`enforce_institutional_domain`
  trigger, `allowed_email_domain()`, `colleges.email_domains`, plus
  `platform_settings.allowed_email_domains`).
* A missing `CAMPUS_ALLOWED_EMAIL_DOMAINS` falls back to the seeded `pccoepune.org`;
  an empty allow-list never means "allow everyone".
* Rate limiting applies to code requests (`consume_rate_limit('otp_request')`),
  so the endpoint cannot be used as an open email relay.
* Account states — `pending`, `active`, `suspended`, `banned`, `deactivated`,
  `deleted` — are enforced by `is_active_profile()` in RLS and re-checked by
  `can()` in the UI. A suspended student sees `/account-status`, not the app.
* Session cookies are refreshed by `proxy.js` with `@supabase/ssr`, so tokens are
  never stored in `localStorage`.

## 3. Authorization

* Four roles (Student, Moderator, Admin, Super Admin) and 53 permissions are
  **database rows**, never hardcoded email lists.
* Two enforcement points, always both:
  1. `can(actor, permission)` in the server action/page — the *offer*;
  2. RLS policies, `has_permission()` inside `SECURITY DEFINER` functions, and
     column-level `GRANT` statements — the *decision*.
* Unknown permission keys fail closed.
* `roles`, `role_permissions`, `platform_settings`, `feature_flags`,
  `user_roles` and `reserved_usernames` are read-only for client roles
  (migration 015). Platform settings change through
  `admin_set_platform_setting()`; roles change through `grant_role()` /
  `revoke_role()`; anything else is an operator migration (see DEPLOYMENT.md).
* Deeper coverage: `npm run audit:db` asserts that every exposed table has RLS
  enabled with explicit policies, that `public_profiles` never exposes private
  columns, and that moderation access to messages requires an open report.

## 4. Input handling

* Every write validates against a schema in `lib/validation/schemas.js`
  (lengths, enums, UUIDs, dates, URLs, GIF references) using
  `lib/validation/primitives.js`. The database `CHECK` constraints are the second
  line of defence, never the only one.
* Text is cleaned (control characters stripped, whitespace collapsed) but never
  "trusted": it is rendered as text, so markup is inert.
* External links must be `http(s)://`. `javascript:`, `data:` and
  protocol-relative URLs are rejected in validation **and** by
  `isSafeExternalUrl()` at render time.
* GIF references must name the GIPHY provider, carry a valid id, and use a URL on
  the approved host list. Nothing else can enter a message, post or comment.
* Raw Postgres errors never reach a student: `fromPostgresError()` maps them to
  human messages and the original is logged server-side only.

## 5. Privacy by construction

* No photos, no uploads, no file storage, no presence, no typing indicators, no
  read receipts beyond `Sent`/`Seen`.
* Public profile = `@username`, display name, bio, branch/year (if the student
  allows it), and staff marker. Email, account status, suspension reason and
  moderation history are never public.
* Blocking is central (`lib/blocks.js` + `is_blocked()`): blocked pairs disappear
  from feeds, chat, search, notifications, marketplace and mentions, and a blocked
  student cannot start a conversation or record interest in a listing.
* Search results, notification deep links and mention resolution all respect
  blocks, visibility and permissions.
* Random sessions retain identity server-side for moderation, are never exposed
  to the partner, are never shareable, and expire after
  `platform_settings.random_session_max_minutes`. Reported sessions are exempt
  from `purge_random_data()`.
* Campus+ stores no analytics, no tracking pixels and no third-party scripts.

## 6. Rate limits

Buckets are defined once in `lib/constants.js` and consumed inside the database,
so they cannot be bypassed by calling the API directly:

| Bucket | Applies to |
| --- | --- |
| `otp_request` | one-time code requests |
| `post_create`, `comment_create`, `reaction_toggle` | feed activity |
| `message_send` | direct messages and Random messages |
| `listing_create`, `community_create`, `project_create` | creation surfaces |
| `report_create` | reports (anti-brigading) |
| `random_queue_join`, `random_message` | Random |
| `username_change` | username changes (plus the cooldown setting) |
| `gif_search` | the GIPHY proxy, protecting the shared provider quota |
| `admin_action` | administrative mutations |

## 7. Secrets

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | public by design, protected by RLS |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | publishable/anon key; the security boundary is RLS |
| `SUPABASE_SECRET_KEY` | server only | maintenance scripts; never set as `NEXT_PUBLIC_*` |
| `GIPHY_API_KEY` | server only | used by `/api/giphy/search` |
| `GIPHY_CONTENT_RATING` | server only | `g` / `pg` / `pg-13` / `r`, default `pg-13` |
| `CAMPUS_ALLOWED_EMAIL_DOMAINS` | server only | deployment default for the domain gate |

`.env.local` is git-ignored; `.env.example` contains placeholders only
(`YOUR_…`). `npm run check:env` fails if a secret-looking value appears in a
`NEXT_PUBLIC_*` variable or if `.env.local` is tracked by git.

## 8. Response headers

`next.config.mjs` sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and
`Permissions-Policy: camera=(), microphone=(), geolocation=()` on every path.

## 9. Pre-deployment checklist

```bash
npm run lint                 # no dead code, no raw HTML, no console.log
npm test                     # architecture guards + validation + authorization
npm run verify:db            # migrations apply, database suites pass
npm run audit:db             # RLS/policy/grant audit (54 assertions)
npm run build                # every route compiles
npm run check:env            # no secret in a NEXT_PUBLIC_* variable
npm run verify:security      # live probe: anonymous access denied everywhere
```

Manual checks the operator performs once per environment:

- [ ] Anonymous visitors cannot read `profiles`, `messages`, `profile_private`,
      `reports`, `audit_logs`, `random_sessions`, `notifications`.
- [ ] A suspended account is locked out of mutations (`/account-status`).
- [ ] Moderator sees the queue; a student opening `/moderator` gets the lock
      notice and no data.
- [ ] Admin actions appear in the audit log, including the actor.
- [ ] A blocked pair cannot message, mention or search each other.
- [ ] Random sessions are invisible to a third student, and staff access to
      identities is recorded.
- [ ] The browser bundle contains no secret (search the built output for
      `SUPABASE_SECRET_KEY`, `service_role`, `GIPHY_API_KEY`).

## 10. Reporting and handling

Moderation is human and audited: reports are triaged in `/moderator`, every action
writes an `audit_logs` row with actor, target, reason and visibility, and content
is soft-deleted so evidence survives. Reported Random sessions retain their
messages and participants for review; unreported sessions expire.
