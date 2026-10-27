-- Server-side session checks, and a stricter invite hook.
--
-- getClaims() verifies a token's signature and expiry locally, so it keeps
-- accepting an access token after its session was revoked (sign out
-- everywhere, account deletion) until the token expires. Supabase documents
-- the fix: every access token carries a session_id claim that matches a row in
-- auth.sessions, and if the row is gone the user has signed out.
--
-- Only the service role may call these. Clients cannot read auth.sessions.

-- True when the session still exists, belongs to the user, has not passed its
-- time-box, and the account is not deleted (soft delete sets auth.users
-- .deleted_at).
create or replace function public.session_is_active(
  p_session_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id = p_session_id
      and s.user_id = p_user_id
      and u.deleted_at is null
      and (s.not_after is null or s.not_after > now())
  );
$$;

-- How many sessions a user still has. Used after "sign out everywhere" to
-- confirm it worked, because the client library reports success even when the
-- logout request was refused with a 401, 403 or 404.
create or replace function public.active_session_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from auth.sessions where user_id = p_user_id;
$$;

revoke all on function public.session_is_active(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.active_session_count(uuid)
  from public, anon, authenticated;
grant execute on function public.session_is_active(uuid, uuid) to service_role;
grant execute on function public.active_session_count(uuid) to service_role;

-- The hook, again, with one more refusal: an invite whose user was deleted
-- stays refused even if used_at is cleared by mistake. To invite someone back
-- on purpose, clear used_by too (supabase/snippets/reinvite.sql).
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
    -- Fail closed: only an explicit JSON true counts. Best effort, unproven
    -- against real GitHub payloads (see the README).
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
    null;
  else
    return refusal;
  end if;

  -- Lock the row so two sign-ups with one invite cannot both pass. A bare =
  -- would compare case-sensitively under an empty search_path, so the citext
  -- operator is named in full.
  select i.id into v_invite
  from public.invites i
  where i.email operator(extensions.=) v_email
    and i.used_at is null
    and not exists (
      select 1 from auth.users u
      where u.id = i.used_by and u.deleted_at is not null
    )
  for update of i;

  if v_invite is null then
    return refusal;
  end if;

  update public.invites set used_at = now() where id = v_invite;

  return '{}'::jsonb;
end;
$$;
