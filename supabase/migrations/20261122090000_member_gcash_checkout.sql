-- Member checkout with the club's own GCash QR.
--
-- The flow:
--   1. A player picks hours. hold_court_booking creates a 'pending_payment'
--      booking that holds those hours for 15 minutes (hold_expires_at), plus a
--      'held' court_allocations row, so the existing overlap constraint
--      (court_allocations_no_overlap) keeps everyone else off them.
--   2. The player pays the club's GCash QR and enters the GCash reference
--      number. submit_booking_payment records it and gives the club 15 minutes
--      to check it (confirm_by). From then on the hold never lapses: the player
--      may already have paid, and there are no refunds. A late check shows as
--      overdue in the app, and the hours stay held.
--   3. Staff or an admin who works at that location confirms the payment or
--      rejects it. Confirmed: the booking is booked, its allocation becomes
--      'reserved', a 'booking' charge is recorded (so the commission trigger
--      adds its line), and the player is told. Rejected: the booking is
--      cancelled, its hours are free again, and the player is told why.
--   4. A hold nobody pays for lapses after 15 minutes. It leaves the public
--      schedule straight away, and the next hold_court_booking in that club
--      cancels it and its allocation. The player may also release a hold early,
--      but only before sending a payment.
--
-- Unchanged on purpose:
--   * Desk bookings (create_unpaid_desk_booking) have no hold time, so nothing
--     here lapses, releases, takes payment for or confirms them.
--   * No enum gains a value (adding one inside a migration once failed with
--     55P04). The booking stays 'pending_payment' until the club decides; the
--     new nullable columns tell a hold, a sent payment and a desk booking apart.
--   * Rally Point does not take, hold or check the money. A confirmed payment is
--     recorded as an unverified charge, like every other recorded charge.
--   * Platform superadmins gain nothing: they work only through the audited
--     platform_* functions.
--
-- Release note: bookings and court_allocations are inside the reservation-write
-- pause. Like admin_upsert_court, this adds narrow definer functions, not table
-- grants, and the nine paused functions stay paused. A hosted apply needs its
-- own reviewed release, and the owner must approve opening this member path.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.can_operate_venue(uuid, uuid)') is null
     or to_regprocedure('private.is_platform_superadmin()') is null
     or to_regprocedure('board.public_schedule_rows()') is null
     or to_regclass('public.club_accounts') is null
     or to_regclass('public.club_payment_methods') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.court_allocations'::regclass and conname = 'court_allocations_no_overlap'
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.courts'::regclass and attname = 'member_rate' and not attisdropped
     ) then
    raise exception 'GCash checkout needs the tenant enforcement, club platform, court management, advisor follow-up and club profile migrations first.';
  end if;
  -- Only values that already exist are used. Nothing here adds an enum value.
  if not exists (
       select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typnamespace = 'public'::regnamespace and t.typname = 'payment_method' and e.enumlabel = 'gcash'
     )
     or not exists (
       select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typnamespace = 'public'::regnamespace and t.typname = 'tx_type' and e.enumlabel = 'booking'
     ) then
    raise exception 'GCash checkout needs the existing gcash payment method and booking charge type.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking columns
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column hold_expires_at timestamptz,
  add column payment_reference text,
  add column payment_submitted_at timestamptz,
  add column confirm_by timestamptz;

-- A sent payment always has its reference, time and deadline together, and a
-- reference is 6 to 30 letters or digits. Every existing row has none of them.
alter table public.bookings
  add constraint bookings_payment_reference_check
    check (payment_reference is null or payment_reference ~ '^[A-Za-z0-9]{6,30}$'),
  add constraint bookings_payment_submission_check
    check ((payment_submitted_at is null) = (payment_reference is null)
           and (payment_submitted_at is null) = (confirm_by is null));

comment on column public.bookings.hold_expires_at is
  'Online checkout only: an unpaid hold stops counting at this time. NULL for desk bookings, which never lapse.';
comment on column public.bookings.payment_reference is
  'The GCash reference number the player entered after paying the club''s QR.';
comment on column public.bookings.payment_submitted_at is
  'When the player said they paid. From then the hold no longer lapses; the club confirms or rejects it.';
