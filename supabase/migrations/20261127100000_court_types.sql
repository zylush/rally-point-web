-- Indoor and outdoor courts.
--
-- Each court is indoor or outdoor, or not set (NULL) until a club admin picks. Existing courts
-- start not set. Prices stay per court. Admins set the type with admin_set_court_type, so
-- admin_upsert_court keeps its signature. The public club page returns each court's type, and
-- list_public_club_court_types gives the Find a court list its indoor and outdoor counts, the way
-- list_public_club_covers gives it photos. Nothing in the reservation-write pause changes: courts
-- stay closed to direct API writes and no paused function is touched.

do $$
begin
  if to_regprocedure('public.admin_upsert_court(uuid, uuid, text, numeric, numeric, boolean)') is null
     or to_regprocedure('public.list_public_club_covers()') is null then
    raise exception 'Apply 20261022090000_admin_court_management.sql and 20261023090000_court_photos.sql first';
  end if;
end;
$$;

alter table public.courts add column court_type text;
alter table public.courts
  add constraint courts_court_type_check check (court_type is null or court_type in ('indoor', 'outdoor'));

comment on column public.courts.court_type is
  'indoor or outdoor; NULL until a club admin sets it.';

-- ---------------------------------------------------------------------------
-- Admins set a court's type
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_court_type(p_court_id uuid, p_court_type text)
returns public.courts
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_type text := nullif(lower(btrim(coalesce(p_court_type, ''))), '');
  v_court public.courts;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if v_type is not null and v_type not in ('indoor', 'outdoor') then
    raise exception 'Choose indoor or outdoor' using errcode = '22023';
  end if;

  update public.courts c
  set court_type = v_type
  where c.id = p_court_id and c.club_id = v_club
  returning c.* into v_court;
  if not found then
    raise exception 'court not found' using errcode = 'P0002';
  end if;

  return v_court;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public reads
-- ---------------------------------------------------------------------------

-- Same as in 20261023090000_court_photos.sql, plus each court's court_type.
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
        'cover_photo', (
          select p.path from public.court_photos p
          where p.club_id = c.id and p.venue_id = v.id and p.court_id is null
        ),
        'courts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ct.id,
            'name', ct.name,
            'hourly_rate', ct.hourly_rate,
            'member_rate', ct.member_rate,
            'in_service', ct.status <> 'maintenance',
            'court_type', ct.court_type,
            'photos', coalesce((
              select jsonb_agg(p.path order by p.position, p.created_at)
              from public.court_photos p
              where p.club_id = c.id and p.court_id = ct.id
            ), '[]'::jsonb)
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

-- Indoor and outdoor court counts per club for the "Find a court" list: the same clubs as
-- list_public_clubs, counting in-service courts at active locations, as its court_count does.
create or replace function public.list_public_club_court_types()
returns table (slug text, indoor_courts integer, outdoor_courts integer)
language sql stable security definer set search_path = ''
as $$
  select c.slug,
         (select count(*)::int from public.courts ct
            join public.venues v on v.club_id = ct.club_id and v.id = ct.venue_id
          where ct.club_id = c.id and v.is_active and ct.status <> 'maintenance'
            and ct.court_type = 'indoor'),
         (select count(*)::int from public.courts ct
            join public.venues v on v.club_id = ct.club_id and v.id = ct.venue_id
          where ct.club_id = c.id and v.is_active and ct.status <> 'maintenance'
            and ct.court_type = 'outdoor')
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.is_active and a.status = 'active'
    and exists (select 1 from public.venues v where v.club_id = c.id and v.is_active);
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function public.admin_set_court_type(uuid, text) owner to postgres;
alter function public.get_public_club_detail(text) owner to postgres;
alter function public.list_public_club_court_types() owner to postgres;

revoke all on function public.admin_set_court_type(uuid, text) from public, anon;
grant execute on function public.admin_set_court_type(uuid, text) to authenticated;

-- Like list_public_clubs and list_public_club_covers: open to visitors.
revoke all on function public.list_public_club_court_types() from public;
grant execute on function public.list_public_club_court_types() to anon, authenticated;

comment on function public.admin_set_court_type(uuid, text) is
  'Club admin only: mark a court in the current club indoor or outdoor, or clear it (NULL).';
