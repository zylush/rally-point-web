-- Club owner invites: the platform superadmin names a club's owner by email, and
-- the owner becomes the club's admin once they sign up with that email and
-- confirm it. Until now the owner had to sign up first (as a member of Rally
-- Point Gensan) before the superadmin could add them as admin.
--
--   * platform_invite_club_owner(club, email): if a confirmed account already
--     uses the email, it becomes the club's admin at once (as
--     platform_assign_club_admin does). Otherwise an invite is recorded.
--   * claim_my_owner_clubs(): the app calls it while signing someone in. It
--     takes up open invites for the caller's email, but only when that email is
--     confirmed and the account was created after the invite. The second rule
--     guards against someone who registered the owner's email before the invite.
--     We believe, but have not verified, that the auth service keeps the first
--     password of an unconfirmed account when the same email signs up again; if
--     so, that earlier registrant would share the account the owner confirms.
--     Such an invite stays open, and the superadmin adds the owner by hand after
--     checking with them. The rule does not help when someone registers the
--     owner's email after the invite but before the owner does, so check the
--     auth service's behaviour before this is released.
--     It then lists the clubs the caller owns this way, so the app can tell an
--     owner that their club is still being set up.
--   * handle_new_user: a sign-up without a club link, whose email has an open
--     invite, no longer gets the free Rally Point Gensan membership. Nothing
--     else about sign-up changes. No trigger is added to auth.users.
--
-- Invites hold no role and no secret; the admin role still comes only from
-- club_staff_roles. Superadmins work only through the audited platform_*
-- functions, and the table has no direct API access.
--
-- With email confirmation turned off (as in the local config.toml), every new
-- account counts as confirmed, so anyone signing up with an invited email would
-- become that club's admin. Hosted projects must keep confirmation on before
-- this is released.
--
-- Nothing inside the reservation-write pause changes. A hosted apply needs its
-- own approved release.

do $$
begin
  if to_regprocedure('private.require_platform_superadmin()') is null
     or to_regprocedure('private.platform_audit(text, uuid, jsonb)') is null
     or to_regprocedure('public.handle_new_user()') is null
     or to_regclass('public.club_staff_roles') is null then
    raise exception 'Club owner invites need the club platform migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.club_owner_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  email text not null constraint club_owner_invites_email_check check (
    char_length(email) <= 254 and email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  constraint club_owner_invites_state_check check (claimed_at is null or cancelled_at is null),
  constraint club_owner_invites_claim_check check (claimed_by is null or claimed_at is not null)
);
-- One open invite per club and email.
create unique index club_owner_invites_open_key on public.club_owner_invites (club_id, email)
  where claimed_at is null and cancelled_at is null;
create index club_owner_invites_open_email_idx on public.club_owner_invites (email)
  where claimed_at is null and cancelled_at is null;
create index club_owner_invites_club_idx on public.club_owner_invites (club_id);
create index club_owner_invites_invited_by_idx on public.club_owner_invites (invited_by);
create index club_owner_invites_claimed_by_idx on public.club_owner_invites (claimed_by);

-- ---------------------------------------------------------------------------
-- Platform: invite, list and cancel (superadmin only, audited)
-- ---------------------------------------------------------------------------

