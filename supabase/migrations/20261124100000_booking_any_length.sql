-- Bookings of any length: a player picks as many hours in a row as they want.
--
-- Owner decision 2026-11-24: "there are no max booking hours". The player taps hour slots and
-- the number of slots is the length. A booking is still one court, whole hours in a row, at
-- least 1 hour, and must end by midnight (the existing start + hours <= 24 rule).
--
-- 1. public.bookings: the hours check (1 to 3, from 002_bookings.sql) becomes 1 to 24.
-- 2. public.hold_court_booking: its latest definition (20261122090000_member_gcash_checkout.sql)
--    copied unchanged except the length check. create or replace keeps its grants; owner set below.
-- The paused desk booking functions keep their own 1-to-3 check; they cannot write while the
-- reservation pause holds, and lifting the pause needs its own reviewed package.

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.bookings'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mhours\M'
      and pg_get_constraintdef(c.oid) ~ '<= 3\M'
  loop
    execute format('alter table public.bookings drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.bookings
  add constraint bookings_hours_check check (hours between 1 and 24);

create or replace function public.hold_court_booking(
  p_club_id uuid,
  p_venue_id uuid,
  p_court_id uuid,
  p_date date,
  p_start_hour integer,
  p_hours integer
)
returns public.bookings
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_club uuid := private.current_club_id();
  v_member public.members;
  v_venue public.venues;
  v_court public.courts;
  v_start timestamptz;
  v_end timestamptz;
  v_rate numeric(12,2);
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'Please sign in to book a court' using errcode = '42501';
  end if;
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot book courts' using errcode = '42501';
  end if;
  -- Like the desk functions, p_club_id must be the club the request names. The
  -- header grants nothing: the caller's own members row there is what counts.
  if v_club is null or p_club_id is distinct from v_club
     or not exists (
       select 1 from public.club_accounts a where a.club_id = v_club and a.status = 'active'
     ) then
    raise exception 'This club is not taking bookings' using errcode = '22023';
  end if;
  select m.* into v_member
  from public.members m
  where m.club_id = v_club and m.user_id = v_user;
  if v_member.id is null then
    raise exception 'Join this club before booking a court' using errcode = '42501';
  end if;
  if v_member.status = 'suspended' then
    raise exception 'Your account at this club is on hold. Ask the desk.' using errcode = '42501';
  end if;

  if p_hours is null or p_hours < 1 then
    raise exception 'Pick at least 1 hour' using errcode = '22023';
  end if;
  if p_date is null or p_start_hour is null or p_start_hour not between 0 and 23 then
    raise exception 'Pick a date and a start time' using errcode = '22023';
  end if;
  if p_start_hour + p_hours > 24 then
    raise exception 'A booking must end by midnight' using errcode = '22023';
  end if;

  select v.* into v_venue
  from public.venues v
  where v.club_id = v_club and v.id = p_venue_id and v.is_active;
  select c.* into v_court
  from public.courts c
  where c.id = p_court_id and c.club_id = v_club and c.venue_id = p_venue_id;
  if v_venue.id is null or v_court.id is null then
    raise exception 'That court is not at this location' using errcode = 'P0002';
  end if;
  if v_court.status = 'maintenance' then
    raise exception 'This court is out of service. Pick another court.' using errcode = '55000';
  end if;
  if p_start_hour < v_venue.open_hour or p_start_hour + p_hours > v_venue.close_hour then
    raise exception 'That time is outside this location''s opening hours' using errcode = '22023';
  end if;

  -- Venues are held to Asia/Manila, so the date and hour are Philippine time.
  v_start := (p_date::timestamp + make_interval(hours => p_start_hour)) at time zone v_venue.timezone;
  v_end := v_start + make_interval(hours => p_hours);
  if v_start < now() - interval '5 minutes' then
    raise exception 'That time has already passed. Pick a later time.' using errcode = '22023';
  end if;

  -- One request at a time per player, so two quick taps cannot take two holds.
  perform pg_advisory_xact_lock(hashtextextended('booking_hold:' || v_member.id::text, 0));

  -- Cancel the club's lapsed holds first, so their hours are free again for the
  -- overlap constraint.
  perform private.release_lapsed_holds(v_club);

  -- One unpaid hold per player: starting again (say, after leaving checkout or a
  -- refresh) gives back the previous hold. Only online holds count: a hold whose
  -- payment was sent, and desk bookings (no hold_expires_at), are never touched.
  with mine as (
    update public.bookings b
    set status = 'cancelled'
    where b.club_id = v_club
      and b.member_id = v_member.id
      and b.status = 'pending_payment'
      and b.payment_submitted_at is null
      and b.hold_expires_at is not null
    returning b.id
  )
  update public.court_allocations a
  set status = 'cancelled'
  from mine m
  where a.source = 'booking' and a.source_id = m.id and a.status = 'held';

  -- An active membership: a plan, status 'active', and an expiry date that has
  -- not passed in Philippine time. Players (no plan) pay the regular rate.
  v_rate := case
    when v_court.member_rate is not null
     and v_member.membership_type is not null
     and v_member.status = 'active'
     and v_member.expiry_date >= (now() at time zone 'Asia/Manila')::date
    then v_court.member_rate
    else v_court.hourly_rate
  end;

  begin
    insert into public.bookings (
      club_id, venue_id, court_id, member_id, start_at, end_at, hours, amount, status, hold_expires_at
    )
    values (
      v_club, p_venue_id, p_court_id, v_member.id, v_start, v_end, p_hours,
      v_rate * p_hours, 'pending_payment', now() + interval '15 minutes'
    )
    returning * into v_booking;

    insert into public.court_allocations (
      club_id, venue_id, court_id, source, source_id, interval, status, created_by
    )
    values (
      v_club, p_venue_id, p_court_id, 'booking', v_booking.id,
      tstzrange(v_start, v_end, '[)'), 'held', v_user
    );
  exception when exclusion_violation then
    raise exception 'That time was just taken. Pick another time.' using errcode = '23P01';
  end;

  return v_booking;
end;
$$;

alter function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) owner to postgres;

comment on function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) is
  'A player or member of the club holds one or more court hours in a row (ending by midnight) for 15 minutes while paying the club''s GCash QR. A new hold gives back the person''s previous unpaid hold, so there is one at a time.';
