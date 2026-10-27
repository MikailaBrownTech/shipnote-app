# Shipnote

Shipnote turns a developer's project docs and `[post]`-tagged commits into LinkedIn post drafts. The user edits a draft and copies it. Shipnote never posts for them.

So far this repo has the landing page, invite-only sign-in (GitHub and email link), account controls and projects (a private notes record per project, up to 5 per user). There are no GitHub connections, uploads, webhooks, queues or AI calls yet.

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
pnpm check:env   # lists missing env variable names, never values
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

## Deploying to Vercel

Add the variables in **Project Settings > Environment Variables**, for the Production environment (and Preview if you use it). Then **redeploy**: changed variables only apply to new deployments, and `NEXT_PUBLIC_*` values are baked in at build time, so the old build keeps the old (or missing) values.

| Variable                               | Public or server-only | Required                        | Where to find the value                                           |
| -------------------------------------- | --------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                 | Public                | Required                        | Your production URL, e.g. `https://shipnote.example`              |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public                | Required                        | Supabase project > Project Settings > API (Project URL)           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public                | Required                        | Supabase project > Project Settings > API (publishable key)       |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server-only           | Required                        | Supabase project > Project Settings > API (secret / service_role) |
| `UPSTASH_REDIS_REST_URL`               | Server-only           | Optional, set both or neither   | Upstash console > your database > REST API                        |
| `UPSTASH_REDIS_REST_TOKEN`             | Server-only           | Optional, set both or neither   | Upstash console > your database > REST API                        |
| `ALERTS_ENABLED`                       | Server-only           | Optional (default `false`)      | You choose: `true` or `false`                                     |
| `RESEND_API_KEY`                       | Server-only           | Only when `ALERTS_ENABLED=true` | Resend dashboard > API Keys                                       |
| `EMAIL_FROM`                           | Server-only           | Only when `ALERTS_ENABLED=true` | An address on a domain verified in the Resend dashboard           |
| `DEVICE_HASH_SALT`                     | Server-only           | Only when `ALERTS_ENABLED=true` | Generate it: `openssl rand -hex 32`                               |

Rules:

- `NEXT_PUBLIC_SITE_URL` must be the production **https** URL with **no trailing slash** (`https://shipnote.example`, not `https://shipnote.example/`). A trailing slash is stripped, but a `localhost` or `http` value on a production deployment makes sign-in redirects and cookies point at the wrong origin; the server logs a warning at startup if it sees that.
- Server-only variables must **never** start with `NEXT_PUBLIC_`. Anything with that prefix is sent to every visitor's browser. `pnpm check:env` flags a secret-looking name that has the prefix.
- **Upstash is optional but you want it in production.** Without it sign-in rate limiting is off, and the server logs one warning at startup (names only) saying so. Setting only one of the two is the same as setting neither.
- With `ALERTS_ENABLED=true`, a missing email variable stops the server from starting and the error names it.
- A missing **public** variable fails the build, naming the variable (never the value). A missing server variable does not break the build or unrelated pages such as the landing page; it is checked where it is first used.

Check a configuration without printing any value:

```bash
pnpm check:env                                      # checks the variables in your shell
node --env-file=.env.local scripts/check-env.mjs    # checks a local file
vercel env pull .env.vercel && node --env-file=.env.vercel scripts/check-env.mjs   # checks what Vercel holds (delete the file after)
```

## Supabase checklist (set by hand)

Nothing below can be set from this repo. Until you do, invite-only sign-up is **not enforced end to end** (see "Not verified").