comment on column public.bookings.confirm_by is
  'When the club should have checked the payment. After it the request is overdue, but its hours stay held.';

-- Finds a club's unpaid holds quickly, for the lapse sweep and the one-hold rule.
create index bookings_unpaid_holds_idx on public.bookings (club_id, hold_expires_at)
  where status = 'pending_payment' and payment_submitted_at is null and hold_expires_at is not null;

-- A GCash reference pays for one booking per club. A cancelled (released or
-- rejected) booking frees its reference.
create unique index bookings_club_payment_reference_key
  on public.bookings (club_id, upper(payment_reference))
  where payment_reference is not null and status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Private helpers (only the functions below call them)
-- ---------------------------------------------------------------------------

-- "Lagao Court A, Jun 1, 6:00 PM to 8:00 PM", in Philippine time, for notices.
create or replace function private.booking_slot_text(p_booking_id uuid)
returns text
language sql stable set search_path = ''
as $$
  select c.name || ', '
         || to_char(b.start_at at time zone 'Asia/Manila', 'Mon FMDD') || ', '
         || to_char(b.start_at at time zone 'Asia/Manila', 'FMHH12:MI AM') || ' to '
         || to_char(b.end_at at time zone 'Asia/Manila', 'FMHH12:MI AM')
  from public.bookings b
  join public.courts c on c.id = b.court_id and c.club_id = b.club_id
  where b.id = p_booking_id;
$$;

-- The caller's own booking in the current club, locked. "Own" means the
-- booking's members row belongs to the signed-in person. Anyone else, and any
-- other club, gets the same "not found".
create or replace function private.own_booking_for_update(p_booking_id uuid)
returns public.bookings
language plpgsql volatile set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot change club bookings' using errcode = '42501';
  end if;
  select b.* into v_booking
  from public.bookings b
  join public.members m on m.id = b.member_id and m.club_id = b.club_id
  where b.id = p_booking_id
    and b.club_id = private.current_club_id()
    and m.user_id = auth.uid()
  for update of b;
  if v_booking.id is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  return v_booking;
end;
$$;

-- Cancels a club's unpaid online holds whose 15 minutes are up, with their
-- allocations, so the hours are free again for the overlap constraint and every
-- list agrees. A sent payment and desk bookings (no hold_expires_at) never
-- lapse. A row another request is busy with is skipped; that request settles it.
-- Called by every function here that writes a club's bookings. The paused desk
-- and open-play functions must call it too when the reservation-write pause lifts.
create or replace function private.release_lapsed_holds(p_club_id uuid)
returns void
language sql volatile set search_path = ''
as $$
  with lapsed as (
    select b.id
    from public.bookings b
    where b.club_id = p_club_id
      and b.status = 'pending_payment'
      and b.payment_submitted_at is null
      and b.hold_expires_at <= now()
    for update of b skip locked
  ), released as (
    update public.bookings b
    set status = 'cancelled'
    from lapsed l
    where b.id = l.id
    returning b.id
  )
  update public.court_allocations a
  set status = 'cancelled'
  from released r
  where a.source = 'booking' and a.source_id = r.id and a.status = 'held';
$$;

-- A sent payment that staff may decide on, locked. The club comes from the
-- request header, which only picks the club: the caller still needs an active
-- staff or admin role there (club_staff_roles). Staff also need a grant for the
-- booking's location (private.can_operate_venue); admins decide for every
-- location, even one the club has since closed, so a sent payment is never
-- stuck. An overdue payment, past confirm_by, can still be decided. Platform
-- accounts never decide club payments, even with a club role.
create or replace function private.payment_to_decide(p_booking_id uuid, p_action text)
returns public.bookings
language plpgsql volatile set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_role text;
  v_booking public.bookings;
