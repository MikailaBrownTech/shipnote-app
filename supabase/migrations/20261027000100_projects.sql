-- Projects: a user's private notes that later sprints turn into post drafts.
--
-- Additive only. This creates new objects and touches nothing that the code on
-- main uses, so it can be applied before the branch is merged.
--
-- Rules every user-data table follows (see the README):
--   - references auth.users with on delete cascade
--   - row-level security enabled AND forced
--   - policies refuse a soft-deleted account
--   - no access for anon

-- True when the signed-in caller's account exists and is not soft-deleted
-- (Supabase's soft delete sets auth.users.deleted_at).
--
-- Policies run with the caller's privileges and the caller cannot read
-- auth.users, so this is security definer. It takes no arguments and only ever
-- looks at auth.uid(), so it cannot be used to ask about anyone else.
--
-- Why not reuse session_is_active()? That function needs a session id and is
-- callable only by the service role, so that clients cannot probe sessions. A
-- policy cannot call it. This one covers the soft-delete rule directly. A
-- revoked session is already refused by requireUser() in the app, and soft
-- delete removes the user's sessions as well.
create or replace function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.deleted_at is null
  );
$$;

revoke all on function public.is_active_account() from public, anon;
grant execute on function public.is_active_account() to authenticated, service_role;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  summary text,
  stage text not null,
  -- Capped so that later AI calls stay small. Counted in characters, not bytes.
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_name_length
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 80),
  constraint projects_summary_length
    check (summary is null or char_length(summary) <= 300),
  constraint projects_stage_valid
    check (stage in ('idea', 'in_progress', 'shipped')),
  constraint projects_notes_length
    check (char_length(notes) <= 12000)
);

-- Serves "my projects, newest first" and any query by user_id.
create index projects_user_id_idx
  on public.projects (user_id, updated_at desc);

-- Keeps updated_at current.
create or replace function public.projects_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.projects_set_updated_at();

-- At most 5 projects per user, enforced here so no code path can skip it.
-- The advisory lock makes two simultaneous inserts take turns, so both cannot
-- see "4" and both succeed. The error has its own SQLSTATE so the app can show
-- a specific message without matching on text.
create or replace function public.enforce_project_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('projects:' || new.user_id::text, 0));

  if (select count(*) from public.projects where user_id = new.user_id) >= 5 then
    raise exception 'project_limit_reached'
      using errcode = 'SN001',
            hint = 'A user can have at most 5 projects.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_project_limit() from public, anon, authenticated;

create trigger projects_enforce_limit
  before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- Row-level security, forced so it also applies to the table owner.
alter table public.projects enable row level security;
alter table public.projects force row level security;

-- Supabase grants new tables to the client roles by default. Start from
-- nothing: anon gets no access at all, and signed-in users get only what the
-- app does. user_id, id and the timestamps cannot be changed by an update.
revoke all on public.projects from public, anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (user_id, name, summary, stage, notes) on public.projects to authenticated;
grant update (name, summary, stage, notes) on public.projects to authenticated;

-- (select ...) lets Postgres evaluate each helper once per query, not per row.
create policy projects_select_own on public.projects
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy projects_update_own on public.projects
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy projects_delete_own on public.projects
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );
