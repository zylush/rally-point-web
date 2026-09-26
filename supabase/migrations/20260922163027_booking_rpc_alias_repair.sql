-- Forward repair for the already-applied tenant expansion migration.
--
-- The original function used `v` as both its booking record variable and the
-- venues-table alias. PostgreSQL rejects the allowed execution path with
-- SQLSTATE 42702 before it can create an unpaid reservation. Keep the public
-- signature and authorization behavior unchanged; use unambiguous names only.

create or replace function public.create_unpaid_desk_booking(
  p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid,
  p_date date, p_start_hour integer, p_hours integer
)
returns public.bookings
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_booking public.bookings;
  v_start timestamptz;
  v_end timestamptz;
  v_rate numeric;
  v_timezone text;
begin
  if p_club_id is distinct from private.current_club_id()
     or private.can_operate_venue(p_club_id, p_venue_id) is not true then
    raise exception 'venue is not assigned to this operator';
  end if;
  if p_hours not between 1 and 3 or p_start_hour < 0 or p_start_hour + p_hours > 24 then
    raise exception 'invalid reservation interval';
  end if;
  if not exists (
    select 1 from public.courts c
    where c.id = p_court_id
      and c.club_id = p_club_id
      and c.venue_id = p_venue_id
      and c.status <> 'maintenance'
  ) then
    raise exception 'court is not in the selected venue';
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = p_member_id and m.club_id = p_club_id
  ) then
    raise exception 'member is not in this club';
  end if;

  select c.hourly_rate, venue_row.timezone
  into v_rate, v_timezone
  from public.courts c
  join public.venues venue_row
    on venue_row.club_id = c.club_id and venue_row.id = c.venue_id
  where c.id = p_court_id
    and c.club_id = p_club_id
    and c.venue_id = p_venue_id;

  v_start := (p_date::timestamp + make_interval(hours => p_start_hour))
    at time zone coalesce(v_timezone, 'Asia/Manila');
  v_end := v_start + make_interval(hours => p_hours);

  insert into public.bookings (
    club_id, venue_id, court_id, member_id, start_at, end_at, hours, amount, status
  )
  values (
    p_club_id, p_venue_id, p_court_id, p_member_id, v_start, v_end,
    p_hours, v_rate * p_hours, 'pending_payment'
  )
  returning * into v_booking;

  insert into public.court_allocations (
    club_id, venue_id, court_id, source, source_id, interval, status
  )
  values (
    p_club_id, p_venue_id, p_court_id, 'booking', v_booking.id,
    tstzrange(v_start, v_end, '[)'), 'reserved'
  );

  return v_booking;
end;
$$;

alter function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)
  owner to postgres;
revoke all on function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)
  from public, anon;
grant execute on function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)
  to authenticated;
