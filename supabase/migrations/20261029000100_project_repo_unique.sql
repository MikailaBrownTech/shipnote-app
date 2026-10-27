-- One user cannot link the same GitHub repository to two projects.
--
-- Additive: one new partial unique index. Nothing is altered or dropped, and
-- the code on main does not depend on it.
--
-- The comparison ignores case, because GitHub treats owner and repository
-- names as case-insensitive ("Octo/Hello" and "octo/hello" are the same repo).
-- Projects with no repository (repo_full_name is null) are not affected, so a
-- user can have any number of unlinked projects.
--
-- BEFORE running this, check that no user already has a duplicate (the earlier
-- GitHub work let a user link one repo to two projects). This must return no
-- rows, or the index cannot be created:
--
--   select user_id, lower(repo_full_name) as repo, count(*)
--   from public.projects
--   where repo_full_name is not null
--   group by 1, 2
--   having count(*) > 1;
--
-- If it returns rows, unlink the extra projects first (set repo_full_name and
-- installation_id to null on all but one of them).
create unique index projects_user_repo_unique
  on public.projects (user_id, lower(repo_full_name))
  where repo_full_name is not null;
