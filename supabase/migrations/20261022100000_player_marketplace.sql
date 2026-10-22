-- Players can find any club and book there without buying a membership.
--
-- 1. A "player" is a members row with no membership: membership_type and
--    expiry_date are both NULL. A membership exists when both are set, status
--    is 'active', and expiry_date has not passed. Existing rows all have both,
--    so nothing changes for current members.
-- 2. join_club_as_player adds the signed-in person to a club as a player. A
--    person who is already in the club keeps their record and membership.
-- 3. list_public_clubs and get_public_club_detail let anyone, signed in or not,
--    see active clubs: name, city, address, venues, hours, courts and rates.
--    They return nothing about members, bookings or staff.
-- 4. Each venue (location) gets its own address, city and optional map pin,
--    which club admins set through admin_update_venue_location.
--
-- Booking itself is unchanged here. Member self-booking is still off in live
-- mode, and the reservation-write pause still holds.

do $$
begin
  if to_regprocedure('private.is_platform_superadmin()') is null
     or to_regclass('public.club_accounts') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.courts'::regclass and attname = 'member_rate' and not attisdropped
     ) then
    raise exception 'The player marketplace needs the platform control and court management migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Where each location is: address, city and an optional map pin
-- ---------------------------------------------------------------------------

alter table public.venues
  add column address text,
  add column city text,
  add column latitude numeric(9,6),
  add column longitude numeric(9,6);
alter table public.venues
  add constraint venues_address_length_check check (address is null or char_length(address) between 1 and 200),
  add constraint venues_city_length_check check (city is null or char_length(city) between 1 and 80),
  add constraint venues_pin_check check (
    (latitude is null) = (longitude is null)
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
  );

-- Club admin only: set or clear one of the club's locations' address and map pin.
create or replace function public.admin_update_venue_location(
  p_venue_id uuid, p_address text, p_city text, p_latitude numeric, p_longitude numeric
)
returns public.venues
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_venue public.venues;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Enter both latitude and longitude, or neither' using errcode = '22023';
  end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'Latitude must be between -90 and 90, and longitude between -180 and 180' using errcode = '22023';
  end if;
  if char_length(v_address) > 200 or char_length(v_city) > 80 then
    raise exception 'Address is limited to 200 characters and city to 80' using errcode = '22023';
  end if;
  update public.venues v
  set address = v_address, city = v_city,
      latitude = round(p_latitude, 6), longitude = round(p_longitude, 6)
  where v.id = p_venue_id and v.club_id = v_club
  returning v.* into v_venue;
  if v_venue.id is null then
    raise exception 'venue not found' using errcode = 'P0002';
  end if;
  return v_venue;
end;
$$;

-- ---------------------------------------------------------------------------
-- Players: a members row without a membership
-- ---------------------------------------------------------------------------

alter table public.members alter column membership_type drop not null;
alter table public.members alter column expiry_date drop not null;
alter table public.members add constraint members_membership_pair_check
  check ((membership_type is null) = (expiry_date is null));

comment on column public.members.membership_type is
  'NULL for a player with no membership. Set together with expiry_date.';

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
    'RP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8)),
    v_profile.full_name, v_profile.email, v_profile.phone,
    null, 'active', current_date, null,
    'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  )
  on conflict (club_id, user_id) do nothing;
  return v_club;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public club directory
-- ---------------------------------------------------------------------------

-- Active clubs with at least one active venue. Rates count in-service courts only.
create or replace function public.list_public_clubs()
returns table (
  slug text, name text, city text, address text, cities text[],
  venue_count integer, court_count integer,
  min_rate numeric, min_member_rate numeric
)
language sql stable security definer set search_path = ''
as $$
  select c.slug, c.name, a.city, a.address,
         -- The club's city plus its locations' cities, for the city filter.
         array(
           select distinct x.city from (
             select a.city as city
             union all
             select v.city from public.venues v where v.club_id = c.id and v.is_active
           ) x
           where x.city is not null
           order by x.city
         ),
         (select count(*)::int from public.venues v where v.club_id = c.id and v.is_active),
         (select count(*)::int from public.courts ct
            join public.venues v on v.club_id = ct.club_id and v.id = ct.venue_id
          where ct.club_id = c.id and v.is_active and ct.status <> 'maintenance'),
         (select min(ct.hourly_rate) from public.courts ct
            join public.venues v on v.club_id = ct.club_id and v.id = ct.venue_id
          where ct.club_id = c.id and v.is_active and ct.status <> 'maintenance'),
         (select min(coalesce(ct.member_rate, ct.hourly_rate)) from public.courts ct
            join public.venues v on v.club_id = ct.club_id and v.id = ct.venue_id
          where ct.club_id = c.id and v.is_active and ct.status <> 'maintenance')
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.is_active and a.status = 'active'
    and exists (select 1 from public.venues v where v.club_id = c.id and v.is_active)
  order by c.name;
$$;

-- One active club's venues and courts, or NULL when the slug is not an active club.
create or replace function public.get_public_club_detail(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'city', a.city,
    'address', a.address,
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'open_hour', v.open_hour,
        'close_hour', v.close_hour,
        'address', v.address,
        'city', v.city,
        'latitude', v.latitude,
        'longitude', v.longitude,
        'courts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ct.id,
            'name', ct.name,
            'hourly_rate', ct.hourly_rate,
            'member_rate', ct.member_rate,
            'in_service', ct.status <> 'maintenance'
          ) order by ct.name)
          from public.courts ct
          where ct.club_id = c.id and ct.venue_id = v.id
        ), '[]'::jsonb)
      ) order by v.name)
      from public.venues v
      where v.club_id = c.id and v.is_active
    ), '[]'::jsonb)
  )
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.slug = lower(btrim(p_slug)) and c.is_active and a.status = 'active';
$$;

alter function public.admin_update_venue_location(uuid, text, text, numeric, numeric) owner to postgres;
revoke all on function public.admin_update_venue_location(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.admin_update_venue_location(uuid, text, text, numeric, numeric) to authenticated;

alter function public.join_club_as_player(text) owner to postgres;
alter function public.list_public_clubs() owner to postgres;
alter function public.get_public_club_detail(text) owner to postgres;

revoke all on function public.join_club_as_player(text) from public, anon;
grant execute on function public.join_club_as_player(text) to authenticated;

-- Like get_public_club: open to visitors so people can browse before signing up.
revoke all on function public.list_public_clubs() from public;
revoke all on function public.get_public_club_detail(text) from public;
grant execute on function public.list_public_clubs() to anon, authenticated;
grant execute on function public.get_public_club_detail(text) to anon, authenticated;
