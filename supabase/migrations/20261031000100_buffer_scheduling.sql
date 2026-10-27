-- Scheduling a draft on LinkedIn through the user's own Buffer account.
--
-- Additive only: new tables and functions. Nothing existing changes, and the
-- code on main does not use any of it.
--
--   buffer_connections  one row per user: that user's Buffer tokens, encrypted
--                       by the app before they get here. NO user role can read
--                       or write it, directly or through a view. Only the
--                       narrow service-role functions below touch it.
--   scheduled_posts     what the user confirmed to send to Buffer: the exact
--                       text, the channel and the time. Users can read their
--                       own rows. Writes go through service-role functions.
--
-- The token columns hold ciphertext only (AES-256-GCM, with the user id as
-- additional authenticated data). The database never sees a plain token.

-- Whether a user exists and is not soft-deleted. For the service-role
-- functions below, which have no auth.uid() to ask.
create or replace function public.account_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user_id and u.deleted_at is null
  );
$$;

create table public.buffer_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  -- Which encryption key sealed the tokens, so the key can be rotated.
  key_version integer not null,
  expires_at timestamptz,
  scopes text,
  -- The Buffer organization the channels are read from (an id, not a secret).
  organization_id text,
  status text not null default 'connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint buffer_connections_status_valid
    check (status in ('connected', 'needs_reconnect')),
  constraint buffer_connections_key_version_valid check (key_version >= 1)
);

create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Set to null if the draft is deleted: the schedule is a snapshot and must
  -- stay so it can still be cancelled.
  draft_id uuid,
  -- The project the draft belonged to, so the project page can list its
  -- schedules. Set to null if the project is deleted.
  project_id uuid,
  -- The exact text sent to Buffer, and its hash (what the user reviewed).
  body text not null,
  body_hash text not null,
  channel_id text not null,
  channel_label text,
  scheduled_for timestamptz not null,
  buffer_post_id text,
  status text not null,
  -- A short fixed code when a schedule failed, never text from Buffer.
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz,

  constraint scheduled_posts_body_length
    check (char_length(body) between 1 and 3000),
  constraint scheduled_posts_status_valid
    check (status in ('scheduling', 'scheduled', 'canceled', 'failed', 'published')),
  constraint scheduled_posts_hash_format check (body_hash ~ '^[0-9a-f]{64}$'),
  constraint scheduled_posts_channel_length
    check (char_length(channel_id) between 1 and 200),
  constraint scheduled_posts_draft_owner_fkey
    foreign key (user_id, draft_id)
    references public.drafts (user_id, id)
    on delete set null (draft_id),
  constraint scheduled_posts_project_owner_fkey
    foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete set null (project_id)
);

-- One draft has at most one active schedule, even under concurrent requests.
create unique index scheduled_posts_one_active_per_draft
  on public.scheduled_posts (draft_id)
  where draft_id is not null and status in ('scheduling', 'scheduled');

create index scheduled_posts_project_idx
  on public.scheduled_posts (user_id, project_id, created_at desc);

create index scheduled_posts_user_created_idx
  on public.scheduled_posts (user_id, created_at desc);

create or replace function public.buffer_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger buffer_connections_set_updated_at
  before update on public.buffer_connections
  for each row execute function public.buffer_set_updated_at();
create trigger scheduled_posts_set_updated_at
  before update on public.scheduled_posts
  for each row execute function public.buffer_set_updated_at();

alter table public.buffer_connections enable row level security;
alter table public.buffer_connections force row level security;
alter table public.scheduled_posts enable row level security;
alter table public.scheduled_posts force row level security;

-- Start from nothing. buffer_connections gets no grant and no policy for any
-- user role. scheduled_posts: users may read their own rows and nothing else.
revoke all on public.buffer_connections, public.scheduled_posts
  from public, anon, authenticated;
grant select on public.scheduled_posts to authenticated;

create policy scheduled_posts_select_own on public.scheduled_posts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

