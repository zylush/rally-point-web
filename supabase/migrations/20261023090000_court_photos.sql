-- Court and location photos.
--
-- Club admins add up to 8 photos to each court and one cover photo to each
-- location (venue). Photos go public as soon as they are saved, on the public
-- "Find a court" pages; only admins of the club can add or remove them.
--
-- Files live in the public Storage bucket "court-photos" under
--   <club id>/courts/<court id>/<random id>.<webp|jpg|png>
--   <club id>/venues/<venue id>/<random id>.<webp|jpg|png>
-- Storage requests do not carry the x-club-id header, so the Storage policies
-- read the club from the file's folder and still require the admin role there.
--
-- public.court_photos records which files are in use and their order. It is a
-- new table outside the reservation-write pause; public.courts is not changed.
-- A hosted apply needs its own approved release.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('public.get_public_club_detail(text)') is null then
    raise exception 'Court photos need the club context and player marketplace migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo records
-- ---------------------------------------------------------------------------

-- court_id NULL means the photo is the location's cover.
create table public.court_photos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  venue_id uuid not null,
  court_id uuid,
  path text not null unique check (char_length(path) <= 300),
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (club_id, venue_id) references public.venues (club_id, id) on delete cascade,
  foreign key (club_id, venue_id, court_id) references public.courts (club_id, venue_id, id) on delete cascade
);

create unique index court_photos_one_cover_per_venue on public.court_photos (venue_id) where court_id is null;
create index court_photos_court_order on public.court_photos (club_id, court_id, position);
-- Covers both foreign keys to venues and courts, in their column order.
create index court_photos_venue on public.court_photos (club_id, venue_id, court_id);
create index court_photos_created_by on public.court_photos (created_by);

alter table public.court_photos enable row level security;
revoke all on table public.court_photos from public, anon, authenticated;
-- Admins read their club's photo list; every write goes through the functions below.
grant select on table public.court_photos to authenticated;
create policy court_photos_admin_read on public.court_photos
  for select to authenticated
  using (private.can_access_club(club_id) and private.current_club_role(club_id) = 'admin');

-- ---------------------------------------------------------------------------
-- Which court or location a Storage path belongs to
-- ---------------------------------------------------------------------------

-- No row when the path is not a well-formed photo path of an existing court or venue.
create or replace function private.court_photo_target(p_name text)
returns table (club_id uuid, venue_id uuid, court_id uuid)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select regexp_match(
      coalesce(p_name, ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(courts|venues)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
    ) as part
  )
  select c.club_id, c.venue_id, c.id
  from m join public.courts c on c.club_id = m.part[1]::uuid and c.id = m.part[3]::uuid
  where m.part[2] = 'courts'
  union all
  select v.club_id, v.id, null::uuid
  from m join public.venues v on v.club_id = m.part[1]::uuid and v.id = m.part[3]::uuid
  where m.part[2] = 'venues';
$$;

-- True only for admins of the club the path belongs to.
create or replace function private.can_manage_court_photo(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.court_photo_target(p_name) t
    where private.current_club_role(t.club_id) = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket and policies
-- ---------------------------------------------------------------------------

-- Public: anyone can view a photo by its link. Nobody can list the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('court-photos', 'court-photos', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No UPDATE policy: a saved photo is never overwritten, only added or removed.
create policy court_photos_admin_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'court-photos' and private.can_manage_court_photo(name));
create policy court_photos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'court-photos' and private.can_manage_court_photo(name));
create policy court_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'court-photos' and private.can_manage_court_photo(name));

-- ---------------------------------------------------------------------------
-- Admin functions (active club from x-club-id, admin role required)
-- ---------------------------------------------------------------------------

-- Records an uploaded photo as the court's newest photo.
create or replace function public.admin_add_court_photo(p_court_id uuid, p_path text)
returns public.court_photos
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_court public.courts;
  v_photo public.court_photos;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select c.* into v_court from public.courts c where c.id = p_court_id and c.club_id = v_club;
  if not found then
    raise exception 'court not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.court_photo_target(p_path) t
    where t.club_id = v_club and t.court_id = p_court_id
  ) then
    raise exception 'This photo is not in this court''s folder' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'court-photos' and o.name = p_path) then
    raise exception 'Upload the photo first' using errcode = 'P0002';
  end if;

  -- One add at a time per court, so the limit and the order hold.
  perform pg_advisory_xact_lock(hashtextextended('court_photos:' || p_court_id::text, 0));
  if (select count(*) from public.court_photos p where p.court_id = p_court_id) >= 8 then
    raise exception 'A court can have up to 8 photos' using errcode = '22023';
  end if;

  insert into public.court_photos (club_id, venue_id, court_id, path, position)
  values (
    v_club, v_court.venue_id, p_court_id, p_path,
    coalesce((select max(p.position) + 1 from public.court_photos p where p.court_id = p_court_id), 0)
  )
  returning * into v_photo;
  return v_photo;
