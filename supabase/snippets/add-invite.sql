-- Add an invite. Run it in the Supabase dashboard SQL editor (or psql).
-- Emails are compared case-insensitively. Safe to run twice.

insert into public.invites (email)
values ('person@example.com')
on conflict (email) do nothing;

-- See who is invited and who has used an invite:
-- select email, created_at, used_at from public.invites order by created_at;