1. **Apply the migrations** in `supabase/migrations/` in order (`supabase db push`, or paste each file into the SQL editor). They create `public.invites`, `public.sign_in_events`, the hook function, `record_sign_in()` and the session checks (`session_is_active()`, `active_session_count()`). The third migration replaces the hook function, so apply it even if you applied the first two earlier. The fourth, `20261027000100_projects.sql`, adds the projects table (see "Projects").
2. **Authentication > Hooks > Before User Created**: enable it, choose "Postgres function" and pick `public.hook_before_user_created`. The migration already grants execute to `supabase_auth_admin` only.
3. **Authentication > Providers > GitHub**: enable it with the client ID and secret from a GitHub OAuth app. In that GitHub app, set the callback URL to the one Supabase shows (`https://<project-ref>.supabase.co/auth/v1/callback`).
4. **Authentication > Providers > Email**: enable it. Check the email template: the link must be a plain sign-in link that is opened in the same browser that asked for it (PKCE).
5. **Authentication > URL Configuration**: Site URL is `NEXT_PUBLIC_SITE_URL`. Redirect URLs allow exactly `<NEXT_PUBLIC_SITE_URL>/auth/callback` (for local development, `http://localhost:3000/auth/callback`). No wildcard is needed: the "where to go next" value travels in a cookie the server sets, not in the URL.
6. **JWT expiry**: set it to **900 seconds (15 minutes)**. Sign out everywhere revokes refresh tokens, and an access token that was already issued stays valid until it expires. `requireUser()` now also checks the session server-side, so this only bounds what still trusts the token alone, such as the proxy's cheap check; it is still worth keeping short. Shorter means a smaller window and a few more refreshes; 15 minutes is a reasonable balance.
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

## Session cookies

Every auth cookie the app writes has explicit flags, set in one place (`src/lib/cookie-options.ts`):

| Flag       | Value                                       | Why                                                                                                        |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HttpOnly` | `true`                                      | Page scripts cannot read the session, so an injected script cannot steal it.                               |
| `Secure`   | `true` in production, `false` in `next dev` | Browsers refuse Secure cookies on plain http, so development over `http://localhost` needs it off.         |
| `SameSite` | `Lax`                                       | Sent on the redirect back from GitHub or the email link, not on cross-site sub-requests.                   |
| `Path`     | `/`                                         | The session is sent to every route. The "where next" cookie `sn_next` is the exception: path `/auth` only. |

"Production" means `NODE_ENV=production`, which is what `next build` and `next start` set, and what Vercel uses. A local `pnpm start` over http therefore sets Secure cookies; Chrome and Firefox accept those on `localhost`, Safari does not, so use `pnpm dev` there.

How the flags get onto every cookie:

