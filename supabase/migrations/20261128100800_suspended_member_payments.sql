-- Suspended members: no GCash payment for hours held before the account was put on hold.
--
-- Security fix (owner-approved, 2026-11-28). hold_court_booking refuses a suspended member, but
-- submit_booking_payment (through private.own_booking_for_update) only checks that the booking is
-- the caller's own, so a member suspended after taking a hold could still send a payment for it.
-- That payment never lapses and keeps the hours held until the club decides.
--
-- public.submit_booking_payment: its latest definition (20261122090000_member_gcash_checkout.sql)
-- copied unchanged except one check after the booking is found: the booking's member row must not
-- be suspended, refused with the words hold_court_booking uses. Staff can still confirm or reject a
-- payment that was already sent (staff_confirm_booking_payment and staff_reject_booking_payment are
-- unchanged), and the unpaid hold still lapses on its own. Same signature, definer rights and empty
-- search path; create or replace keeps the grants and the comment; the owner is set below. The
-- reservation-write pause is unchanged: no paused function and no table grant is touched.

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
  -- New: a member the club put on hold cannot pay for hours held before that, as they cannot hold.
  if exists (
    select 1 from public.members m
    where m.id = v_booking.member_id and m.club_id = v_booking.club_id and m.status = 'suspended'
  ) then
    raise exception 'Your account at this club is on hold. Ask the desk.' using errcode = '42501';
  end if;
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

alter function public.submit_booking_payment(uuid, text) owner to postgres;
