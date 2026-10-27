-- GitHub connection: which GitHub App installations belong to which user, and
-- which repository a project is linked to.
--
-- Additive only. It creates one new table and adds two nullable columns, a
-- constraint and a foreign key to public.projects. The code on main does not
-- read or write the new columns (it selects projects by explicit column list),
-- so this can be applied before the branch is merged.
--
-- No commits, diffs or file contents are stored anywhere. Commits are fetched
-- from GitHub on demand.

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null unique,
  account_login text not null,
  account_id bigint not null,
  created_at timestamptz not null default now(),

  constraint github_installations_login_length
    check (char_length(account_login) between 1 and 100),
  -- The target of the composite foreign key from projects. Together with the
  -- key above it means: an installation id belongs to exactly one user, and a
  -- project can only point at an installation that belongs to the same user.
  constraint github_installations_user_installation_key
    unique (user_id, installation_id)
);

create index github_installations_user_id_idx
  on public.github_installations (user_id);

alter table public.github_installations enable row level security;
alter table public.github_installations force row level security;

-- Users may read their own rows and nothing else. There are no insert, update
-- or delete policies and no such privileges: rows are written only by server
-- code after it has verified, with GitHub, that the user owns the installation
-- (through the narrow functions in src/server/supabase-admin.ts, which use the
-- service role).
revoke all on public.github_installations from public, anon, authenticated;
grant select on public.github_installations to authenticated;

create policy github_installations_select_own on public.github_installations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

-- Projects: the linked repository, and the installation it is reached through.
--
-- Both columns are written only by server code (the earlier migration grants
-- authenticated users insert and update on named columns only, and these are
-- not among them), after the server has checked the repository is on the
-- installation's list.
--
-- A project with a repo_full_name and no installation_id means "needs
-- reconnect": the installation was removed or disconnected, and the link was
-- kept so the person can pick it up again.
alter table public.projects
  add column installation_id bigint,
  add column repo_full_name text;

alter table public.projects
  add constraint projects_repo_full_name_format
    check (
      repo_full_name is null
      or (
        repo_full_name ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'
        and repo_full_name !~ '/\.{1,2}$'
      )
    ),
  add constraint projects_installation_needs_repo
    check (installation_id is null or repo_full_name is not null);

-- A project can only reference an installation owned by the same user. With
-- the default MATCH SIMPLE, a null installation_id skips the check, which is
-- how an unlinked or "needs reconnect" project is allowed. If the installation
-- row is deleted, only installation_id is cleared (user_id is NOT NULL and
-- must stay); repo_full_name is kept.
alter table public.projects
  add constraint projects_installation_owner_fkey
    foreign key (user_id, installation_id)
    references public.github_installations (user_id, installation_id)
    on delete set null (installation_id);
