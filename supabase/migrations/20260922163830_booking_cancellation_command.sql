-- Scoped cancellation for unpaid/confirmed court reservations. Booking state
-- and the contention record move atomically so a released interval can be
-- reserved again without reopening direct client writes.

create or replace function public.cancel_booking_reservation(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_booking public.bookings;
  v_club_id uuid := private.current_club_id();
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.club_id = v_club_id
  for update;

  if v_booking.id is null then
    raise exception 'booking access denied';
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = v_booking.member_id
      and m.club_id = v_booking.club_id
      and m.user_id = auth.uid()
  ) and private.can_operate_venue(v_booking.club_id, v_booking.venue_id) is not true then
    raise exception 'booking access denied';
  end if;

  if v_booking.status = 'cancelled' then
    return v_booking;
  end if;
  if v_booking.status not in ('pending_payment', 'confirmed') then
    raise exception 'booking cannot be cancelled';
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = v_booking.id
  returning * into v_booking;

  update public.court_allocations
  set status = 'cancelled'
  where source = 'booking'
    and source_id = v_booking.id
    and status in ('held', 'reserved', 'playing');

  if v_booking.session_id is not null then
    update public.court_sessions
    set status = 'cancelled'
    where id = v_booking.session_id
      and club_id = v_booking.club_id
      and status in ('scheduled', 'pending_payment');

    update public.court_allocations
    set status = 'cancelled'
    where source = 'session'
      and source_id = v_booking.session_id
      and status in ('held', 'reserved', 'playing');
  end if;

  return v_booking;
end;
$$;

alter function public.cancel_booking_reservation(uuid) owner to postgres;
revoke all on function public.cancel_booking_reservation(uuid) from public, anon;
grant execute on function public.cancel_booking_reservation(uuid) to authenticated;