begin
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot % club payments', p_action using errcode = '42501';
  end if;
  v_role := private.current_club_role(v_club)::text;
  if not coalesce(v_role in ('staff', 'admin'), false) then
    raise exception 'Only club staff at this location can % payments', p_action using errcode = '42501';
  end if;
  perform private.release_lapsed_holds(v_club);
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.club_id = v_club
  for update;
  if v_booking.id is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_role <> 'admin' and private.can_operate_venue(v_booking.club_id, v_booking.venue_id) is not true then
    raise exception 'Only club staff at this location can % payments', p_action using errcode = '42501';
  end if;
  if v_booking.status = 'confirmed' then
    raise exception 'This payment is already confirmed' using errcode = '55000';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is no longer waiting for payment' using errcode = '55000';
  end if;
  if v_booking.payment_submitted_at is null then
    raise exception 'The player has not sent a payment for this booking yet' using errcode = '55000';
  end if;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

-- Hold court hours for 15 minutes while the player pays. The caller needs a
-- members row in the club (as a player or a member); an active membership gets
-- the court's member rate, as the app's courtRateFor does.
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

  if p_hours is null or p_hours not between 1 and 3 then
    raise exception 'Book 1 to 3 hours' using errcode = '22023';
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

-- Give back a hold before paying. Releasing again, or after the hold was swept
-- or rejected, changes nothing.
create or replace function public.release_booking_hold(p_booking_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to release a booking' using errcode = '42501';
  end if;
  v_booking := private.own_booking_for_update(p_booking_id);
  if v_booking.status = 'cancelled' then
    return;
  end if;
  if v_booking.hold_expires_at is null then
    raise exception 'This booking was made at the desk. Ask the club to cancel it.' using errcode = '55000';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is already confirmed' using errcode = '55000';
  end if;
  if v_booking.payment_submitted_at is not null then
    raise exception 'You already sent a payment. The club will confirm or reject it.' using errcode = '55000';
  end if;

  update public.bookings b
  set status = 'cancelled'
  where b.id = v_booking.id;
  update public.court_allocations a
  set status = 'cancelled'
  where a.source = 'booking' and a.source_id = v_booking.id and a.status = 'held';
end;
$$;

-- Record the GCash reference number while the hold is live. Spaces are
-- removed; what is left must be 6 to 30 letters or digits.
create or replace function public.submit_booking_payment(p_booking_id uuid, p_reference text)
returns public.bookings
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_reference text := regexp_replace(coalesce(p_reference, ''), '\s', '', 'g');
  v_booking public.bookings;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to pay for a booking' using errcode = '42501';
  end if;
  if v_reference !~ '^[A-Za-z0-9]{6,30}$' then
    raise exception 'Enter the GCash reference number: 6 to 30 letters or digits' using errcode = '22023';
  end if;
  v_booking := private.own_booking_for_update(p_booking_id);
  if v_booking.hold_expires_at is null then
    raise exception 'This booking was made at the desk. Pay the club directly.' using errcode = '55000';
  end if;
  if v_booking.payment_submitted_at is not null then
    raise exception 'You already sent a payment for this booking' using errcode = '55000';
  end if;
  -- Whether or not a sweep has cancelled it yet.
  if v_booking.hold_expires_at <= now() then
    raise exception 'Your 15 minutes to pay ran out, so those hours were released. Pick a time again.'
      using errcode = '55000';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This hold was released. Pick a time again.' using errcode = '55000';
  end if;
  -- An old GCash receipt cannot pay for a second booking: a reference already on
  -- another live or confirmed booking at this club is refused. The unique index
  -- bookings_club_payment_reference_key settles two attempts at the same moment.
  if exists (
    select 1 from public.bookings b
    where b.club_id = v_booking.club_id
      and b.id <> v_booking.id
      and b.status <> 'cancelled'
      and upper(b.payment_reference) = upper(v_reference)
  ) then
    raise exception 'This GCash reference number was already used for another booking' using errcode = '23505';
  end if;

  begin
    update public.bookings b
    set payment_reference = v_reference,
        payment_submitted_at = now(),
        confirm_by = now() + interval '15 minutes',
        payment_method = 'gcash'::public.payment_method
    where b.id = v_booking.id
    returning b.* into v_booking;
  exception when unique_violation then
    raise exception 'This GCash reference number was already used for another booking' using errcode = '23505';
  end;
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club staff and admins
-- ---------------------------------------------------------------------------

-- The club received the money: book the hours, record the charge, tell the player.
create or replace function public.staff_confirm_booking_payment(p_booking_id uuid)
returns public.bookings
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_player uuid;
begin
  v_booking := private.payment_to_decide(p_booking_id, 'confirm');

  update public.bookings b
  set status = 'confirmed',
      payment_ref = b.payment_reference
  where b.id = v_booking.id
  returning b.* into v_booking;
  update public.court_allocations a
  set status = 'reserved'
  where a.source = 'booking' and a.source_id = v_booking.id and a.status = 'held';
  if not found then
    raise exception 'This booking no longer holds its court time' using errcode = '55000';
  end if;

  -- A 'booking' charge, so the platform commission trigger records its line.
  -- Rally Point did not collect this money, so the charge stays unverified.
  insert into public.transactions (
    club_id, venue_id, member_id, amount, type, description, created_by, verification_status
  )
  values (
    v_booking.club_id, v_booking.venue_id, v_booking.member_id, v_booking.amount, 'booking',
    coalesce((select c.name from public.courts c
              where c.id = v_booking.court_id and c.club_id = v_booking.club_id), 'Court')
      || ' booking · GCash ref ' || v_booking.payment_reference,
    auth.uid(), 'unverified'
  );

  select m.user_id into v_player
  from public.members m
  where m.id = v_booking.member_id and m.club_id = v_booking.club_id;
  if v_player is not null then
    insert into public.notifications (club_id, venue_id, user_id, title, body)
    values (
      v_booking.club_id, v_booking.venue_id, v_player, 'Booking confirmed',
      'The club confirmed your GCash payment. '
        || coalesce(private.booking_slot_text(v_booking.id), 'Your court time') || ' is booked.'
    );
  end if;

  return v_booking;
end;
$$;

-- The club did not find the money: free the hours and tell the player why.
create or replace function public.staff_reject_booking_payment(p_booking_id uuid, p_reason text)
returns public.bookings
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_booking public.bookings;
  v_player uuid;
begin
  v_booking := private.payment_to_decide(p_booking_id, 'reject');
  if char_length(v_reason) not between 1 and 200 then
    raise exception 'Give a reason of 1 to 200 characters' using errcode = '22023';
  end if;

  update public.bookings b
  set status = 'cancelled'
  where b.id = v_booking.id
  returning b.* into v_booking;
  update public.court_allocations a
  set status = 'cancelled'
  where a.source = 'booking' and a.source_id = v_booking.id and a.status in ('held', 'reserved');

  select m.user_id into v_player
  from public.members m
  where m.id = v_booking.member_id and m.club_id = v_booking.club_id;
  if v_player is not null then
    insert into public.notifications (club_id, venue_id, user_id, title, body)
    values (
      v_booking.club_id, v_booking.venue_id, v_player, 'Payment not confirmed',
      'The club could not confirm your GCash payment for '
        || coalesce(private.booking_slot_text(v_booking.id), 'your court time')
        || ', so those hours were released. Reason: ' || v_reason
    );
  end if;

  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public schedule
-- ---------------------------------------------------------------------------

-- Copied from 20261017170000_supabase_advisor_followup.sql with one change, in
-- the bookings branch: an unpaid online hold whose 15 minutes are up stops
-- counting at once, before any sweep cancels it. The test is NULL-safe, so desk
-- bookings (no hold time) and sent payments (never lapse) keep showing.
create or replace function board.public_schedule_rows()
returns table (id uuid, club_id uuid, venue_id uuid, venue_name text, court_id uuid, court_name text,
  kind text, title text, start_at timestamptz, end_at timestamptz, status text, subtitle text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.club_id, s.venue_id, v.name as venue_name, s.court_id, c.name as court_name,
         'session'::text as kind, 'In use'::text as title,
         s.start_at, s.end_at,
         case when s.status = 'playing' then 'playing' else 'scheduled' end::text as status,
         case when s.status = 'playing' then 'playing' else 'scheduled' end::text as subtitle
  from public.court_sessions s
  join public.courts c on c.id = s.court_id and c.club_id = s.club_id
  join public.venues v on v.id = s.venue_id and v.club_id = s.club_id
  where s.club_id = private.current_club_id()
    and s.status in ('scheduled', 'playing', 'pending_payment')
  union all
  select b.id, b.club_id, b.venue_id, v.name, b.court_id, c.name,
         'booking'::text, 'Reserved'::text,
         b.start_at, b.end_at, 'reserved'::text, 'reserved'::text
  from public.bookings b
  join public.courts c on c.id = b.court_id and c.club_id = b.club_id
  join public.venues v on v.id = b.venue_id and v.club_id = b.club_id
  where b.club_id = private.current_club_id()
    and b.session_id is null and b.status in ('pending_payment', 'confirmed')
    and not (b.status = 'pending_payment' and b.payment_submitted_at is null
             and coalesce(b.hold_expires_at <= now(), false))
  union all
  select o.id, o.club_id, o.venue_id, v.name, o.court_id, c.name,
         'open_play'::text, 'Open play'::text,
         o.start_at, o.end_at, o.status::text, (o.capacity::text || ' seats')::text
  from public.open_plays o
  left join public.courts c on c.id = o.court_id and c.club_id = o.club_id
  join public.venues v on v.id = o.venue_id and v.club_id = o.club_id
  where o.club_id = private.current_club_id() and o.status in ('open', 'full')
$$;

-- The same grants as before.
revoke all on function board.public_schedule_rows() from public, anon, authenticated, service_role;
grant execute on function board.public_schedule_rows() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ownership and grants. Every function checks the caller inside.
-- ---------------------------------------------------------------------------

alter function private.booking_slot_text(uuid) owner to postgres;
alter function private.own_booking_for_update(uuid) owner to postgres;
alter function private.payment_to_decide(uuid, text) owner to postgres;
alter function private.release_lapsed_holds(uuid) owner to postgres;
revoke all on function private.booking_slot_text(uuid) from public, anon, authenticated, service_role;
revoke all on function private.own_booking_for_update(uuid) from public, anon, authenticated, service_role;
revoke all on function private.payment_to_decide(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.release_lapsed_holds(uuid) from public, anon, authenticated, service_role;

alter function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) owner to postgres;
alter function public.release_booking_hold(uuid) owner to postgres;
alter function public.submit_booking_payment(uuid, text) owner to postgres;
alter function public.staff_confirm_booking_payment(uuid) owner to postgres;
alter function public.staff_reject_booking_payment(uuid, text) owner to postgres;

revoke all on function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) from public, anon, service_role;
revoke all on function public.release_booking_hold(uuid) from public, anon, service_role;
revoke all on function public.submit_booking_payment(uuid, text) from public, anon, service_role;
revoke all on function public.staff_confirm_booking_payment(uuid) from public, anon, service_role;
revoke all on function public.staff_reject_booking_payment(uuid, text) from public, anon, service_role;

grant execute on function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) to authenticated;
grant execute on function public.release_booking_hold(uuid) to authenticated;
grant execute on function public.submit_booking_payment(uuid, text) to authenticated;
grant execute on function public.staff_confirm_booking_payment(uuid) to authenticated;
grant execute on function public.staff_reject_booking_payment(uuid, text) to authenticated;

comment on function public.hold_court_booking(uuid, uuid, uuid, date, integer, integer) is
  'A player or member of the club holds 1 to 3 court hours for 15 minutes while paying the club''s GCash QR. A new hold gives back the person''s previous unpaid hold, so there is one at a time.';
comment on function public.release_booking_hold(uuid) is
  'The booking''s own player gives back an unpaid hold before sending a payment. Repeating it changes nothing.';
comment on function public.submit_booking_payment(uuid, text) is
  'The booking''s own player records the GCash reference number while the hold is live. The hours then stay held until the club decides.';
comment on function public.staff_confirm_booking_payment(uuid) is
  'Staff or an admin at the booking''s location confirms a sent GCash payment: booked, charge recorded, player told.';
comment on function public.staff_reject_booking_payment(uuid, text) is
  'Staff or an admin at the booking''s location rejects a sent GCash payment with a reason: hours released, player told.';
