# Shipnote

Shipnote turns a developer's project docs and `[post]`-tagged commits into LinkedIn post drafts. The user edits a draft and copies it. Shipnote never posts for them.

So far this repo has the landing page, invite-only sign-in (GitHub and email link), account controls and an empty dashboard. There are no projects, uploads, webhooks, queues or AI calls yet.

## Run it

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev                     # http://localhost:3000
```

Open the app at the same origin as `NEXT_PUBLIC_SITE_URL`. Auth redirects are built from that value, and cookies are per host.

## Check it

```bash
pnpm lint
pnpm typecheck   # runs `next typegen` first so route types exist
pnpm test        # unit tests and the SQL tests (see below)
pnpm build
pnpm format
```

## Environment variables

Names only. Put values in `.env.local` (gitignored). Never commit them.

**Public** (reach the browser; validated at startup, a bad one is named in the error without its value):

- `NEXT_PUBLIC_SITE_URL`: where the app is served, e.g. `http://localhost:3000`
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (`sb_publishable_...`, or anon)

**Server only** (never prefix these with `NEXT_PUBLIC_`; each group is checked where it is used):

- `SUPABASE_SERVICE_ROLE_KEY`: used in exactly one module, `src/server/supabase-admin.ts`. Needed for account deletion and for recording sign-in events.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: rate limiting. If both are unset, rate limiting is off (fine for local development). Setting only one is an error.
- `ALERTS_ENABLED`: `true` turns on new-device sign-in alert emails. Default off. While it is off nothing is recorded and nothing is sent.
- `RESEND_API_KEY`, `EMAIL_FROM`, `DEVICE_HASH_SALT`: required when `ALERTS_ENABLED=true`. If one is missing the server refuses to start and the error names it. `EMAIL_FROM` is read from the environment, never hardcoded (`alerts@your-domain` or `Shipnote <alerts@your-domain>`). `DEVICE_HASH_SALT` must be at least 16 random characters.

## Supabase checklist (set by hand)

Nothing below can be set from this repo. Until you do, invite-only sign-up is **not enforced end to end** (see "Not verified").

1. **Apply the migrations** in `supabase/migrations/` in order (`supabase db push`, or paste each file into the SQL editor). They create `public.invites`, `public.sign_in_events`, the hook function and `record_sign_in()`.
2. **Authentication > Hooks > Before User Created**: enable it, choose "Postgres function" and pick `public.hook_before_user_created`. The migration already grants execute to `supabase_auth_admin` only.
3. **Authentication > Providers > GitHub**: enable it with the client ID and secret from a GitHub OAuth app. In that GitHub app, set the callback URL to the one Supabase shows (`https://<project-ref>.supabase.co/auth/v1/callback`).
4. **Authentication > Providers > Email**: enable it. Check the email template: the link must be a plain sign-in link that is opened in the same browser that asked for it (PKCE).
5. **Authentication > URL Configuration**: Site URL is `NEXT_PUBLIC_SITE_URL`. Redirect URLs allow exactly `<NEXT_PUBLIC_SITE_URL>/auth/callback` (for local development, `http://localhost:3000/auth/callback`). No wildcard is needed: the "where to go next" value travels in a cookie the server sets, not in the URL.
6. **JWT expiry**: set it to **900 seconds (15 minutes)**. Sign out everywhere revokes refresh tokens, but an access token that was already issued stays valid until it expires, so the expiry is the longest a stolen token can keep working after a global sign-out. Shorter means a smaller window and a few more refreshes; 15 minutes is a reasonable balance.
7. **Refresh token rotation**: keep it on, and keep the reuse interval small.
8. **Email OTP expiry**: set it short, 10 minutes or less (the default is longer).
9. **JWT signing keys**: prefer an asymmetric key. `getClaims()` then verifies tokens locally; with a legacy symmetric secret it makes a network call on every check.
10. **Resend** (only for alerts): verify a sending domain you own, create an API key, set the variables above, then set `ALERTS_ENABLED=true`.

The dashboard labels above are from memory of the Supabase docs; I did not check them against a live project, so menu names may differ.

### Adding an invite

There is no admin UI. Run `supabase/snippets/add-invite.sql` in the SQL editor with the email filled in (emails are compared case-insensitively):

```sql
insert into public.invites (email) values ('person@example.com') on conflict (email) do nothing;
```

An invite works once. After someone uses it, the row stays (with `used_at` set) even if they later delete their account, so the same invite cannot be used again. The allowlist only gates **sign-up**: people who already have an account are never blocked by it.

## How sign-in is protected

