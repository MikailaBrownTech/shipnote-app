-- Invite someone back after they deleted their account. Run it in the
-- Supabase dashboard SQL editor.
--
-- Deleted accounts are soft-deleted, so the old invite is still marked used and
-- still points at the deleted user. Both must be cleared on purpose. The person
-- then signs up as a NEW account: the old one stays deleted and is not restored.

update public.invites
set used_at = null, used_by = null
where email = 'person@example.com';
