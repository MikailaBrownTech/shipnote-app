-- Sign-in history, used to alert people to a sign-in from a new device.
--
-- Stored data is deliberately thin: a truncated IP (IPv4 /24 or IPv6 /48,
-- never the full address), a browser family from a fixed list, and a salted
-- hash of the two. Users can read their own rows. Nothing a client can reach
-- writes to the table; the server records events through record_sign_in(),
-- which only the service role may call.

create table public.sign_in_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  method text not null check (method in ('github', 'email')),
  ip_prefix text,
  user_agent_family text,
  device_hash text not null,
  -- Set on the event that triggered an alert. It is how "one alert per user
  -- per hour" is enforced, in the database where it cannot be raced.
  alerted_at timestamptz
);

create index sign_in_events_user_at_idx
  on public.sign_in_events (user_id, at desc);
create index sign_in_events_user_device_idx
  on public.sign_in_events (user_id, device_hash);

alter table public.sign_in_events enable row level security;

revoke all on table public.sign_in_events from anon, authenticated, public;
grant select on table public.sign_in_events to authenticated;

create policy "Users can read their own sign-in events"
  on public.sign_in_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Records one sign-in and says whether to send an alert. An alert is wanted
-- only when the user has signed in before, this device hash has never been
-- seen for them, and no alert went out in the last hour. Claiming the alert
-- here, before the email is sent, means a send failure is never retried into
-- a flood.
create or replace function public.record_sign_in(
  p_user_id uuid,
  p_method text,
  p_ip_prefix text,
  p_user_agent_family text,
  p_device_hash text,
  p_allow_alert boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_has_history boolean;
  v_known_device boolean;
  v_recent_alert boolean;
  v_alert boolean;
begin
  -- One sign-in at a time per user, so two at once cannot both alert.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select
    exists (select 1 from public.sign_in_events e
            where e.user_id = p_user_id),
    exists (select 1 from public.sign_in_events e
            where e.user_id = p_user_id and e.device_hash = p_device_hash),
    exists (select 1 from public.sign_in_events e
            where e.user_id = p_user_id
              and e.alerted_at > now() - interval '1 hour')
  into v_has_history, v_known_device, v_recent_alert;

  v_alert := p_allow_alert
    and v_has_history
    and not v_known_device
    and not v_recent_alert;

  insert into public.sign_in_events (
    user_id, method, ip_prefix, user_agent_family, device_hash, alerted_at
  )
  values (
    p_user_id, p_method, p_ip_prefix, p_user_agent_family, p_device_hash,
    case when v_alert then now() end
  )
  returning id into v_id;

  return jsonb_build_object('alert', v_alert, 'event_id', v_id);
end;
$$;

revoke all on function public.record_sign_in(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_sign_in(uuid, text, text, text, text, boolean)
  to service_role;
