-- Club admins manage their own club's courts: add a court to one of the club's
-- venues, rename it, change its hourly rate, and take it out of service or put
-- it back.
--
-- Courts are never deleted: their sessions and bookings keep the history.
-- "Out of service" is the existing 'maintenance' status, which the booking, desk
-- and open-play functions already refuse. A court cannot move to another venue,
-- because its sessions and bookings are tied to that venue.
--
-- public.courts is inside the reservation-write pause, which removed direct
-- writes from every API role. This adds one narrow, admin-only write path. It
-- does not restore table grants. A hosted apply needs its own approved release.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null then
    raise exception 'Court management needs the club context migration first.';
  end if;
end;
$$;

-- Optional lower price for players with an active membership at the club.
-- NULL means members pay the regular hourly rate.
alter table public.courts add column member_rate numeric(12,2);
alter table public.courts add constraint courts_member_rate_check
  check (member_rate is null or (member_rate >= 0 and member_rate <= hourly_rate));

create or replace function public.admin_upsert_court(
  p_court_id uuid,
  p_venue_id uuid,
  p_name text,
  p_hourly_rate numeric,
  p_member_rate numeric,
  p_in_service boolean
)
returns public.courts
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_court public.courts;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Court name must be 1 to 40 characters' using errcode = '22023';
  end if;
  if p_hourly_rate is null or p_hourly_rate < 0 or p_hourly_rate > 100000
     or p_hourly_rate <> round(p_hourly_rate, 2) then
    raise exception 'Hourly rate must be between 0 and 100,000 pesos' using errcode = '22023';
  end if;
  if p_member_rate is not null and (
    p_member_rate < 0 or p_member_rate <> round(p_member_rate, 2) or p_member_rate > p_hourly_rate
  ) then
    raise exception 'Member rate must be between 0 and the regular rate' using errcode = '22023';
  end if;
  if p_in_service is null then
    raise exception 'Choose whether the court is in service' using errcode = '22023';
  end if;

  if p_court_id is null then
    if not exists (
      select 1 from public.venues v where v.club_id = v_club and v.id = p_venue_id
    ) then
      raise exception 'venue not found' using errcode = 'P0002';
    end if;
  else
    select c.* into v_court
    from public.courts c
    where c.id = p_court_id and c.club_id = v_club
    for update;
    if not found then
      raise exception 'court not found' using errcode = 'P0002';
    end if;
    if p_venue_id is distinct from v_court.venue_id then
      raise exception 'A court cannot move to another venue' using errcode = '22023';
    end if;
    -- Ending a session sets the court back to available, which would quietly
    -- undo an out-of-service change made while it is in use.
    if not p_in_service and v_court.status <> 'maintenance' and (
      v_court.status = 'occupied'
      or exists (
        select 1 from public.court_allocations a
        where a.court_id = v_court.id and a.status = 'playing'
      )
    ) then
      raise exception 'This court is in use. Take it out of service after the session ends.'
        using errcode = '55006';
    end if;
  end if;

  if exists (
    select 1 from public.courts c
    where c.club_id = v_club
      and c.venue_id = p_venue_id
      and lower(c.name) = lower(v_name)
      and c.id is distinct from p_court_id
  ) then
    raise exception 'This venue already has a court with that name' using errcode = '23505';
  end if;

  if p_court_id is null then
    insert into public.courts (club_id, venue_id, name, status, hourly_rate, member_rate)
    values (
      v_club, p_venue_id, v_name,
      case when p_in_service then 'available' else 'maintenance' end::public.court_status,
      p_hourly_rate, p_member_rate
    )
    returning * into v_court;
  else
    -- Putting a court back in service never overrides 'occupied'.
    update public.courts c
    set name = v_name,
        hourly_rate = p_hourly_rate,
        member_rate = p_member_rate,
        status = case
          when not p_in_service then 'maintenance'::public.court_status
          when c.status = 'maintenance' then 'available'::public.court_status
          else c.status
        end
    where c.id = v_court.id
    returning c.* into v_court;
  end if;

  return v_court;
end;
$$;

alter function public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean) owner to postgres;
revoke all on function public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean) to authenticated;

comment on function public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean) is
  'Club admin only: add, rename, re-price (regular and member rate), or take a court in the current club out of service. Never deletes.';
