-- Drafts: LinkedIn post drafts generated for a project, the commits each one
-- used, and the usage ledger behind the daily and monthly limits.
--
-- Additive only. New tables and functions, plus one unique constraint on
-- public.projects (user_id, id), which the composite foreign key below needs.
-- The code on main does not use any of it.
--
-- The limits are enforced here, in Postgres. Redis (the app's rate limiter) is
-- only an extra brake and is never the authority.

-- A draft may only point at a project owned by the same user (same pattern as
-- projects -> github_installations). id is already unique, so this adds no real
-- restriction; it only gives the foreign key a target.
alter table public.projects
  add constraint projects_user_id_id_key unique (user_id, id);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  body text not null,
  status text not null default 'draft',
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_microusd bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  copied_at timestamptz,

  constraint drafts_body_length check (char_length(body) between 1 and 3000),
  constraint drafts_status_valid check (status in ('draft', 'copied')),
  constraint drafts_tokens_valid check (input_tokens >= 0 and output_tokens >= 0),
  constraint drafts_cost_valid check (cost_microusd >= 0),
  constraint drafts_project_owner_fkey
    foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete cascade,
  -- The target of the composite key from draft_commits.
  constraint drafts_user_id_id_key unique (user_id, id)
);

create index drafts_project_created_idx
  on public.drafts (user_id, project_id, created_at desc);

create or replace function public.drafts_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function public.drafts_set_updated_at();

-- The commits a draft was written from. "Covered" means linked to a draft whose
-- status is copied.
create table public.draft_commits (
  draft_id uuid not null,
  user_id uuid not null,
  commit_sha text not null,

  primary key (draft_id, commit_sha),
  constraint draft_commits_sha_format check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  constraint draft_commits_draft_owner_fkey
    foreign key (user_id, draft_id)
    references public.drafts (user_id, id)
    on delete cascade
);

create index draft_commits_user_sha_idx
  on public.draft_commits (user_id, commit_sha);

-- One row per generation attempt. No user can read or write it.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  month date not null,
  status text not null default 'reserved',
  reserved_microusd bigint not null default 0,
  cost_microusd bigint not null default 0,
  created_at timestamptz not null default now(),

  constraint ai_usage_status_valid
    check (status in ('reserved', 'completed', 'released')),
  constraint ai_usage_amounts_valid
    check (reserved_microusd >= 0 and cost_microusd >= 0)
);

create index ai_usage_user_day_idx on public.ai_usage (user_id, day);
create index ai_usage_month_idx on public.ai_usage (month, status);

-- Row-level security, enabled and forced on all three.
alter table public.drafts enable row level security;
alter table public.drafts force row level security;
alter table public.draft_commits enable row level security;
alter table public.draft_commits force row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

-- Start from nothing. Users may read and delete their drafts, change only the
-- text and the copy fields, and read their commit links. They cannot insert:
-- drafts and links are written only by complete_generation() below. ai_usage
-- has no access for users at all.
revoke all on public.drafts, public.draft_commits, public.ai_usage
  from public, anon, authenticated;
grant select, delete on public.drafts to authenticated;
grant update (body, status, copied_at) on public.drafts to authenticated;
grant select on public.draft_commits to authenticated;

-- Every policy also refuses a soft-deleted account, as for projects.
create policy drafts_select_own on public.drafts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy drafts_update_own on public.drafts
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy drafts_delete_own on public.drafts
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy draft_commits_select_own on public.draft_commits
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

-- A reservation still marked reserved after this long is treated as released,
-- so a crashed request cannot lock someone out.
create or replace function public.ai_reservation_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '5 minutes' $$;

