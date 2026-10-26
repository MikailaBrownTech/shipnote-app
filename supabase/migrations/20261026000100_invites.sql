-- Invite-only sign-up.
--
-- public.invites is the allowlist. No client role can read or write it: RLS is
-- on with no policies, and every table privilege is revoked. Only the
-- security definer functions below touch it.

create extension if not exists citext with schema extensions;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

alter table public.invites enable row level security;

-- Supabase grants new public tables to anon and authenticated by default.
revoke all on table public.invites from anon, authenticated, public;

-- Before user created hook.
--
-- Supabase Auth calls this before it creates any user, whichever way they sign
-- up (GitHub or email link), so this is the enforcement point. It does not run
-- for people who already have an account, so existing users are not blocked.
--
-- Every refusal returns the same generic message: it never says whether an
-- email is invited.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  refusal constant jsonb := jsonb_build_object(
    'error',
    jsonb_build_object('message', 'Sign-up is invite only.', 'http_code', 403)
  );
  v_email extensions.citext;
  v_provider text;
  v_invite uuid;
begin
  v_email := nullif(btrim(event #>> '{user,email}'), '');
  v_provider := event #>> '{user,app_metadata,provider}';

  if v_email is null then
    return refusal;
  end if;

  if v_provider = 'github' then
    -- GitHub can return an email it has not verified. Fail closed: only an
    -- explicit JSON true counts. Missing, null, a string or any identity that
    -- says otherwise is a refusal. Best effort: unproven against real GitHub
    -- payloads (see the README).
    if jsonb_typeof(event #> '{user,user_metadata,email_verified}') is distinct from 'boolean'
       or (event #>> '{user,user_metadata,email_verified}') is distinct from 'true' then
      return refusal;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(event #> '{user,identities}') = 'array'
             then event #> '{user,identities}' else '[]'::jsonb end
      ) as identity
      where identity #> '{identity_data,email_verified}' is not null
        and (identity #>> '{identity_data,email_verified}') is distinct from 'true'
    ) then
      return refusal;
    end if;
  elsif v_provider = 'email' then
    -- Nothing to check here: the account has no session until the person opens
    -- the link, which proves they own the inbox.
    null;
  else
    -- Any other provider is refused until it is added on purpose.
    return refusal;
  end if;

  -- Lock the row so two sign-ups with one invite cannot both pass.
  select id into v_invite
  from public.invites
  -- With an empty search_path a bare = would not find citext's operator and
  -- would compare case-sensitively, so the operator is named in full.
  where email operator(extensions.=) v_email and used_at is null
  for update;

  if v_invite is null then
    return refusal;
  end if;

  update public.invites set used_at = now() where id = v_invite;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb)
  to supabase_auth_admin;

-- The hook runs before the user row exists, so it cannot set used_by (a
-- foreign key to auth.users). This fills it in once the user is created.
create or replace function public.invites_set_used_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invites
  set used_by = new.id
  where email operator(extensions.=) new.email::extensions.citext
    and used_at is not null
    and used_by is null;
  return new;
end;
$$;

revoke all on function public.invites_set_used_by()
  from public, anon, authenticated;

create trigger on_auth_user_created_set_invite_user
  after insert on auth.users
  for each row execute function public.invites_set_used_by();
