-- Voice profiles: how a user wants their LinkedIn drafts to sound. One row per
-- user: a tone from a fixed list, optional notes, up to three of their own past
-- posts as style references, words to avoid, and a sign-off.
--
-- Additive only: one new table, one helper function and one narrow read function.
-- Nothing existing is changed, so the code on main does not use any of it.
--
-- Every limit is enforced here as well as in the app, so a client that talks to
-- the database directly cannot store more than the app would. Row-level security
-- is enabled and forced. A user can read and change only their own row, and not
-- while the account is soft deleted. anon has nothing.

-- True when `items` is a one-dimensional list of at most `max_items` non-null
-- texts, each between 1 and `max_chars` characters. A CHECK cannot contain a
-- subquery, so the per-item rule lives in this immutable function.
create or replace function public.voice_list_valid(
  items text[],
  max_items integer,
  max_chars integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select items is not null
    and coalesce(array_ndims(items), 1) = 1
    and cardinality(items) <= max_items
    and not exists (
      select 1
      from unnest(items) as item(value)
      where item.value is null
         or char_length(item.value) not between 1 and max_chars
    );
$$;

create table public.voice_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tone text not null default 'professional',
  voice_notes text not null default '',
  sample_posts text[] not null default '{}',
  avoid_words text[] not null default '{}',
  signoff text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint voice_profiles_tone_valid check (
    tone in (
      'professional', 'academic', 'casual', 'friendly',
      'direct', 'storyteller', 'humble'
    )
  ),
  constraint voice_profiles_notes_length
    check (char_length(voice_notes) <= 500),
  constraint voice_profiles_samples_valid
    check (public.voice_list_valid(sample_posts, 3, 1500)),
  constraint voice_profiles_avoid_valid
    check (public.voice_list_valid(avoid_words, 15, 30)),
  constraint voice_profiles_signoff_length
    check (char_length(signoff) <= 80),
  -- Plain text on one line: no control characters, no line breaks.
  constraint voice_profiles_signoff_plain
    check (signoff !~ '[[:cntrl:]]')
);

create or replace function public.voice_profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger voice_profiles_set_updated_at
  before update on public.voice_profiles
  for each row execute function public.voice_profiles_set_updated_at();

alter table public.voice_profiles enable row level security;
alter table public.voice_profiles force row level security;

-- Start from nothing, then give a signed-in user their own row only. The user id
-- cannot be changed after the row exists.
revoke all on public.voice_profiles from public, anon, authenticated;
grant select, delete on public.voice_profiles to authenticated;
grant insert (user_id, tone, voice_notes, sample_posts, avoid_words, signoff)
  on public.voice_profiles to authenticated;
grant update (tone, voice_notes, sample_posts, avoid_words, signoff)
  on public.voice_profiles to authenticated;

create policy voice_profiles_select_own on public.voice_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy voice_profiles_insert_own on public.voice_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy voice_profiles_update_own on public.voice_profiles
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

create policy voice_profiles_delete_own on public.voice_profiles
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_account())
  );

-- For the automatic draft worker, which has no session. Returns the profile of
-- the one user it is given, and nothing for a soft-deleted account. Service role
-- only.
create or replace function public.read_voice_profile(p_user_id uuid)
returns table (
  tone text,
  voice_notes text,
  sample_posts text[],
  avoid_words text[],
  signoff text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.tone, v.voice_notes, v.sample_posts, v.avoid_words, v.signoff
  from public.voice_profiles v
  where v.user_id = p_user_id
    and p_user_id is not null
    and public.account_active(p_user_id);
$$;

revoke all on function public.voice_list_valid(text[], integer, integer)
  from public, anon;
grant execute on function public.voice_list_valid(text[], integer, integer)
  to authenticated, service_role;
revoke all on function public.read_voice_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.read_voice_profile(uuid) to service_role;
