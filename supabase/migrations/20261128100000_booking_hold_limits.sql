-- Booking hold limits: how far ahead a player may book, and how many sent payments may wait.
--
-- Security fix (owner-approved, 2026-11-28). Until now one free account could block every court
-- for as long as it liked: hold hours on any future date (there was no upper date bound), send a
-- made-up 6-character GCash reference through submit_booking_payment, and start again. A payment
-- the player has sent never lapses and is left alone by the one-unpaid-hold rule, so every such
-- hold stayed on the board until the club rejected it.
--
-- public.hold_court_booking: its latest definition (20261124100000_booking_any_length.sql) copied
-- unchanged except two checks right after the per-player lock. The numbers are named constants
-- at the top of the function body, so they are easy to change:
--   * BOOKING_WINDOW_DAYS = 30: the date may be at most 30 days after today in the venue's time
--     zone (venues are held to Asia/Manila). The booking screen offers the next 7 days.
--   * MAX_PAYMENTS_WAITING = 4 (the owner's number, 2026-11-28): a new hold is refused while the
--     player already has 4 bookings in this club whose payment was sent and is still waiting for
--     the club to confirm or reject it. Desk bookings, unpaid holds and other clubs do not count.
--     The player's own online bookings are locked before counting, so a payment sent for their
--     unpaid hold at that same moment is counted too.
-- A sent payment still never lapses (the player paid real money; the club decides), so nothing
-- is released automatically: the player can book again once the club confirms or rejects one.
-- create or replace keeps the grants (signed-in callers only); the owner is set below. The
-- reservation-write pause is unchanged: no paused function and no table grant is touched.

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
  -- BOOKING_WINDOW_DAYS: a booking date is at most this many days after today (venue time).
  c_booking_window_days constant integer := 30;
  -- MAX_PAYMENTS_WAITING: sent payments a player may have waiting for this club at once.
  c_max_payments_waiting constant integer := 4;
  v_user uuid := auth.uid();
  v_club uuid := private.current_club_id();
  v_member public.members;
  v_venue public.venues;
  v_court public.courts;
  v_start timestamptz;
  v_end timestamptz;
  v_rate numeric(12,2);
  v_waiting integer;
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

  -- BOOKING_WINDOW_DAYS: up to 30 days after today, counted in the venue's time zone.
  if p_date > (now() at time zone v_venue.timezone)::date + c_booking_window_days then
    raise exception 'You can book up to % days ahead. Pick an earlier date.', c_booking_window_days
      using errcode = '22023';
  end if;

  -- MAX_PAYMENTS_WAITING: a sent payment never lapses (the player paid; the club confirms or
  -- rejects it), so without a cap one account could hold every court with made-up references.
  -- Only this player's online bookings in this club whose payment was sent count: desk bookings
  -- (no hold_expires_at), unpaid holds and other clubs do not. Their rows are locked first, so a
  -- payment sent for the player's unpaid hold at this same moment is counted too.
  perform 1
  from public.bookings b
  where b.club_id = v_club
    and b.member_id = v_member.id
    and b.status = 'pending_payment'
    and b.hold_expires_at is not null
  for update of b;
  select count(*)::integer into v_waiting
  from public.bookings b
  where b.club_id = v_club
    and b.member_id = v_member.id
    and b.status = 'pending_payment'
    and b.hold_expires_at is not null
    and b.payment_submitted_at is not null;
  if v_waiting >= c_max_payments_waiting then
    raise exception 'You have % % waiting for the club to check. You can book again once the club confirms or rejects one.',
      v_waiting, case when v_waiting = 1 then 'payment' else 'payments' end
      using errcode = '55000';
  end if;

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
