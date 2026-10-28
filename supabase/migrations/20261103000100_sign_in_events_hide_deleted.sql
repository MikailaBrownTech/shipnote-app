-- A soft-deleted account must not be able to read its own sign-in events.
--
-- Every other table that holds user data checks public.is_active_account() in its
-- policies, because soft delete keeps the data (see the README, "What soft delete
-- does"). sign_in_events was made before that rule and did not. The only way to
-- reach it was a still-valid access token of a deleted account, for its own rows,
-- but the rule is the rule.
--
-- Additive: no data and no column changes, and the code on main does not depend
-- on it. The new policy is created first and the old one dropped after, so reading
-- is never left without a policy. Needs public.is_active_account(), from the
-- projects migration.

create policy sign_in_events_select_own on public.sign_in_events
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

drop policy "Users can read their own sign-in events" on public.sign_in_events;
