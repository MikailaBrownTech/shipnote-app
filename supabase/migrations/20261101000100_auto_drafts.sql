-- Automatic drafts: a push with a [post] commit to a linked repository creates
-- a draft by itself, through the same pipeline and limits as the Generate
-- button.
--
-- Additive only: one new column on projects (default false), two new tables, a
-- trigger and functions. The code on main does not use any of it.
--
--   projects.auto_draft   the per-project switch, off by default. The owner can
--                         change it (and only it) like the other settings.
--   webhook_deliveries    GitHub delivery ids already seen, so a redelivery is
--                         not worked twice. No user can read or write it.
--   auto_draft_jobs       one row per (project, commit): queued, running, done,
--                         skipped or failed, with a fixed reason code. Users can
--                         read their own rows; every write goes through a narrow
--                         service-role function below.
--
-- The tables hold identifiers and fixed codes only. No commit message, payload,
-- signature, token or draft text is stored in either of them.

alter table public.projects
  add column auto_draft boolean not null default false;

-- The owner may flip the switch; nothing else about the grants changes.
grant update (auto_draft) on public.projects to authenticated;

-- Changing the linked repository turns the switch off, so automatic drafts never
-- carry over to a different repository without the person choosing again.
create or replace function public.projects_reset_auto_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.repo_full_name is distinct from old.repo_full_name
     and new.auto_draft is not distinct from old.auto_draft then
    new.auto_draft := false;
  end if;
  return new;
end;
$$;

create trigger projects_reset_auto_draft
  before update on public.projects
  for each row execute function public.projects_reset_auto_draft();

revoke all on function public.projects_reset_auto_draft()
  from public, anon, authenticated;

create table public.webhook_deliveries (
  delivery_id text primary key,
  received_at timestamptz not null default now(),
  installation_id bigint,
  status text not null default 'received',

  constraint webhook_deliveries_id_format
    check (delivery_id ~ '^[A-Za-z0-9-]{8,64}$'),
  constraint webhook_deliveries_status_valid
    check (status in ('received', 'processed'))
);

create index webhook_deliveries_received_idx
  on public.webhook_deliveries (received_at);

create table public.auto_draft_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  commit_sha text not null,
  delivery_id text,
  status text not null default 'queued',
  -- A fixed code such as daily_limit or commit_not_found, never text.
  reason text,
  draft_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint auto_draft_jobs_sha_format check (commit_sha ~ '^[0-9a-f]{40}$'),
  constraint auto_draft_jobs_status_valid
    check (status in ('queued', 'running', 'done', 'skipped', 'failed')),
  constraint auto_draft_jobs_reason_format
    check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  constraint auto_draft_jobs_delivery_format
    check (delivery_id is null or delivery_id ~ '^[A-Za-z0-9-]{8,64}$'),
  -- A job can only point at a project of the same user.
  constraint auto_draft_jobs_project_owner_fkey
    foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete cascade,
  -- And only at a draft of the same user. Deleting the draft keeps the job.
  constraint auto_draft_jobs_draft_owner_fkey
    foreign key (user_id, draft_id)
    references public.drafts (user_id, id)
    on delete set null (draft_id),
  -- One job per commit of a project, whatever the delivery.
  constraint auto_draft_jobs_one_per_commit unique (project_id, commit_sha)
);

create index auto_draft_jobs_project_idx
  on public.auto_draft_jobs (user_id, project_id, created_at desc);

create or replace function public.auto_draft_jobs_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger auto_draft_jobs_set_updated_at
  before update on public.auto_draft_jobs
  for each row execute function public.auto_draft_jobs_set_updated_at();

revoke all on function public.auto_draft_jobs_set_updated_at()
  from public, anon, authenticated;

alter table public.webhook_deliveries enable row level security;
alter table public.webhook_deliveries force row level security;
alter table public.auto_draft_jobs enable row level security;
alter table public.auto_draft_jobs force row level security;

-- Start from nothing. Deliveries: no access for any user role. Jobs: users read
-- their own and nothing else.
revoke all on public.webhook_deliveries, public.auto_draft_jobs
  from public, anon, authenticated;
grant select on public.auto_draft_jobs to authenticated;

create policy auto_draft_jobs_select_own on public.auto_draft_jobs
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

-- ---- Service-role functions ----

