-- A minimal stand-in for the parts of Supabase the migrations rely on, so they
-- can run in plain Postgres (PGlite) in tests. The roles here are STUBS: they
-- mimic the names and the default grants, not the real platform. Passing here
-- does not prove the hosted project is configured correctly.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema extensions;
create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Just the columns the migrations read.
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  not_after timestamptz,
  created_at timestamptz not null default now()
);

-- Supabase's auth.uid() reads the verified JWT claims from a setting.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema auth to supabase_auth_admin, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase hands new public tables to the client roles by default. Mirroring
-- that makes the migrations' revokes mean something.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