- The Supabase server client is created with `cookieOptions`, the documented way to pass options in `@supabase/ssr`. The library merges them into every cookie it writes: the session, each numbered chunk of a large session (`sb-<ref>-auth-token.0`, `.1`, ...), the PKCE code verifier (`...-code-verifier`) and removals. Its own default is `HttpOnly=false`, which is why they are set explicitly.
- The `setAll` hook in the server client and in the proxy also applies the same flags on top of whatever the library passes, so they cannot be dropped.
- `clearAuthCookies()` (sign out, sign out everywhere, delete account, the callback's refusal path) expires each `sb-*` cookie with the same flags. The callback expires `sn_next` with the same flags it was set with.

There is no browser Supabase client. `src/lib/supabase/client.ts` was removed because nothing imported it: sign-in starts in a Server Action, the PKCE verifier is written and read on the server, and the callback exchanges the code on the server. If you ever add a browser client that reads the session, it cannot work with `HttpOnly` cookies; read the user from a server component or route instead, and do not turn `HttpOnly` off.

Sessions that exist from before this change keep the old flags (`HttpOnly=false`) until they are refreshed or signed out. A refresh rewrites them, so an active user moves over once their access token expires and is refreshed (about 15 minutes with the JWT expiry from the checklist). To force it, sign out and in again.

### Check the flags in the browser

1. Open the production site, sign in, and open dev tools (F12).
2. **Chrome or Edge:** Application > Storage > Cookies > your site. **Firefox:** Storage > Cookies. **Safari:** Storage > Cookies.
3. Find the cookies starting with `sb-` and ending `-auth-token` (and `-auth-token.0`, `.1` when the session is large). The table has `HttpOnly`, `Secure` and `SameSite` columns: expect a tick in the first two and `Lax` in the third. Path is `/`.
4. Prove HttpOnly: in the Console run `document.cookie`. No `sb-` cookie should be listed.
5. During sign-in the `...-code-verifier` cookie should show the same flags. It is removed after the callback.

## Signing out and deleting an account

- **Signed-in checks verify the session, not just the token.** `requireUser()` (and so every protected page and action) runs `getClaims()`, which verifies the token's signature and expiry locally, **and then** checks that the token's `session_id` still exists in `auth.sessions` and that the account is not deleted. That second check is the one Supabase documents for revoked sessions (`public.session_is_active`, service role only, fails closed). Without it a signed-out or deleted session would keep working until its access token expired. It costs one round trip per protected page or action. The proxy keeps the cheap `getClaims()` check and only refreshes cookies.
- **Sign out everywhere** (account menu on the dashboard, with a confirmation step) calls `signOut({ scope: 'global' })`, then clears this browser's cookies and goes to `/sign-in`. The order matters: `signOut()` reads the access token from the session cookie, so if the cookie were cleared first the library would send nothing and still report success. The library also treats a 401, 403 or 404 from the logout request as success, so the action then asks the database how many sessions are left (`public.active_session_count`) and shows "we could not sign you out everywhere" if any remain. With the session check above, other devices stop working on their next protected request; the JWT expiry (item 6) now only bounds the unprotected parts, such as the proxy's cookie refresh.
- **Delete account** is at `/dashboard/account`. The person types their email, and must have signed in within the last 10 minutes; otherwise they see "Sign in again to delete your account" and are sent through sign-in and back. "Last sign-in" is read from the newest non-`token_refresh` entry of the `amr` claim, because `iat` changes on every refresh. **That is an inference from the docs and unproven against a real refreshed token.** If the claim is missing the user is treated as not recently signed in, so the failure is safe but annoying. Deletion is a **soft delete** (see below), followed by a global sign-out, cleared cookies and the `/account-deleted` page.
- The service role key is used in one module (`src/server/supabase-admin.ts`). An ESLint rule bans importing that module, `src/server/env.ts` or `src/server/env-schema.ts` from anywhere outside `src/server/`.

### What soft delete does

Deleting an account calls the Supabase admin `deleteUser(id, true)`. The Supabase docs say only that the user is "soft-deleted"; what follows is from reading the open-source Auth server code (`SoftDeleteUser`, `SoftDeleteUserIdentities`, `adminUserDelete`), not from the docs, and has **not been run against a real project**:

- `auth.users.deleted_at` is set to now. Calling it again on a deleted user does nothing, so it is set once.
- The user's **sessions are removed**, which ends every session on every device. Passwords and one-time tokens are cleared, MFA factors and WebAuthn credentials are deleted.
- The **email and phone are replaced by a hash**, the identities' data is wiped and their `provider_id` is hashed, and `raw_user_meta_data` and `raw_app_meta_data` are emptied. So the old row can never be matched by the original email or GitHub account, and **nobody can sign in to it again**, by GitHub or email link.
- The row is **not reversible** and the original email is not kept in `auth.users`.
- The same email **can start a new sign-up**, because the old row no longer holds it. The invite hook then refuses it: the invite stays `used`, and the hook also refuses any invite whose `used_by` is a deleted user. To invite the person back on purpose, run `supabase/snippets/reinvite.sql`. They get a new account; the old one is not restored.

`requireUser()` treats a deleted account as signed out through `session_is_active`, which also checks `deleted_at`.

**Data is retained after deletion.** The user row and everything that references it stays until a purge. Later tables must hide or exclude rows belonging to deleted users (join `auth.users` and require `deleted_at is null`, or expose them only through views or policies that do). Never show a deleted user's data in the app.

- [ ] **Purge job (not built).** Hard-delete accounts 30 days after `deleted_at`: delete from `auth.users` where `deleted_at < now() - interval '30 days'` (through the admin API or a scheduled function), so `on delete cascade` removes their data. Until it exists, deleted accounts and their data are kept indefinitely.

### TODO when adding tables

- [ ] Every table that holds user data must reference `auth.users (id) on delete cascade`, so the purge job removes that data when it hard-deletes an account. `sign_in_events` already does. Add this check to every future migration review.
- [ ] Every table that holds user data must also be hidden from, or excluded for, users whose `auth.users.deleted_at` is set, because the data stays after a soft delete.

## Projects

A signed-in user can create, view, edit and delete their own projects at `/dashboard`, `/dashboard/projects/new`, `/dashboard/projects/<id>` and `/dashboard/projects/<id>/edit`. A project holds the notes that later sprints turn into LinkedIn drafts. There is no GitHub code, AI call, draft, upload or webhook yet.

**The table** (`supabase/migrations/20261027000100_projects.sql`): `public.projects` with `id`, `user_id` (references `auth.users` on delete cascade), `name` (1 to 80 characters), `summary` (optional, up to 300), `stage` (`idea`, `in_progress` or `shipped`), `notes` (up to 12,000 characters) and `created_at` / `updated_at` (a trigger keeps `updated_at` current).

- **5 projects per user.** A trigger refuses the 6th insert with its own error code (`SN001`, message `project_limit_reached`), so no code path can skip it. The app shows "You have reached the 5 project limit." An advisory lock makes two simultaneous inserts take turns, so a race cannot slip a 6th in. The limit also binds the service role.
- **12,000 characters of notes.** It keeps later AI calls small and cheap, and keeps a pasted README from becoming a dump of everything. It is a check constraint, counted in characters (not bytes, not UTF-16 units). The app's limits (`src/lib/project-schema.ts`) mirror the database ones, count line breaks as one character (a browser sends two), and refuse a NUL character, which Postgres cannot store.
- **Row-level security is enabled and forced.** Select, insert, update and delete policies for `authenticated` only match `user_id = auth.uid()`; insert and update also check it in `with check`, so nobody can assign a project to someone else. `anon` has no privileges at all. A signed-in user cannot change `id`, `user_id` or the timestamps (column-level grants).
- **Soft-deleted accounts see and change nothing.** Every policy also requires `public.is_active_account()`, a security-definer function that is true only when the caller's `auth.users.deleted_at` is null. `session_is_active()` was not reused because it needs a session id and is deliberately callable only by the service role; a policy cannot call it, and a function callable by users that took any user id would let them probe other people. The new function takes no arguments and looks only at `auth.uid()`.
- **Not found, never forbidden.** A project that is missing, malformed or someone else's gives the same not-found page. Next.js sends a real 404 status only when `notFound()` runs before streaming starts; these pages must read the session inside `<Suspense>`, so the response is `200` with the not-found page and a `noindex` tag (documented behaviour, and what the dev server did here).
- **Data access** goes through the Supabase server client with the signed-in user's session (`src/server/projects.ts`), so row-level security applies to every query. The service role key is not used for projects, and there is no raw SQL in app code. Every page and action also calls `requireUser()` itself and filters by the user's id, so row-level security is the backstop, not the only check.
- **Private data.** Project text is never logged, never put in errors, and never in the page title. The only thing logged on a failed query is a Postgres error code. Notes and names are rendered as plain text (a test fails if `dangerouslySetInnerHTML` appears anywhere in `src/`). Create and update are rate limited with the existing Upstash limiter (10 creates and 60 updates per 15 minutes per user; same fail-open behaviour).

### Migration to run before merging

Run `supabase/migrations/20261027000100_projects.sql` once in the Supabase **SQL Editor** for the shared project, right before merging. It is additive: it creates `public.projects`, three functions (`is_active_account`, `projects_set_updated_at`, `enforce_project_limit`), two triggers, an index and four policies. It changes nothing that `main` uses, so applying it early is harmless to the code on `main`. Apply the earlier migrations first if you have not; this one does not depend on them, but it assumes the Supabase `auth` schema and `auth.uid()`.

To confirm afterwards, in the SQL Editor: `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.projects'::regclass;` should show `t` and `t`, and `select policyname from pg_policies where tablename = 'projects';` should list four policies.

## Rules for every later table

Any table that holds user data follows these. Check them in every migration review.

1. **References `auth.users (id) on delete cascade`**, so the purge job removes the data when it hard-deletes an account. `sign_in_events` and `projects` do.
2. **Row-level security enabled and forced**, with policies that match `user_id = auth.uid()` for every operation that clients may do. Revoke everything from `anon` and `authenticated` first, then grant only what is needed.
3. **Excludes soft-deleted accounts.** Soft delete keeps the data, so every policy must also require `public.is_active_account()`.
4. **Additive migrations only** while production and previews share one Supabase project: new tables, functions and policies; nothing dropped or altered in a way the code on `main` would break on.

Soft-deleted users' projects are retained until the purge job (see "TODO when adding tables") hard-deletes the account, which cascades to them.

## SQL tests

`supabase/tests/` runs the migrations in [PGlite](https://pglite.dev) (real Postgres compiled to WASM, in-process) from `pnpm test`. It needs no Docker or Postgres install.

**The Supabase roles there are stubs.** `supabase/tests/supabase-stub.sql` creates `anon`, `authenticated`, `service_role` and `supabase_auth_admin`, a minimal `auth.users` and `auth.uid()`, and mimics Supabase's default grants. It proves the SQL does what it says, such as case-insensitive matching and `anon` being unable to read `invites`. It does not prove the hosted project is set up the same way.

## Layout

- `src/proxy.ts`: refreshes the session on each request and redirects `/dashboard` to `/sign-in` without one. Skips static files, `/api/webhooks` and `/api/queue`.
- `src/lib/auth.ts`: `getCurrentUser()` and `requireUser()`, server-only, verified with `getClaims()` (never `getSession()`). Every page and action that needs a user calls one itself.
- `src/lib/supabase/`: server and proxy clients (there is no browser client).
- `src/lib/safe-next.ts`: only lets same-origin paths through for post-sign-in redirects.
- `src/app/auth/callback/route.ts`: exchanges the one-time code for a session, runs the GitHub backstop, and schedules the sign-in record.
- `src/app/sign-in/actions.ts`: rate-limited sign-in server actions.
- `src/server/projects.ts`: project reads and writes through the signed-in user's Supabase client (no service role). `src/lib/project-schema.ts` holds the Zod schemas that mirror the database limits. `src/app/dashboard/projects/`: the screens and server actions.
- `src/server/`: everything that uses a secret (service role, Redis, email). Pages and actions call `delete-account.ts`, `sign-in-limits.ts` and `sign-in-alert.ts`, not the lower-level modules.
- `supabase/migrations/`, `supabase/snippets/`, `supabase/tests/`: schema, helper SQL and SQL tests.

This project uses a recent Next.js with `cacheComponents` on. Anything reading cookies or `searchParams` must sit under `<Suspense>`. See `AGENTS.md`.

## Not verified without a real Supabase project

- That the _before user created_ hook runs for both GitHub and email-link sign-ups as documented, and what its payload really contains for GitHub (`user_metadata.email_verified`).
- That the hook may write (it sets `used_at`). The docs examples only read. If the hook cannot write, or if user creation fails after the hook succeeds, an invite could be marked used without an account. The fix would be to mark it from the `auth.users` insert trigger instead.
- That the hook's refusal message reaches the client unchanged. The sign-in page recognises "invite only" in it.
- That `amr` carries the original sign-in time through a token refresh.
- That the session check really ends another browser's access: I have not seen it run. It rests on Supabase's documented rule that a token's `session_id` matches a row in `auth.sessions`, and on the `auth.sessions` columns I query (`id`, `user_id`, `not_after`) and `auth.users.deleted_at` existing as I assume.
- Why "sign out everywhere" did not end your second browser. I could not read your `auth.sessions` or `auth.refresh_tokens`, so I do not know whether the rows were removed. See the diagnosis queries below.
- What soft delete really does. The Supabase docs do not say; the list above comes from the Auth server source and has not been run.
- That the projects migration applies cleanly in the real SQL Editor, and that the policies behave as the PGlite tests show. The tests use stubbed roles and a stub `auth.users`; I have not run the migration against a Supabase project.
- That `auth.users.deleted_at` is set by the Admin API soft delete in your project, which `is_active_account()` and the policies rely on (see "What soft delete does").
- That PostgREST returns the trigger's SQLSTATE `SN001` in `error.code`, which the app uses to show the 5-project message. If it did not, the user would see the generic "could not save" message instead; the cap would still hold.
- That the create, edit and delete forms work end to end in a browser, including keeping what was typed after a validation error. The pages were rendered in tests and in a dev server with the session and data mocked; the forms were not submitted.
- That the live Supabase project writes its cookies with the flags above. The tests run the real `@supabase/ssr` client against a fake cookie store and a stubbed network, not your project, and I have not looked at the production site's cookies in dev tools.
- That `signOut({ scope: 'global' })` works from a server client the way the docs describe.
- Dashboard setting names and defaults listed in the checklist.
- That Resend accepts `EMAIL_FROM` until a domain is verified.

## Diagnosing "sign out everywhere did not end the other session"

Run these in the Supabase SQL editor around a test (two browsers, same user):

```sql
-- Before and after pressing "Sign out everywhere" in browser A.
select id, user_id, created_at, not_after, refreshed_at from auth.sessions
where user_id = '<user id>';

select id, session_id, revoked, created_at from auth.refresh_tokens
where user_id::uuid = '<user id>' order by created_at desc limit 10;
```

Rows gone from both means Supabase revoked correctly, and any browser that still worked was relying on its unexpired access token, which the session check now rejects. Rows still present means the logout request did not reach Supabase or was refused; the app now reports that case ("we could not sign you out everywhere") instead of staying quiet.
