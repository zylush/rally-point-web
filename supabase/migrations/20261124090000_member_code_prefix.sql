-- Member codes: new codes start with BR- (bRineLy) instead of RP- (the old Rally Point name).
--
-- Owner decision 2026-11-24: one platform prefix, same format (prefix plus 8 hex characters).
-- Existing codes keep working: nothing here rewrites stored member_code values, and
-- check-in by code accepts both prefixes in the app (src/types.ts parseQrPayload).
--
-- Each function below is its latest definition copied unchanged except for the prefix:
--   handle_new_user       from 20261116090100_club_owner_invites.sql
--   admin_upsert_member   from 20260921090000_tenant_ready.sql
--   join_club             from 20261017090200_club_membership.sql
--   join_club_as_player   from 20261022100000_player_marketplace.sql
-- create or replace keeps each function's grants; ownership is set again below.

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

  v_code := 'BR-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
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

create or replace function public.admin_upsert_member(
  p_member_id uuid, p_full_name text, p_email text, p_phone text,
  p_membership_type public.membership_type, p_status public.member_status,
  p_join_date date, p_expiry_date date, p_notes text
)
returns public.members
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.members;
declare v_club uuid := private.current_club_id();
begin
  if private.current_club_role(v_club) is distinct from 'admin' then raise exception 'admin access required'; end if;
  if p_member_id is null then
    insert into public.members (club_id, member_code, full_name, email, phone, membership_type, status, join_date, expiry_date, notes)
    values (v_club, 'BR-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8)), p_full_name, p_email, p_phone, p_membership_type, p_status, p_join_date, p_expiry_date, p_notes)
    returning * into v;
  else
    update public.members
    set full_name = p_full_name, email = p_email, phone = p_phone,
        membership_type = p_membership_type, status = p_status,
        join_date = p_join_date, expiry_date = p_expiry_date, notes = p_notes
    where id = p_member_id and club_id = v_club
    returning * into v;
  end if;
  if v.id is null then raise exception 'member not found'; end if;
  return v;
end;
$$;

create or replace function public.join_club(p_slug text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_club uuid;
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Please sign in to join a club' using errcode = '42501';
  end if;
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot join clubs' using errcode = '42501';
  end if;
  select c.id into v_club from public.clubs c where c.slug = lower(btrim(p_slug)) and c.is_active;
  if v_club is null then
    raise exception 'This club link is not valid' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles p where p.id = v_user;
  if v_profile.id is null then
    raise exception 'Your profile is not ready yet' using errcode = '42501';
  end if;
  insert into public.members (
    club_id, user_id, member_code, full_name, email, phone,
    membership_type, status, join_date, expiry_date, qr_token
  )
  values (
    v_club, v_user,
    'BR-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8)),
    v_profile.full_name, v_profile.email, v_profile.phone,
    'standard', 'active', current_date, current_date + 30,
    'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  )
  on conflict (club_id, user_id) do nothing;
  return v_club;
end;
$$;

create or replace function public.join_club_as_player(p_slug text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_club uuid;
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Please sign in to book a court' using errcode = '42501';
  end if;
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot book courts' using errcode = '42501';
  end if;
  select c.id into v_club
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.slug = lower(btrim(p_slug)) and c.is_active and a.status = 'active';
  if v_club is null then
    raise exception 'This club is not taking bookings' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles p where p.id = v_user;
  if v_profile.id is null then
    raise exception 'Your profile is not ready yet' using errcode = '42501';
  end if;
  insert into public.members (
    club_id, user_id, member_code, full_name, email, phone,
    membership_type, status, join_date, expiry_date, qr_token
  )
  values (
    v_club, v_user,
    'BR-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8)),
    v_profile.full_name, v_profile.email, v_profile.phone,
    null, 'active', current_date, null,
    'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  )
  on conflict (club_id, user_id) do nothing;
  return v_club;
end;
$$;

alter function public.handle_new_user() owner to postgres;
alter function public.admin_upsert_member(uuid, text, text, text, public.membership_type, public.member_status, date, date, text) owner to postgres;
alter function public.join_club(text) owner to postgres;
alter function public.join_club_as_player(text) owner to postgres;
