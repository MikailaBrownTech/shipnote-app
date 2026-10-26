# Shipnote

Shipnote turns a developer's project docs and `[post]`-tagged commits into LinkedIn post drafts. The user edits a draft and copies it. Shipnote never posts for them.

This is sprint 1: landing page, Supabase auth, and an empty dashboard. There is no database schema, project handling or AI call yet.

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
pnpm test
pnpm build
pnpm format
```

## Environment variables

All three are public (they reach the browser) and are validated at startup. A missing or malformed one fails fast and is named in the error, without printing its value.

| Name                                   | Value                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                 | Where the app is served, e.g. `http://localhost:3000`    |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_...`, or anon) |

`.env.local` is gitignored. Never commit real values.

## Supabase settings to configure by hand

In the Supabase dashboard for your project:

1. **Authentication > URL Configuration**
   - Site URL: the same value as `NEXT_PUBLIC_SITE_URL`.
   - Redirect URLs: add `<NEXT_PUBLIC_SITE_URL>/auth/callback` (for local development, `http://localhost:3000/auth/callback`).
2. **Authentication > Providers > GitHub**: enable it with the client ID and secret from a GitHub OAuth app. In that GitHub app, set the callback URL to the one Supabase shows on the provider page (`https://<project-ref>.supabase.co/auth/v1/callback`).
3. **Authentication > Providers > Email**: enable it. Magic links use the default email template; the link must be opened in the same browser that requested it (PKCE).
4. **JWT signing keys**: prefer an asymmetric key. `getClaims()` then verifies tokens locally. With a legacy symmetric secret it makes a network call to Supabase on every check.

## Layout

- `src/proxy.ts`: refreshes the session on each request and redirects `/dashboard` to `/sign-in` without one. Skips static files, `/api/webhooks` and `/api/queue`.
- `src/lib/auth.ts`: `getCurrentUser()` and `requireUser()`, server-only, verified with `getClaims()`. Every page that needs a user calls one itself.
- `src/lib/supabase/`: browser, server and proxy clients.
- `src/lib/safe-next.ts`: only lets same-origin paths through for post-sign-in redirects.
- `src/app/auth/callback/route.ts`: exchanges the one-time code for a session.

This project uses a recent Next.js with `cacheComponents` on. Anything reading cookies or `searchParams` must sit under `<Suspense>`. See `AGENTS.md`.