end;
$$;

-- Moves a photo to the front, so it shows first on the court card.
create or replace function public.admin_make_main_court_photo(p_photo_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_photo public.court_photos;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select p.* into v_photo from public.court_photos p
  where p.id = p_photo_id and p.club_id = v_club and p.court_id is not null;
  if not found then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('court_photos:' || v_photo.court_id::text, 0));
  update public.court_photos p
  set position = (select min(q.position) - 1 from public.court_photos q where q.court_id = v_photo.court_id)
  where p.id = p_photo_id;
end;
$$;

-- Forgets a court photo and returns its path, so the app can delete the file.
create or replace function public.admin_remove_court_photo(p_photo_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_path text;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  delete from public.court_photos p
  where p.id = p_photo_id and p.club_id = v_club and p.court_id is not null
  returning p.path into v_path;
  if v_path is null then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

-- Sets (or with a NULL path, clears) a location's cover photo.
-- Returns the replaced photo's path, if any, so the app can delete the file.
create or replace function public.admin_set_venue_cover(p_venue_id uuid, p_path text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_old text;
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_club) then
    raise exception 'venue not found' using errcode = 'P0002';
  end if;
  if p_path is not null then
    if not exists (
      select 1 from private.court_photo_target(p_path) t
      where t.club_id = v_club and t.venue_id = p_venue_id and t.court_id is null
    ) then
      raise exception 'This photo is not in this location''s folder' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'court-photos' and o.name = p_path) then
      raise exception 'Upload the photo first' using errcode = 'P0002';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('court_photos:' || p_venue_id::text, 0));
  delete from public.court_photos p
  where p.venue_id = p_venue_id and p.club_id = v_club and p.court_id is null
  returning p.path into v_old;
  if p_path is not null then
    insert into public.court_photos (club_id, venue_id, court_id, path)
    values (v_club, p_venue_id, null, p_path);
  end if;
  return v_old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public pages
-- ---------------------------------------------------------------------------

-- The club page now also lists each location's cover and each court's photos (paths, in order).
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

-- One picture per club for the "Find a court" list: the first active location's
-- cover, else the main photo of its first court. Same clubs as list_public_clubs.
create or replace function public.list_public_club_covers()
returns table (slug text, cover_photo text)
language sql stable security definer set search_path = ''
as $$
  select c.slug,
         coalesce(
           (select p.path from public.court_photos p
              join public.venues v on v.club_id = p.club_id and v.id = p.venue_id
            where p.club_id = c.id and p.court_id is null and v.is_active
            order by v.name limit 1),
           (select p.path from public.court_photos p
              join public.venues v on v.club_id = p.club_id and v.id = p.venue_id
              join public.courts ct on ct.club_id = p.club_id and ct.id = p.court_id
            where p.club_id = c.id and v.is_active
            order by v.name, ct.name, p.position, p.created_at limit 1)
         )
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.is_active and a.status = 'active'
    and exists (select 1 from public.venues v where v.club_id = c.id and v.is_active);
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function private.court_photo_target(text) owner to postgres;
alter function private.can_manage_court_photo(text) owner to postgres;
alter function public.admin_add_court_photo(uuid, text) owner to postgres;
alter function public.admin_make_main_court_photo(uuid) owner to postgres;
alter function public.admin_remove_court_photo(uuid) owner to postgres;
alter function public.admin_set_venue_cover(uuid, text) owner to postgres;
alter function public.get_public_club_detail(text) owner to postgres;
alter function public.list_public_club_covers() owner to postgres;

revoke all on function private.court_photo_target(text) from public, anon, authenticated;
revoke all on function private.can_manage_court_photo(text) from public, anon;
-- Storage policies run as the caller, so signed-in users need to call the check.
grant execute on function private.can_manage_court_photo(text) to authenticated;

revoke all on function public.admin_add_court_photo(uuid, text) from public, anon;
revoke all on function public.admin_make_main_court_photo(uuid) from public, anon;
revoke all on function public.admin_remove_court_photo(uuid) from public, anon;
revoke all on function public.admin_set_venue_cover(uuid, text) from public, anon;
grant execute on function public.admin_add_court_photo(uuid, text) to authenticated;
grant execute on function public.admin_make_main_court_photo(uuid) to authenticated;
grant execute on function public.admin_remove_court_photo(uuid) to authenticated;
grant execute on function public.admin_set_venue_cover(uuid, text) to authenticated;

-- Like list_public_clubs: open to visitors.
revoke all on function public.get_public_club_detail(text) from public;
revoke all on function public.list_public_club_covers() from public;
grant execute on function public.get_public_club_detail(text) to anon, authenticated;
grant execute on function public.list_public_club_covers() to anon, authenticated;