-- Takes one generation slot, or refuses. Under a per-user advisory lock (and a
-- global one for the monthly total) so two requests cannot both take the last
-- slot. Refuses when the user already has p_daily_limit generations today (UTC),
-- or when completed spend plus outstanding reservations plus this estimate would
-- pass the monthly cap. Any other error also refuses: it fails closed.
--
-- Counted as used: completed generations and reservations that are still fresh.
-- Not counted: released ones, and stale reservations.
create or replace function public.reserve_generation(
  p_user_id uuid,
  p_estimated_microusd bigint,
  p_daily_limit integer,
  p_monthly_cap_microusd bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_fresh timestamptz := now() - public.ai_reservation_ttl();
  v_today integer;
  v_spent bigint;
  v_id uuid;
begin
  if p_user_id is null
     or p_estimated_microusd is null or p_estimated_microusd <= 0
     or p_daily_limit is null or p_daily_limit <= 0
     or p_monthly_cap_microusd is null or p_monthly_cap_microusd <= 0 then
    raise exception 'invalid_arguments' using errcode = 'SN012';
  end if;

  -- Always in this order, so two callers cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:global', 0));

  select count(*) into v_today
  from public.ai_usage
  where user_id = p_user_id
    and day = v_day
    and (status = 'completed' or (status = 'reserved' and created_at > v_fresh));
  if v_today >= p_daily_limit then
    raise exception 'daily_limit_reached' using errcode = 'SN010';
  end if;

  select coalesce(sum(
           case when status = 'completed' then cost_microusd else reserved_microusd end
         ), 0)
    into v_spent
  from public.ai_usage
  where month = v_month
    and (status = 'completed' or (status = 'reserved' and created_at > v_fresh));
  if v_spent + p_estimated_microusd > p_monthly_cap_microusd then
    raise exception 'monthly_cap_reached' using errcode = 'SN011';
  end if;

  insert into public.ai_usage (user_id, day, month, status, reserved_microusd)
  values (p_user_id, v_day, v_month, 'reserved', p_estimated_microusd)
  returning id into v_id;
  return v_id;
end;
$$;

-- Writes the draft, its commit links and the final cost in one transaction. If
-- anything fails, nothing is written and the reservation stays reserved.
create or replace function public.complete_generation(
  p_usage_id uuid,
  p_user_id uuid,
  p_project_id uuid,
  p_body text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_microusd bigint,
  p_commit_shas text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
begin
  perform 1
  from public.ai_usage
  where id = p_usage_id and user_id = p_user_id and status = 'reserved'
  for update;
  if not found then
    raise exception 'unknown_reservation' using errcode = 'SN013';
  end if;

  insert into public.drafts
    (user_id, project_id, body, model, input_tokens, output_tokens, cost_microusd)
  values
    (p_user_id, p_project_id, p_body, p_model, p_input_tokens, p_output_tokens, p_cost_microusd)
  returning id into v_draft_id;

  insert into public.draft_commits (draft_id, user_id, commit_sha)
  select v_draft_id, p_user_id, lower(sha)
  from (select distinct unnest(coalesce(p_commit_shas, '{}'::text[])) as sha) s;

  update public.ai_usage
     set status = 'completed', cost_microusd = p_cost_microusd
   where id = p_usage_id;

  return v_draft_id;
end;
$$;

-- The model answered, but the answer was not usable. The provider charged for
-- it, so it counts against the daily limit and the monthly spend.
create or replace function public.record_unusable_generation(
  p_usage_id uuid,
  p_user_id uuid,
  p_cost_microusd bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set status = 'completed', cost_microusd = greatest(p_cost_microusd, 0)
   where id = p_usage_id and user_id = p_user_id and status = 'reserved';
$$;

-- For provider or network errors only: the generation did not happen, so it
-- does not count.
create or replace function public.release_generation(
  p_usage_id uuid,
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set status = 'released'
   where id = p_usage_id and user_id = p_user_id and status = 'reserved';
$$;

-- How many generations the user has used today (UTC), for "N of 10 left".
create or replace function public.generations_used_today(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.ai_usage
  where user_id = p_user_id
    and day = (now() at time zone 'utc')::date
    and (status = 'completed'
         or (status = 'reserved' and created_at > now() - public.ai_reservation_ttl()));
$$;

-- Callable only by the service role.
revoke all on function public.ai_reservation_ttl() from public, anon, authenticated;
revoke all on function public.reserve_generation(uuid, bigint, integer, bigint)
  from public, anon, authenticated;
revoke all on function public.complete_generation(uuid, uuid, uuid, text, text, integer, integer, bigint, text[])
  from public, anon, authenticated;
revoke all on function public.record_unusable_generation(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.release_generation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.generations_used_today(uuid)
  from public, anon, authenticated;
grant execute on function public.ai_reservation_ttl() to service_role;
grant execute on function public.reserve_generation(uuid, bigint, integer, bigint) to service_role;
grant execute on function public.complete_generation(uuid, uuid, uuid, text, text, integer, integer, bigint, text[]) to service_role;
grant execute on function public.record_unusable_generation(uuid, uuid, bigint) to service_role;
grant execute on function public.release_generation(uuid, uuid) to service_role;
grant execute on function public.generations_used_today(uuid) to service_role;

-- Marks the caller's own draft as copied. Runs as the caller, so row-level
-- security decides whose draft it is (and refuses a soft-deleted account).
-- Returns false when there is no such draft of theirs.
create or replace function public.mark_draft_copied(p_draft_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_found boolean;
begin
  update public.drafts
     set status = 'copied', copied_at = coalesce(copied_at, now())
   where id = p_draft_id
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.mark_draft_copied(uuid) from public, anon;
grant execute on function public.mark_draft_copied(uuid) to authenticated;