-- Records a GitHub delivery id. Returns:
--   'new'        first time seen
--   'duplicate'  seen and fully processed: do nothing
--   'retry'      seen but not finished (a crash, or a manual redelivery): work
--                it again; creating jobs is idempotent
create or replace function public.record_webhook_delivery(
  p_delivery_id text,
  p_installation_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_delivery_id is null or p_delivery_id !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'invalid_arguments' using errcode = 'SN032';
  end if;
  insert into public.webhook_deliveries (delivery_id, installation_id)
  values (p_delivery_id, p_installation_id)
  on conflict (delivery_id) do nothing;
  if found then
    return 'new';
  end if;
  select status into v_status
  from public.webhook_deliveries
  where delivery_id = p_delivery_id;
  return case when v_status = 'processed' then 'duplicate' else 'retry' end;
end;
$$;

create or replace function public.finish_webhook_delivery(p_delivery_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.webhook_deliveries
  set status = 'processed'
  where delivery_id = p_delivery_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Which user and project a push belongs to, found from the installation id (that
-- GitHub signed) and the repository name. Only a project that is linked through
-- that installation, with the switch on, of an account that is not deleted.
-- The user is taken from the installation row, never from the payload.
create or replace function public.resolve_auto_draft_target(
  p_installation_id bigint,
  p_repo_full_name text
)
returns table (user_id uuid, project_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.id
  from public.github_installations i
  join public.projects p
    on p.user_id = i.user_id
   and p.installation_id = i.installation_id
  where i.installation_id = p_installation_id
    and lower(p.repo_full_name) = lower(p_repo_full_name)
    and p.auto_draft
    and public.account_active(i.user_id);
$$;

-- Creates the job for a commit once. Returns the id of a new job, or null when
-- the commit already has one (or the project is not eligible). A job that
-- failed only because it could not be queued is put back to queued, so a manual
-- redelivery can publish it again.
create or replace function public.create_auto_draft_job(
  p_user_id uuid,
  p_project_id uuid,
  p_commit_sha text,
  p_delivery_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_project_id is null
     or p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_delivery_id is null or p_delivery_id !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'invalid_arguments' using errcode = 'SN032';
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = p_user_id
      and p.auto_draft and p.installation_id is not null
  ) or not public.account_active(p_user_id) then
    return null;
  end if;

  insert into public.auto_draft_jobs as j
    (user_id, project_id, commit_sha, delivery_id)
  values (p_user_id, p_project_id, p_commit_sha, p_delivery_id)
  on conflict (project_id, commit_sha) do update
    set status = 'queued', reason = null, delivery_id = excluded.delivery_id,
        started_at = null, finished_at = null
    where j.status = 'failed' and j.reason = 'queue_unavailable'
  returning j.id into v_id;
  return v_id;
end;
$$;

-- Claims a job: queued -> running, once, atomically. Returns the job id, or
-- nothing when it is not queued (already claimed, finished, unknown) or the
-- account is deleted (the job is then ended as skipped). A job left running for
-- more than ten minutes (a crashed worker) can be claimed again.
create or replace function public.claim_auto_draft_job(
  p_user_id uuid,
  p_project_id uuid,
  p_commit_sha text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.account_active(p_user_id) then
    update public.auto_draft_jobs
    set status = 'skipped', reason = 'account_inactive', finished_at = now()
    where user_id = p_user_id and project_id = p_project_id
      and commit_sha = p_commit_sha and status in ('queued', 'running');
    return null;
  end if;
  update public.auto_draft_jobs
  set status = 'running', started_at = now()
  where user_id = p_user_id and project_id = p_project_id
    and commit_sha = p_commit_sha
    and (
      status = 'queued'
      or (status = 'running' and started_at < now() - interval '10 minutes')
    )
  returning id into v_id;
  return v_id;
end;
$$;

-- running -> queued, so QStash's retry can claim the job again.
create or replace function public.release_auto_draft_job(
  p_job_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.auto_draft_jobs
  set status = 'queued', started_at = null
  where id = p_job_id and user_id = p_user_id and status = 'running';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Ends a job as done, skipped or failed, with a fixed reason code and, for done,
-- the draft. From running (the worker) or queued (the webhook, when it cannot
-- publish to the queue). A finished job cannot be changed.
create or replace function public.finish_auto_draft_job(
  p_job_id uuid,
  p_user_id uuid,
  p_status text,
  p_reason text,
  p_draft_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_status is null or p_status not in ('done', 'skipped', 'failed')
     or (p_reason is not null and p_reason !~ '^[a-z_]{1,40}$') then
    raise exception 'invalid_arguments' using errcode = 'SN032';
  end if;
  update public.auto_draft_jobs
  set status = p_status,
      reason = p_reason,
      draft_id = case when p_status = 'done' then p_draft_id end,
      finished_at = now()
  where id = p_job_id and user_id = p_user_id
    and status in ('queued', 'running');
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- The project's fields the worker needs to write a draft, for a project that
-- still belongs to the user, still has the switch on, is linked, and whose
-- account is not deleted. Nothing for anything else.
create or replace function public.read_project_for_auto_draft(
  p_user_id uuid,
  p_project_id uuid
)
returns table (
  name text,
  summary text,
  stage text,
  notes text,
  repo_full_name text,
  installation_id bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, p.summary, p.stage, p.notes, p.repo_full_name, p.installation_id
  from public.projects p
  where p.id = p_project_id
    and p.user_id = p_user_id
    and p.auto_draft
    and p.installation_id is not null
    and p.repo_full_name is not null
    and public.account_active(p_user_id);
$$;

-- Callable only by the service role.
revoke all on function public.record_webhook_delivery(text, bigint)
  from public, anon, authenticated;
revoke all on function public.finish_webhook_delivery(text)
  from public, anon, authenticated;
revoke all on function public.resolve_auto_draft_target(bigint, text)
  from public, anon, authenticated;
revoke all on function public.create_auto_draft_job(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_auto_draft_job(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.release_auto_draft_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_auto_draft_job(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.read_project_for_auto_draft(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.record_webhook_delivery(text, bigint) to service_role;
grant execute on function public.finish_webhook_delivery(text) to service_role;
grant execute on function public.resolve_auto_draft_target(bigint, text) to service_role;
grant execute on function public.create_auto_draft_job(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_auto_draft_job(uuid, uuid, text) to service_role;
grant execute on function public.release_auto_draft_job(uuid, uuid) to service_role;
grant execute on function public.finish_auto_draft_job(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.read_project_for_auto_draft(uuid, uuid) to service_role;