- **Invite-only** is enforced by the Supabase _before user created_ hook (`public.hook_before_user_created`), which runs for GitHub and email-link sign-ups alike. It is not enforced only in the UI or callback. Every refusal returns the same message.
- **GitHub emails.** GitHub can return an email it has not verified. The hook allows a GitHub sign-up only when `event.user.user_metadata.email_verified` is the JSON boolean `true`, and no entry in `event.user.identities[].identity_data.email_verified` says otherwise. Missing, null, a string or anything else is refused. **This is best effort and unproven against real GitHub payloads.** The Supabase docs list the hook's payload fields but document no verified flag, so this field is my assumption about what Supabase copies from GitHub. The callback repeats the check (`src/lib/github-verified.ts`) as a backstop: if a GitHub sign-in cannot show a verified email it signs the person out, and deletes the account only if it was created in the last two minutes and has no other sign-in method.
- **Account linking.** Supabase links identities that share an email, so someone who signs in with GitHub and later with an email link ends up on one account. That is only safe when the email is verified. If an unverified email could link, an attacker could claim someone else's address at GitHub and take over their account. That is why the verified check above fails closed, and why an email-link account has no session until the link (which proves inbox ownership) is opened.
- **Invite-only message.** The sign-in page shows "Sign-up is invite only" when a sign-up is refused. That does tell someone an email is not invited, which the brief asked for; it never says whether an email _is_ invited.
- **Rate limiting** (Upstash, sliding window, always awaited): email links 5 per 15 minutes per IP and 3 per 15 minutes per email (hashed for the key); starting any sign-in 20 per 15 minutes per IP; account deletion 5 per 15 minutes per user. If Redis is slow, down or misconfigured the request is allowed and a count is logged without personal data; Supabase's own limits remain the backstop. The page never says which limit was hit.
- **Client IP** comes from `x-vercel-forwarded-for`, which Vercel sets itself and overwrites if a client sends it. No other header is trusted, so off Vercel (including local development) everyone shares one "unknown" bucket. Source: the Vercel request headers docs.
- **Sign-in alerts** (off by default): after a successful sign-in the callback records an event (IPv4 /24 or IPv6 /48 only, a browser family from a fixed list, a salted hash of the two) and, if the device is new, emails the user. The first sign-in never alerts, and only one alert goes out per user per hour (enforced in the database). It runs in Next's `after()`, so it never slows or blocks sign-in, and a failure is logged without personal data. The email has no token and no sign-in link; its one link is to `NEXT_PUBLIC_SITE_URL/dashboard`.

## Signing out and deleting an account

- **Sign out everywhere** (account menu on the dashboard, with a confirmation step) calls `signOut({ scope: 'global' })`, then clears this browser's cookies and goes to `/sign-in`. Global sign-out revokes refresh tokens; **an access token issued before it stays valid until it expires**, so keep the JWT expiry short (item 6 above).
- **Delete account** is at `/dashboard/account`. The person types their email, and must have signed in within the last 10 minutes; otherwise they see "Sign in again to delete your account" and are sent through sign-in and back. "Last sign-in" is read from the newest non-`token_refresh` entry of the `amr` claim, because `iat` changes on every refresh. **That is an inference from the docs and unproven against a real refreshed token.** If the claim is missing the user is treated as not recently signed in, so the failure is safe but annoying. Deletion uses the Supabase admin API, then signs out and goes to `/account-deleted`. The `invites` row is kept so the invite cannot be reused.
- The service role key is used in one module (`src/server/supabase-admin.ts`). An ESLint rule bans importing that module, `src/server/env.ts` or `src/server/env-schema.ts` from anywhere outside `src/server/`.

### TODO when adding tables

- [ ] Every table that holds user data must reference `auth.users (id) on delete cascade`, so deleting an account removes that data. `sign_in_events` already does. Add this check to every future migration review.

## SQL tests

`supabase/tests/` runs the migrations in [PGlite](https://pglite.dev) (real Postgres compiled to WASM, in-process) from `pnpm test`. It needs no Docker or Postgres install.

**The Supabase roles there are stubs.** `supabase/tests/supabase-stub.sql` creates `anon`, `authenticated`, `service_role` and `supabase_auth_admin`, a minimal `auth.users` and `auth.uid()`, and mimics Supabase's default grants. It proves the SQL does what it says, such as case-insensitive matching and `anon` being unable to read `invites`. It does not prove the hosted project is set up the same way.

## Layout

- `src/proxy.ts`: refreshes the session on each request and redirects `/dashboard` to `/sign-in` without one. Skips static files, `/api/webhooks` and `/api/queue`.
- `src/lib/auth.ts`: `getCurrentUser()` and `requireUser()`, server-only, verified with `getClaims()` (never `getSession()`). Every page and action that needs a user calls one itself.
- `src/lib/supabase/`: browser, server and proxy clients.
- `src/lib/safe-next.ts`: only lets same-origin paths through for post-sign-in redirects.
- `src/app/auth/callback/route.ts`: exchanges the one-time code for a session, runs the GitHub backstop, and schedules the sign-in record.
- `src/app/sign-in/actions.ts`: rate-limited sign-in server actions.
- `src/server/`: everything that uses a secret (service role, Redis, email). Pages and actions call `delete-account.ts`, `sign-in-limits.ts` and `sign-in-alert.ts`, not the lower-level modules.
- `supabase/migrations/`, `supabase/snippets/`, `supabase/tests/`: schema, helper SQL and SQL tests.

This project uses a recent Next.js with `cacheComponents` on. Anything reading cookies or `searchParams` must sit under `<Suspense>`. See `AGENTS.md`.

## Not verified without a real Supabase project

- That the _before user created_ hook runs for both GitHub and email-link sign-ups as documented, and what its payload really contains for GitHub (`user_metadata.email_verified`).
- That the hook may write (it sets `used_at`). The docs examples only read. If the hook cannot write, or if user creation fails after the hook succeeds, an invite could be marked used without an account. The fix would be to mark it from the `auth.users` insert trigger instead.
- That the hook's refusal message reaches the client unchanged. The sign-in page recognises "invite only" in it.
- That `amr` carries the original sign-in time through a token refresh.
- That `signOut({ scope: 'global' })` works from a server client the way the docs describe.
- Dashboard setting names and defaults listed in the checklist.
- That Resend accepts `EMAIL_FROM` until a domain is verified.
