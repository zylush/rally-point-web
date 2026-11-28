-- Club admins: only accounts with a confirmed email, and never a platform account.
--
-- Security fix (owner-approved, 2026-11-28), in three functions:
--
-- 1. public.platform_assign_club_admin made any account using the email a club admin, even one
--    whose email was never confirmed, so whoever registered an owner's address first could be
--    made admin in the owner's place. The newer platform_invite_club_owner
--    (20261116090100_club_owner_invites.sql) already requires a confirmed email. Now this function
--    requires one too, and says so plainly when only an unconfirmed account uses the email. (The
--    superadmin's "Add admin" form uses platform_invite_club_owner, which invites such an owner.)
--
-- 2. A platform superadmin could become a club admin: platform_assign_club_admin or
--    platform_invite_club_owner with their own (or another platform account's) email, or an
--    invite that a platform account then takes up through claim_my_owner_clubs. An admin row in
--    club_staff_roles makes private.current_club_role answer 'admin', which opens every admin_*
--    function, member_admin (member emails, phones, QR codes), charges and bookings. That goes
--    around the read-only, time-limited support sessions: superadmins must never open club
--    screens or change club data. Now:
--      * platform_assign_club_admin refuses an email that a platform account uses;
--      * platform_invite_club_owner refuses such an email before anything is recorded, so a
--        platform account is neither made admin at once nor invited;
--      * claim_my_owner_clubs takes up no invite for a platform account. It runs at every
--        sign-in, so it does not raise: the invite stays open for the superadmin to cancel.
--    No trigger or constraint is added across club_staff_roles and platform_roles, so rows that
--    already overlap (an owner's own account may be a superadmin for now) are left as they are.
--
-- Each function is its latest definition copied unchanged except those checks: same signature,
-- definer rights, empty search path and audit rows. create or replace keeps the grants
-- (signed-in callers; each function checks the caller inside); owners are set below.

-- From 20261017090100_platform_control.sql.
create or replace function public.platform_assign_club_admin(p_club_id uuid, p_email text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  perform private.require_platform_superadmin();
  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'Club not found' using errcode = 'P0002';
  end if;
  -- A platform account never becomes a club admin: superadmins see a club only through the
  -- read-only, time-limited support view.
  if exists (
    select 1
    from auth.users u
    join public.platform_roles r on r.user_id = u.id
    where lower(u.email) = v_email
      and u.deleted_at is null
  ) then
    raise exception 'A platform account cannot be a club admin. Use a different email for the club.'
      using errcode = '22023';
  end if;
  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email
    and u.deleted_at is null
    and coalesce(u.is_sso_user, false) = false
    and u.email_confirmed_at is not null
    and exists (select 1 from public.profiles p where p.id = u.id)
  limit 1;
  if v_user is null then
    -- Whoever registered the address first must not become the admin before the owner has
    -- confirmed that the email is theirs.
    if exists (
      select 1
      from auth.users u
      where lower(u.email) = v_email
        and u.deleted_at is null
        and coalesce(u.is_sso_user, false) = false
        and exists (select 1 from public.profiles p where p.id = u.id)
    ) then
      raise exception 'That person has not confirmed their email yet. Ask them to confirm it, then try again.'
        using errcode = '55000';
    end if;
    raise exception 'No account uses that email yet. Ask them to sign up first.' using errcode = 'P0002';
  end if;
  insert into public.club_staff_roles (club_id, user_id, role, is_active)
  values (p_club_id, v_user, 'admin', true)
  on conflict (club_id, user_id) do update set role = 'admin', is_active = true;
  perform private.platform_audit('club.admin_assign', p_club_id, jsonb_build_object('user_id', v_user, 'email', v_email));
  return v_user;
end;
$$;

-- From 20261116090100_club_owner_invites.sql.
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

  -- A platform account never becomes a club admin, now or through an invite, so its email is
  -- refused before anything is recorded. This covers both branches below.
  if exists (
    select 1
    from auth.users u
    join public.platform_roles r on r.user_id = u.id
    where lower(u.email) = v_email
      and u.deleted_at is null
  ) then
    raise exception 'A platform account cannot be a club admin. Use a different email for the club.'
      using errcode = '22023';
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

-- From 20261116090100_club_owner_invites.sql.
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

  -- A platform account takes up no invite (superadmins never become club admins). This runs at
  -- every sign-in, so it skips quietly; the invite stays open for the superadmin to cancel.
  if v_email is not null and v_confirmed is not null
     and exists (select 1 from public.profiles p where p.id = v_user)
     and not exists (select 1 from public.platform_roles r where r.user_id = v_user) then
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

alter function public.platform_assign_club_admin(uuid, text) owner to postgres;
alter function public.platform_invite_club_owner(uuid, text) owner to postgres;
alter function public.claim_my_owner_clubs() owner to postgres;