create or replace function public.platform_invite_club_owner(p_club_id uuid, p_email text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  v_invite uuid;
begin
  perform private.require_platform_superadmin();
  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'Club not found' using errcode = 'P0002';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter an email like name@example.com' using errcode = '22023';
  end if;

  -- A confirmed account already uses the email: make it the admin now.
  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email
    and u.deleted_at is null
    and coalesce(u.is_sso_user, false) = false
    and u.email_confirmed_at is not null
    and exists (select 1 from public.profiles p where p.id = u.id)
  limit 1;
  if v_user is not null then
    insert into public.club_staff_roles (club_id, user_id, role, is_active)
    values (p_club_id, v_user, 'admin', true)
    on conflict (club_id, user_id) do update set role = 'admin', is_active = true;
    perform private.platform_audit('club.admin_assign', p_club_id, jsonb_build_object('user_id', v_user, 'email', v_email));
    return 'assigned';
  end if;

  -- Otherwise invite them; asking twice keeps the first invite.
  select i.id into v_invite
  from public.club_owner_invites i
  where i.club_id = p_club_id and i.email = v_email and i.claimed_at is null and i.cancelled_at is null;
  if v_invite is null then
    insert into public.club_owner_invites (club_id, email, invited_by)
    values (p_club_id, v_email, (select auth.uid()))
    returning id into v_invite;
    perform private.platform_audit('club.owner_invite', p_club_id, jsonb_build_object('invite_id', v_invite, 'email', v_email));
  end if;
  return 'invited';
end;
$$;

-- Open invites of one club, oldest first.
create or replace function public.platform_club_owner_invites(p_club_id uuid)
returns table (id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_platform_superadmin();
  return query
  select i.id, i.email, i.created_at
  from public.club_owner_invites i
  where i.club_id = p_club_id and i.claimed_at is null and i.cancelled_at is null
  order by i.created_at, i.id;
end;
$$;

create or replace function public.platform_cancel_club_owner_invite(p_invite_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid;
begin
  perform private.require_platform_superadmin();
  update public.club_owner_invites
  set cancelled_at = clock_timestamp()
  where id = p_invite_id and claimed_at is null and cancelled_at is null
  returning club_id into v_club;
  if v_club is null then
    raise exception 'That invite is no longer open' using errcode = 'P0002';
  end if;
  perform private.platform_audit('club.owner_invite_cancel', v_club, jsonb_build_object('invite_id', p_invite_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Signed-in: take up invites for a confirmed email, and list owned clubs
-- ---------------------------------------------------------------------------

create or replace function public.claim_my_owner_clubs()
returns table (club_id uuid, name text, status text)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_confirmed timestamptz;
  v_created timestamptz;
  v_invite record;
begin
  if v_user is null then
    return;
  end if;
  select lower(u.email), u.email_confirmed_at, u.created_at
  into v_email, v_confirmed, v_created
  from auth.users u
  where u.id = v_user and u.deleted_at is null and coalesce(u.is_sso_user, false) = false;

  if v_email is not null and v_confirmed is not null
     and exists (select 1 from public.profiles p where p.id = v_user) then
    for v_invite in
      select i.id, i.club_id
      from public.club_owner_invites i
      join public.clubs c on c.id = i.club_id
      where i.email = v_email
        and i.claimed_at is null
        and i.cancelled_at is null
        and i.created_at <= v_created
      order by i.created_at, i.id
      for update of i
    loop
      insert into public.club_staff_roles (club_id, user_id, role, is_active)
      values (v_invite.club_id, v_user, 'admin', true)
      on conflict (club_id, user_id) do update set role = 'admin', is_active = true;
      update public.club_owner_invites
      set claimed_at = clock_timestamp(), claimed_by = v_user
      where id = v_invite.id;
      perform private.platform_audit('club.owner_claim', v_invite.club_id,
        jsonb_build_object('invite_id', v_invite.id, 'user_id', v_user));
    end loop;
  end if;

  -- Clubs the caller owns through an invite and still administers.
  return query
  select distinct on (c.id) c.id, c.name,
         coalesce(a.status, case when c.is_active then 'active' else 'provisioning' end)
  from public.club_owner_invites i
  join public.clubs c on c.id = i.club_id
  join public.club_staff_roles r on r.club_id = c.id and r.user_id = v_user and r.role = 'admin' and r.is_active
  left join public.club_accounts a on a.club_id = c.id
  where i.claimed_by = v_user
  order by c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: an invited owner without a club link gets no default membership
-- ---------------------------------------------------------------------------

-- Same as 20261017090200_club_membership.sql, plus the invite check in the
-- branch without a club link. The email is not confirmed yet at this point, so
-- the check only skips the membership; it grants nothing.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
  v_code text;
  v_slug text;
  v_club uuid;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
  v_slug := nullif(lower(btrim(new.raw_user_meta_data ->> 'club_slug')), '');
  insert into public.profiles (id, email, full_name, role, phone)
  values (new.id, new.email, v_name, 'member', v_phone)
  on conflict (id) do nothing;

  if v_slug is not null then
    select c.id into v_club from public.clubs c where c.slug = v_slug and c.is_active;
    if v_club is null then
      raise exception 'This club link is not valid' using errcode = '22023';
    end if;
  else
    -- An invited court owner becomes their own club's admin instead.
    if exists (
      select 1 from public.club_owner_invites i
      where i.email = lower(btrim(new.email)) and i.claimed_at is null and i.cancelled_at is null
    ) then
      return new;
    end if;
    select c.id into v_club from public.clubs c where c.slug = 'rally-point-gensan' and c.is_active;
    -- With the default club closed, keep the profile and skip the membership
    -- rather than failing every sign-up.
    if v_club is null then
      return new;
    end if;
  end if;

  v_code := 'RP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.members (
    club_id, user_id, member_code, full_name, email, phone,
    membership_type, status, join_date, expiry_date, qr_token
  )
  values (
    v_club, new.id, v_code, v_name, new.email, v_phone,
    'standard', 'active', current_date, current_date + 30,
    'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  )
  on conflict (club_id, user_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership, row security and grants. New objects get no privileges by default.
-- ---------------------------------------------------------------------------

alter table public.club_owner_invites enable row level security;
revoke all on table public.club_owner_invites from public, anon, authenticated;
-- Say so with an explicit deny policy, like the platform tables (Supabase lint 0008).
create policy no_direct_api_access on public.club_owner_invites
  as restrictive for all to anon, authenticated using (false) with check (false);

alter function public.platform_invite_club_owner(uuid, text) owner to postgres;
alter function public.platform_club_owner_invites(uuid) owner to postgres;
alter function public.platform_cancel_club_owner_invite(uuid) owner to postgres;
alter function public.claim_my_owner_clubs() owner to postgres;
alter function public.handle_new_user() owner to postgres;

revoke all on function public.platform_invite_club_owner(uuid, text) from public, anon;
revoke all on function public.platform_club_owner_invites(uuid) from public, anon;
revoke all on function public.platform_cancel_club_owner_invite(uuid) from public, anon;
revoke all on function public.claim_my_owner_clubs() from public, anon;
grant execute on function public.platform_invite_club_owner(uuid, text) to authenticated;
grant execute on function public.platform_club_owner_invites(uuid) to authenticated;
grant execute on function public.platform_cancel_club_owner_invite(uuid) to authenticated;
grant execute on function public.claim_my_owner_clubs() to authenticated;

-- Unchanged from the club membership migration: only the auth service runs it.
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

comment on table public.club_owner_invites is
  'A club owner named by email by a platform superadmin. Becomes a club_staff_roles admin row when that person signs in with the email confirmed and an account newer than the invite.';