-- What the caller may know about their own connection: whether there is one,
-- its state and when it was made. Never a token column. Runs with the owner's
-- rights but only ever looks at auth.uid().
create or replace function public.buffer_connection_status()
returns table (status text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.status, c.created_at
  from public.buffer_connections c
  where c.user_id = auth.uid()
    and (select public.is_active_account());
$$;

-- ---- Service-role functions ----

-- Creates or replaces the user's connection. Refuses a soft-deleted account.
create or replace function public.save_buffer_connection(
  p_user_id uuid,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_key_version integer,
  p_expires_at timestamptz,
  p_scopes text,
  p_organization_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null
     or p_access_token_enc is null or p_access_token_enc = ''
     or p_key_version is null or p_key_version < 1 then
    raise exception 'invalid_arguments' using errcode = 'SN022';
  end if;
  if not public.account_active(p_user_id) then
    raise exception 'inactive_account' using errcode = 'SN024';
  end if;

  insert into public.buffer_connections as c (
    user_id, access_token_enc, refresh_token_enc, key_version,
    expires_at, scopes, organization_id, status
  )
  values (
    p_user_id, p_access_token_enc, p_refresh_token_enc, p_key_version,
    p_expires_at, p_scopes, p_organization_id, 'connected'
  )
  on conflict (user_id) do update set
    access_token_enc = excluded.access_token_enc,
    refresh_token_enc = excluded.refresh_token_enc,
    key_version = excluded.key_version,
    expires_at = excluded.expires_at,
    scopes = excluded.scopes,
    organization_id = excluded.organization_id,
    status = 'connected'
  returning c.id into v_id;
  return v_id;
end;
$$;

-- The user's connection, tokens included (still ciphertext). Nothing for a
-- soft-deleted account, so a deleted user's token cannot be read back.
create or replace function public.read_buffer_connection(p_user_id uuid)
returns table (
  access_token_enc text,
  refresh_token_enc text,
  key_version integer,
  expires_at timestamptz,
  scopes text,
  organization_id text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.access_token_enc, c.refresh_token_enc, c.key_version,
         c.expires_at, c.scopes, c.organization_id, c.status
  from public.buffer_connections c
  where c.user_id = p_user_id
    and public.account_active(p_user_id);
$$;

-- After a refresh: replaces the tokens and the expiry for this user only.
create or replace function public.update_buffer_tokens(
  p_user_id uuid,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_key_version integer,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_user_id is null
     or p_access_token_enc is null or p_access_token_enc = ''
     or p_key_version is null or p_key_version < 1 then
    raise exception 'invalid_arguments' using errcode = 'SN022';
  end if;
  update public.buffer_connections
  set access_token_enc = p_access_token_enc,
      refresh_token_enc = p_refresh_token_enc,
      key_version = p_key_version,
      expires_at = p_expires_at,
      status = 'connected'
  where user_id = p_user_id
    and public.account_active(p_user_id);
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.mark_buffer_needs_reconnect(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.buffer_connections
  set status = 'needs_reconnect'
  where user_id = p_user_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Removes the user's tokens. Works for any account, deleted or not.
create or replace function public.delete_buffer_connection(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.buffer_connections where user_id = p_user_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Takes the "scheduling" row before Buffer is called. Under a per-user lock:
--   SN020  already p_daily_limit schedules created today (UTC)
--   SN021  this draft already has an active schedule
--   SN022  invalid arguments (text length, hash, time out of range)
--   SN023  no such draft of this user's
--   SN024  the account is soft-deleted
-- The time must be in the future and no more than 31 days ahead; the app
-- enforces the tighter 10 minutes to 30 days.
create or replace function public.create_scheduled_post(
  p_user_id uuid,
  p_draft_id uuid,
  p_body text,
  p_body_hash text,
  p_channel_id text,
  p_channel_label text,
  p_scheduled_for timestamptz,
  p_daily_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_today integer;
  v_project uuid;
  v_id uuid;
begin
  if p_user_id is null or p_draft_id is null
     or p_body is null or char_length(p_body) not between 1 and 3000
     or p_body_hash is null or p_body_hash !~ '^[0-9a-f]{64}$'
     or p_channel_id is null or char_length(p_channel_id) not between 1 and 200
     or p_scheduled_for is null
     or p_scheduled_for <= now()
     or p_scheduled_for > now() + interval '31 days'
     or p_daily_limit is null or p_daily_limit <= 0 then
    raise exception 'invalid_arguments' using errcode = 'SN022';
  end if;
  if not public.account_active(p_user_id) then
    raise exception 'inactive_account' using errcode = 'SN024';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scheduled_posts:user:' || p_user_id::text, 0));

  select d.project_id into v_project
  from public.drafts d
  where d.id = p_draft_id and d.user_id = p_user_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'SN023';
  end if;

  select count(*) into v_today
  from public.scheduled_posts
  where user_id = p_user_id
    and (created_at at time zone 'utc')::date = v_day;
  if v_today >= p_daily_limit then
    raise exception 'daily_limit' using errcode = 'SN020';
  end if;

  if exists (
    select 1 from public.scheduled_posts
    where draft_id = p_draft_id and status in ('scheduling', 'scheduled')
  ) then
    raise exception 'already_scheduled' using errcode = 'SN021';
  end if;

  insert into public.scheduled_posts (
    user_id, draft_id, project_id, body, body_hash, channel_id, channel_label,
    scheduled_for, status
  )
  values (
    p_user_id, p_draft_id, v_project, p_body, p_body_hash, p_channel_id,
    p_channel_label, p_scheduled_for, 'scheduling'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- scheduling -> scheduled, once Buffer has accepted the post.
create or replace function public.mark_post_scheduled(
  p_id uuid,
  p_user_id uuid,
  p_buffer_post_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_buffer_post_id is null or p_buffer_post_id = '' then
    raise exception 'invalid_arguments' using errcode = 'SN022';
  end if;
  update public.scheduled_posts
  set status = 'scheduled', buffer_post_id = p_buffer_post_id
  where id = p_id and user_id = p_user_id and status = 'scheduling';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Ends a schedule as canceled, failed or published. Only an active schedule
-- can end ('scheduling' or 'scheduled'), and 'published' only from 'scheduled'.
-- Works for a soft-deleted account too, so cleanup on deletion can run.
create or replace function public.finish_scheduled_post(
  p_id uuid,
  p_user_id uuid,
  p_status text,
  p_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_status is null or p_status not in ('canceled', 'failed', 'published') then
    raise exception 'invalid_arguments' using errcode = 'SN022';
  end if;
  update public.scheduled_posts
  set status = p_status,
      failure_code = case when p_status = 'failed' then left(p_failure_code, 40) end,
      canceled_at = case when p_status = 'canceled' then now() else canceled_at end
  where id = p_id and user_id = p_user_id
    and (
      status = 'scheduling' and p_status in ('canceled', 'failed')
      or status = 'scheduled'
    );
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Callable only by the service role (and the status function by signed-in
-- users, for themselves).
revoke all on function public.account_active(uuid) from public, anon, authenticated;
revoke all on function public.buffer_connection_status() from public, anon;
revoke all on function public.save_buffer_connection(uuid, text, text, integer, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.read_buffer_connection(uuid) from public, anon, authenticated;
revoke all on function public.update_buffer_tokens(uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_buffer_needs_reconnect(uuid) from public, anon, authenticated;
revoke all on function public.delete_buffer_connection(uuid) from public, anon, authenticated;
revoke all on function public.create_scheduled_post(uuid, uuid, text, text, text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.mark_post_scheduled(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_scheduled_post(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.buffer_set_updated_at() from public, anon, authenticated;

grant execute on function public.account_active(uuid) to service_role;
grant execute on function public.buffer_connection_status() to authenticated;
grant execute on function public.save_buffer_connection(uuid, text, text, integer, timestamptz, text, text) to service_role;
grant execute on function public.read_buffer_connection(uuid) to service_role;
grant execute on function public.update_buffer_tokens(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.mark_buffer_needs_reconnect(uuid) to service_role;
grant execute on function public.delete_buffer_connection(uuid) to service_role;
grant execute on function public.create_scheduled_post(uuid, uuid, text, text, text, text, timestamptz, integer) to service_role;
grant execute on function public.mark_post_scheduled(uuid, uuid, text) to service_role;
grant execute on function public.finish_scheduled_post(uuid, uuid, text, text) to service_role;
