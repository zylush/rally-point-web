-- Club business profile: what a club (the venue owner) tells players.
--
-- Club admins fill this in on the "Business profile" screen:
--   * About text, a public phone and email, and links to the club's Facebook
--     page, Messenger, Instagram and website. Facebook, Messenger and Instagram
--     links must point at those sites, and every link must use https.
--   * Amenities, picked from a fixed list.
--   * How to pay the club directly: payment methods (GCash, Maya, a bank, cash
--     at the desk) with an account name, an optional account number and an
--     optional QR code picture, plus a payment note. Rally Point does not take,
--     hold or check these payments.
--   * House rules, a cancellation and refund policy, and terms and conditions.
--   * Add-ons the club offers (paddle rental, balls, towels) with a price. They
--     are shown on the club page only. Nothing charges for them yet, because the
--     booking and desk functions are paused.
--   * Coaches, with an optional photo, rate, and contact the coach agreed to
--     share. Coaches are not linked to member records.
--   * A photo gallery of the club (up to 12 photos).
--
-- Everything is public on the club page once saved, except inactive add-ons,
-- coaches and payment methods. Only admins of the club can change it, and only
-- through the admin_* functions below: the new tables have no direct API access.
--
-- Pictures go in the existing public "court-photos" bucket, in new folders:
--   <club id>/gallery/<random id>.<webp|jpg|png>
--   <club id>/payment/<random id>.<webp|jpg|png>
--   <club id>/coaches/<random id>.<webp|jpg|png>
-- The court and location photo policies are unchanged. New policies cover the
-- new folders and also require the admin role in the folder's club.
-- admin_unused_club_pictures lists the club's files that nothing uses any more
-- (in the new folders and the court and location folders), so the admin's app
-- can delete them through Storage.
--
-- Opening hours need no change here: admin_upsert_venue already saves them and
-- the venues table already checks them (0 to 24, closing after opening).
--
-- New tables only. Nothing inside the reservation-write pause changes, and
-- get_public_club_detail is untouched. A hosted apply needs its own approved
-- release, and backups must cover the stored pictures first.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regclass('public.club_accounts') is null
     or not exists (select 1 from storage.buckets where id = 'court-photos') then
    raise exception 'The club business profile needs the club platform and court photos migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per club. A NULL field is simply not shown.
create table public.club_profiles (
  club_id uuid primary key references public.clubs (id) on delete cascade,
  about text constraint club_profiles_about_check check (char_length(about) between 1 and 1500),
  phone text constraint club_profiles_phone_check check (phone ~ '^\+?[0-9 ()-]{7,24}$'),
  email text constraint club_profiles_email_check
    check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  facebook_url text constraint club_profiles_facebook_check
    check (char_length(facebook_url) <= 300
           and facebook_url ~* '^https://([a-z0-9-]+\.)?(facebook\.com|fb\.com|fb\.me)([/?#][^[:space:]]*)?$'),
  messenger_url text constraint club_profiles_messenger_check
    check (char_length(messenger_url) <= 300
           and messenger_url ~* '^https://([a-z0-9-]+\.)?(m\.me|messenger\.com)([/?#][^[:space:]]*)?$'),
  instagram_url text constraint club_profiles_instagram_check
    check (char_length(instagram_url) <= 300
           and instagram_url ~* '^https://([a-z0-9-]+\.)?instagram\.com([/?#][^[:space:]]*)?$'),
  -- A web address by name: labels of letters, digits and inner hyphens, ending in a
  -- letter domain (or an xn-- one). No IP addresses and no port numbers.
  website_url text constraint club_profiles_website_check
    check (char_length(website_url) <= 300
           and website_url ~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})([/?#][^[:space:]]*)?$'),
  amenities text[] not null default '{}'::text[] constraint club_profiles_amenities_check
    check (amenities <@ array[
      'parking', 'restrooms', 'showers', 'lockers', 'drinking_water', 'wifi', 'seating',
      'canteen', 'pro_shop', 'covered_courts', 'night_lights', 'air_conditioning', 'first_aid'
    ]::text[]),
  payment_note text constraint club_profiles_payment_note_check check (char_length(payment_note) between 1 and 600),
  house_rules text constraint club_profiles_house_rules_check check (char_length(house_rules) between 1 and 3000),
  cancellation_policy text constraint club_profiles_cancellation_check check (char_length(cancellation_policy) between 1 and 2000),
  terms text constraint club_profiles_terms_check check (char_length(terms) between 1 and 6000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index club_profiles_updated_by on public.club_profiles (updated_by);

create table public.club_addons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null constraint club_addons_name_check check (char_length(name) between 1 and 60),
  description text constraint club_addons_description_check check (char_length(description) between 1 and 200),
  price numeric(12,2) not null constraint club_addons_price_check check (price >= 0 and price <= 100000),
  unit text not null constraint club_addons_unit_check
    check (unit in ('per_hour', 'per_booking', 'per_item', 'per_person')),
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Also covers the foreign key to clubs.
create unique index club_addons_name_unique on public.club_addons (club_id, lower(name));

create table public.club_coaches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  full_name text not null constraint club_coaches_name_check check (char_length(full_name) between 1 and 80),
  headline text constraint club_coaches_headline_check check (char_length(headline) between 1 and 120),
  bio text constraint club_coaches_bio_check check (char_length(bio) between 1 and 1000),
  hourly_rate numeric(12,2) constraint club_coaches_rate_check check (hourly_rate >= 0 and hourly_rate <= 100000),
  contact_phone text constraint club_coaches_phone_check check (contact_phone ~ '^\+?[0-9 ()-]{7,24}$'),
  contact_url text constraint club_coaches_link_check
    check (char_length(contact_url) <= 300
           and contact_url ~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})([/?#][^[:space:]]*)?$'),
  photo_path text unique check (char_length(photo_path) <= 300),
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index club_coaches_club_order on public.club_coaches (club_id, position);

create table public.club_payment_methods (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  label text not null constraint club_payment_methods_label_check check (char_length(label) between 1 and 40),
  account_name text constraint club_payment_methods_account_name_check check (char_length(account_name) between 1 and 80),
  account_number text constraint club_payment_methods_account_number_check check (char_length(account_number) between 1 and 60),
  qr_path text unique check (char_length(qr_path) <= 300),
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index club_payment_methods_club_order on public.club_payment_methods (club_id, position);

create table public.club_gallery_photos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  caption text constraint club_gallery_photos_caption_check check (char_length(caption) between 1 and 120),
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index club_gallery_photos_club_order on public.club_gallery_photos (club_id, position);
create index club_gallery_photos_created_by on public.club_gallery_photos (created_by);

-- No direct access for any API role: every read and write goes through the functions below.
alter table public.club_profiles enable row level security;
alter table public.club_addons enable row level security;
alter table public.club_coaches enable row level security;
alter table public.club_payment_methods enable row level security;
alter table public.club_gallery_photos enable row level security;
revoke all on table public.club_profiles from public, anon, authenticated;
revoke all on table public.club_addons from public, anon, authenticated;
revoke all on table public.club_coaches from public, anon, authenticated;
revoke all on table public.club_payment_methods from public, anon, authenticated;
revoke all on table public.club_gallery_photos from public, anon, authenticated;
-- Say so with explicit deny policies, like the platform tables (Supabase lint 0008).
create policy no_direct_api_access on public.club_profiles
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_addons
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_coaches
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_payment_methods
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_gallery_photos
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The active club, when the caller is its admin; otherwise an error.
create or replace function private.require_club_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if v_club is null or private.current_club_role(v_club) is distinct from 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return v_club;
end;
$$;

-- A plain-English message for each check above, so admins see what to fix.
create or replace function private.club_profile_message(p_constraint text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_constraint
    when 'club_profiles_about_check' then 'About the club is limited to 1,500 characters'
    when 'club_profiles_phone_check' then 'Enter a phone number using digits, spaces, +, ( ) and -'
    when 'club_profiles_email_check' then 'Enter a valid email address'
    when 'club_profiles_facebook_check' then 'The Facebook link must start with https://facebook.com/ or https://fb.com/'
    when 'club_profiles_messenger_check' then 'The Messenger link must start with https://m.me/'
    when 'club_profiles_instagram_check' then 'The Instagram link must start with https://instagram.com/'
    when 'club_profiles_website_check' then 'The website link must start with https:// and name a web address, like https://yourclub.ph'
    when 'club_profiles_amenities_check' then 'Pick amenities from the list'
    when 'club_profiles_payment_note_check' then 'The payment note is limited to 600 characters'
    when 'club_profiles_house_rules_check' then 'House rules are limited to 3,000 characters'
    when 'club_profiles_cancellation_check' then 'The cancellation policy is limited to 2,000 characters'
    when 'club_profiles_terms_check' then 'Terms and conditions are limited to 6,000 characters'
    when 'club_addons_name_check' then 'Add-on name must be 1 to 60 characters'
    when 'club_addons_description_check' then 'Add-on description is limited to 200 characters'
    when 'club_coaches_name_check' then 'Coach name must be 1 to 80 characters'
    when 'club_coaches_headline_check' then 'The coach''s short line is limited to 120 characters'
    when 'club_coaches_bio_check' then 'The coach''s bio is limited to 1,000 characters'
    when 'club_coaches_phone_check' then 'Enter the coach''s phone number using digits, spaces, +, ( ) and -'
    when 'club_coaches_link_check' then 'The coach''s link must start with https:// and name a web address, like https://m.me/coachana'
    when 'club_payment_methods_label_check' then 'Payment method name must be 1 to 40 characters'
    when 'club_payment_methods_account_name_check' then 'Account name is limited to 80 characters'
    when 'club_payment_methods_account_number_check' then 'Account number is limited to 60 characters'
    when 'club_gallery_photos_caption_check' then 'Photo caption is limited to 120 characters'
    else 'Check the details and try again'
  end;
$$;

-- No row when the path is not a well-formed club picture path of an existing club.
create or replace function private.club_media_target(p_name text)
returns table (club_id uuid, folder text)
language sql stable security definer set search_path = ''
as $$
  select c.id, m.part[2]
  from (
    select regexp_match(
      coalesce(p_name, ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(gallery|payment|coaches)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
    ) as part
  ) m
  join public.clubs c on c.id = m.part[1]::uuid;
$$;

-- True only for admins of the club the path belongs to.
create or replace function private.can_manage_club_media(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.club_media_target(p_name) t
    where private.current_club_role(t.club_id) = 'admin'
  );
$$;

-- Checks that an uploaded picture sits in this club's folder of the right kind.
create or replace function private.require_club_media(p_club uuid, p_folder text, p_path text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.club_media_target(p_path) t
    where t.club_id = p_club and t.folder = p_folder
  ) then
    raise exception 'This picture is not in this club''s % folder', p_folder using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'court-photos' and o.name = p_path) then
    raise exception 'Upload the picture first' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage policies for the new folders (no UPDATE: pictures are never overwritten)
-- ---------------------------------------------------------------------------

create policy club_media_admin_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'court-photos' and private.can_manage_club_media(name));
create policy club_media_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'court-photos' and private.can_manage_club_media(name));
create policy club_media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'court-photos' and private.can_manage_club_media(name));

-- ---------------------------------------------------------------------------
-- Admin functions (active club from x-club-id, admin role required)
-- ---------------------------------------------------------------------------

-- Everything on the profile screen, including inactive items, for the active club.
create or replace function public.admin_club_profile()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  return jsonb_build_object(
    'profile', (select to_jsonb(p) - 'updated_by' from public.club_profiles p where p.club_id = v_club),
    'addons', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.position, a.created_at)
      from public.club_addons a where a.club_id = v_club
    ), '[]'::jsonb),
    'coaches', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.position, c.created_at)
      from public.club_coaches c where c.club_id = v_club
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.position, m.created_at)
      from public.club_payment_methods m where m.club_id = v_club
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(to_jsonb(g) - 'created_by' order by g.position, g.created_at)
      from public.club_gallery_photos g where g.club_id = v_club
    ), '[]'::jsonb)
  );
end;
$$;

-- Saves the whole profile. Empty text clears a field.
create or replace function public.admin_update_club_profile(
  p_about text,
  p_phone text,
  p_email text,
  p_facebook_url text,
  p_messenger_url text,
  p_instagram_url text,
  p_website_url text,
  p_amenities text[],
  p_payment_note text,
  p_house_rules text,
  p_cancellation_policy text,
  p_terms text
)
returns public.club_profiles
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_row public.club_profiles;
  v_constraint text;
begin
  insert into public.club_profiles as p (
    club_id, about, phone, email, facebook_url, messenger_url, instagram_url, website_url,
    amenities, payment_note, house_rules, cancellation_policy, terms, updated_by, updated_at
  )
  values (
    v_club,
    nullif(btrim(p_about), ''),
    nullif(btrim(p_phone), ''),
    lower(nullif(btrim(p_email), '')),
    nullif(btrim(p_facebook_url), ''),
    nullif(btrim(p_messenger_url), ''),
    nullif(btrim(p_instagram_url), ''),
    nullif(btrim(p_website_url), ''),
    array(select distinct x from unnest(coalesce(p_amenities, '{}'::text[])) x order by x),
    nullif(btrim(p_payment_note), ''),
    nullif(btrim(p_house_rules), ''),
    nullif(btrim(p_cancellation_policy), ''),
    nullif(btrim(p_terms), ''),
    auth.uid(),
    now()
  )
  on conflict (club_id) do update
    set about = excluded.about,
        phone = excluded.phone,
        email = excluded.email,
        facebook_url = excluded.facebook_url,
        messenger_url = excluded.messenger_url,
        instagram_url = excluded.instagram_url,
        website_url = excluded.website_url,
        amenities = excluded.amenities,
        payment_note = excluded.payment_note,
        house_rules = excluded.house_rules,
        cancellation_policy = excluded.cancellation_policy,
        terms = excluded.terms,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning p.* into v_row;
  return v_row;
exception when check_violation then
  get stacked diagnostics v_constraint = constraint_name;
  raise exception '%', private.club_profile_message(v_constraint) using errcode = '22023';
end;
$$;

-- Adds (p_addon_id NULL) or changes an add-on. Up to 30 per club.
create or replace function public.admin_upsert_club_addon(
  p_addon_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_unit text,
  p_is_active boolean
)
returns public.club_addons
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_row public.club_addons;
  v_constraint text;
begin
  if p_price is null or p_price < 0 or p_price > 100000 or p_price <> round(p_price, 2) then
    raise exception 'Price must be between 0 and 100,000 pesos' using errcode = '22023';
  end if;
  if p_unit is null or p_unit not in ('per_hour', 'per_booking', 'per_item', 'per_person') then
    raise exception 'Choose how the price is charged' using errcode = '22023';
  end if;

  if p_addon_id is null then
    perform pg_advisory_xact_lock(hashtextextended('club_addons:' || v_club::text, 0));
    if (select count(*) from public.club_addons a where a.club_id = v_club) >= 30 then
      raise exception 'A club can list up to 30 add-ons' using errcode = '22023';
    end if;
    insert into public.club_addons (club_id, name, description, price, unit, is_active, position)
    values (
      v_club, btrim(coalesce(p_name, '')), nullif(btrim(p_description), ''), p_price, p_unit,
      coalesce(p_is_active, true),
      coalesce((select max(a.position) + 1 from public.club_addons a where a.club_id = v_club), 0)
    )
    returning * into v_row;
  else
    update public.club_addons a
    set name = btrim(coalesce(p_name, '')),
        description = nullif(btrim(p_description), ''),
        price = p_price,
        unit = p_unit,
        is_active = coalesce(p_is_active, a.is_active),
        updated_at = now()
    where a.id = p_addon_id and a.club_id = v_club
    returning a.* into v_row;
    if v_row.id is null then
      raise exception 'add-on not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.club_profile_message(v_constraint) using errcode = '22023';
  when unique_violation then
    raise exception 'This club already has an add-on with that name' using errcode = '23505';
end;
$$;

create or replace function public.admin_remove_club_addon(p_addon_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  delete from public.club_addons a where a.id = p_addon_id and a.club_id = v_club;
  if not found then
    raise exception 'add-on not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Adds (p_coach_id NULL) or changes a coach. Up to 30 per club.
create or replace function public.admin_upsert_club_coach(
  p_coach_id uuid,
  p_full_name text,
  p_headline text,
  p_bio text,
  p_hourly_rate numeric,
  p_contact_phone text,
  p_contact_url text,
  p_is_active boolean
)
returns public.club_coaches
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_row public.club_coaches;
  v_constraint text;
begin
  if p_hourly_rate is not null and (
    p_hourly_rate < 0 or p_hourly_rate > 100000 or p_hourly_rate <> round(p_hourly_rate, 2)
  ) then
    raise exception 'Coach rate must be between 0 and 100,000 pesos' using errcode = '22023';
  end if;

  if p_coach_id is null then
    perform pg_advisory_xact_lock(hashtextextended('club_coaches:' || v_club::text, 0));
    if (select count(*) from public.club_coaches c where c.club_id = v_club) >= 30 then
      raise exception 'A club can list up to 30 coaches' using errcode = '22023';
    end if;
    insert into public.club_coaches (
      club_id, full_name, headline, bio, hourly_rate, contact_phone, contact_url, is_active, position
    )
    values (
      v_club, btrim(coalesce(p_full_name, '')), nullif(btrim(p_headline), ''), nullif(btrim(p_bio), ''),
      p_hourly_rate, nullif(btrim(p_contact_phone), ''), nullif(btrim(p_contact_url), ''),
      coalesce(p_is_active, true),
      coalesce((select max(c.position) + 1 from public.club_coaches c where c.club_id = v_club), 0)
    )
    returning * into v_row;
  else
    update public.club_coaches c
    set full_name = btrim(coalesce(p_full_name, '')),
        headline = nullif(btrim(p_headline), ''),
        bio = nullif(btrim(p_bio), ''),
        hourly_rate = p_hourly_rate,
        contact_phone = nullif(btrim(p_contact_phone), ''),
        contact_url = nullif(btrim(p_contact_url), ''),
        is_active = coalesce(p_is_active, c.is_active),
        updated_at = now()
    where c.id = p_coach_id and c.club_id = v_club
    returning c.* into v_row;
    if v_row.id is null then
      raise exception 'coach not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
exception when check_violation then
  get stacked diagnostics v_constraint = constraint_name;
  raise exception '%', private.club_profile_message(v_constraint) using errcode = '22023';
end;
$$;

-- Sets (or with a NULL path, clears) a coach's photo. Returns the replaced path, if any,
-- so the app can delete that file. Setting the same path again replaces nothing, so it
-- returns NULL: a repeated request must never hand back the file that is now in use.
create or replace function public.admin_set_club_coach_photo(p_coach_id uuid, p_path text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_old text;
begin
  select c.photo_path into v_old from public.club_coaches c
  where c.id = p_coach_id and c.club_id = v_club
  for update;
  if not found then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;
  if p_path is not null then
    perform private.require_club_media(v_club, 'coaches', p_path);
  end if;
  update public.club_coaches c set photo_path = p_path, updated_at = now() where c.id = p_coach_id;
  return case when v_old is distinct from p_path then v_old end;
exception when unique_violation then
  raise exception 'This picture is already in use. Upload it again.' using errcode = '23505';
end;
$$;

-- Removes a coach and returns their photo's path, if any, so the app can delete the file.
create or replace function public.admin_remove_club_coach(p_coach_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_path text;
begin
  delete from public.club_coaches c where c.id = p_coach_id and c.club_id = v_club
  returning c.photo_path into v_path;
  if not found then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

-- Adds (p_method_id NULL) or changes a way to pay the club. Up to 6 per club.
create or replace function public.admin_upsert_club_payment_method(
  p_method_id uuid,
  p_label text,
  p_account_name text,
  p_account_number text,
  p_is_active boolean
)
returns public.club_payment_methods
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_row public.club_payment_methods;
  v_constraint text;
begin
  if p_method_id is null then
    perform pg_advisory_xact_lock(hashtextextended('club_payment_methods:' || v_club::text, 0));
    if (select count(*) from public.club_payment_methods m where m.club_id = v_club) >= 6 then
      raise exception 'A club can list up to 6 payment methods' using errcode = '22023';
    end if;
    insert into public.club_payment_methods (club_id, label, account_name, account_number, is_active, position)
    values (
      v_club, btrim(coalesce(p_label, '')), nullif(btrim(p_account_name), ''), nullif(btrim(p_account_number), ''),
      coalesce(p_is_active, true),
      coalesce((select max(m.position) + 1 from public.club_payment_methods m where m.club_id = v_club), 0)
    )
    returning * into v_row;
  else
    update public.club_payment_methods m
    set label = btrim(coalesce(p_label, '')),
        account_name = nullif(btrim(p_account_name), ''),
        account_number = nullif(btrim(p_account_number), ''),
        is_active = coalesce(p_is_active, m.is_active),
        updated_at = now()
    where m.id = p_method_id and m.club_id = v_club
    returning m.* into v_row;
    if v_row.id is null then
      raise exception 'payment method not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
exception when check_violation then
  get stacked diagnostics v_constraint = constraint_name;
  raise exception '%', private.club_profile_message(v_constraint) using errcode = '22023';
end;
$$;

-- Sets (or with a NULL path, clears) a payment method's QR code. Returns the replaced path,
-- or NULL when the same path is set again (see admin_set_club_coach_photo).
create or replace function public.admin_set_club_payment_qr(p_method_id uuid, p_path text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_old text;
begin
  select m.qr_path into v_old from public.club_payment_methods m
  where m.id = p_method_id and m.club_id = v_club
  for update;
  if not found then
    raise exception 'payment method not found' using errcode = 'P0002';
  end if;
  if p_path is not null then
    perform private.require_club_media(v_club, 'payment', p_path);
  end if;
  update public.club_payment_methods m set qr_path = p_path, updated_at = now() where m.id = p_method_id;
  return case when v_old is distinct from p_path then v_old end;
exception when unique_violation then
  raise exception 'This picture is already in use. Upload it again.' using errcode = '23505';
end;
$$;

-- Removes a payment method and returns its QR code's path, if any.
create or replace function public.admin_remove_club_payment_method(p_method_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_path text;
begin
  delete from public.club_payment_methods m where m.id = p_method_id and m.club_id = v_club
  returning m.qr_path into v_path;
  if not found then
    raise exception 'payment method not found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

-- Records an uploaded gallery photo as the newest. Up to 12 per club.
create or replace function public.admin_add_club_photo(p_path text, p_caption text)
returns public.club_gallery_photos
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_row public.club_gallery_photos;
  v_constraint text;
begin
  perform private.require_club_media(v_club, 'gallery', p_path);
  perform pg_advisory_xact_lock(hashtextextended('club_gallery_photos:' || v_club::text, 0));
  if (select count(*) from public.club_gallery_photos g where g.club_id = v_club) >= 12 then
    raise exception 'The gallery holds up to 12 photos' using errcode = '22023';
  end if;
  insert into public.club_gallery_photos (club_id, path, caption, position)
  values (
    v_club, p_path, nullif(btrim(p_caption), ''),
    coalesce((select max(g.position) + 1 from public.club_gallery_photos g where g.club_id = v_club), 0)
  )
  returning * into v_row;
  return v_row;
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.club_profile_message(v_constraint) using errcode = '22023';
  when unique_violation then
    raise exception 'This picture is already in use. Upload it again.' using errcode = '23505';
end;
$$;

-- Forgets a gallery photo and returns its path, so the app can delete the file.
create or replace function public.admin_remove_club_photo(p_photo_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_path text;
begin
  delete from public.club_gallery_photos g where g.id = p_photo_id and g.club_id = v_club
  returning g.path into v_path;
  if not found then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

-- The active club's picture files that nothing uses any more: files whose delete failed,
-- and uploads that were never saved. Covers every column that keeps a path in this
-- bucket (court and location photos, coach photos, QR codes, gallery photos). Files from
-- the last hour are left out, so an upload still being saved is never listed, and only
-- files the admin may delete through Storage are listed. Up to 200, oldest first.
-- SQL cannot delete Storage files (storage.objects refuses direct deletes), so the app
-- deletes these through Storage, under the admin delete policies.
create or replace function public.admin_unused_club_pictures()
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  return coalesce((
    select array_agg(u.name order by u.created_at, u.name)
    from (
      select o.name, o.created_at
      from storage.objects o
      where o.bucket_id = 'court-photos'
        and o.name like v_club::text || '/%'
        and o.created_at < now() - interval '1 hour'
        and not exists (select 1 from public.court_photos p where p.path = o.name)
        and not exists (select 1 from public.club_coaches c where c.photo_path = o.name)
        and not exists (select 1 from public.club_payment_methods m where m.qr_path = o.name)
        and not exists (select 1 from public.club_gallery_photos g where g.path = o.name)
        and (
          exists (select 1 from private.club_media_target(o.name) t where t.club_id = v_club)
          or exists (select 1 from private.court_photo_target(o.name) t where t.club_id = v_club)
        )
      order by o.created_at, o.name
      limit 200
    ) u
  ), '{}'::text[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public club page
-- ---------------------------------------------------------------------------

-- The public part of one active club's profile, or NULL when the slug is not an
-- active club. Same clubs as get_public_club_detail. Inactive items are left out.
create or replace function public.get_public_club_profile(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'about', p.about,
    'phone', p.phone,
    'email', p.email,
    'facebook_url', p.facebook_url,
    'messenger_url', p.messenger_url,
    'instagram_url', p.instagram_url,
    'website_url', p.website_url,
    'amenities', coalesce(to_jsonb(p.amenities), '[]'::jsonb),
    'payment_note', p.payment_note,
    'house_rules', p.house_rules,
    'cancellation_policy', p.cancellation_policy,
    'terms', p.terms,
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'label', m.label, 'account_name', m.account_name,
        'account_number', m.account_number, 'qr_path', m.qr_path
      ) order by m.position, m.created_at)
      from public.club_payment_methods m where m.club_id = c.id and m.is_active
    ), '[]'::jsonb),
    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'description', a.description, 'price', a.price, 'unit', a.unit
      ) order by a.position, a.created_at)
      from public.club_addons a where a.club_id = c.id and a.is_active
    ), '[]'::jsonb),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', co.id, 'full_name', co.full_name, 'headline', co.headline, 'bio', co.bio,
        'hourly_rate', co.hourly_rate, 'contact_phone', co.contact_phone,
        'contact_url', co.contact_url, 'photo_path', co.photo_path
      ) order by co.position, co.created_at)
      from public.club_coaches co where co.club_id = c.id and co.is_active
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'path', g.path, 'caption', g.caption)
        order by g.position, g.created_at)
      from public.club_gallery_photos g where g.club_id = c.id
    ), '[]'::jsonb)
  )
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  left join public.club_profiles p on p.club_id = c.id
  where c.slug = lower(btrim(p_slug)) and c.is_active and a.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function private.require_club_admin() owner to postgres;
alter function private.club_profile_message(text) owner to postgres;
alter function private.club_media_target(text) owner to postgres;
alter function private.can_manage_club_media(text) owner to postgres;
alter function private.require_club_media(uuid, text, text) owner to postgres;
alter function public.admin_club_profile() owner to postgres;
alter function public.admin_update_club_profile(text, text, text, text, text, text, text, text[], text, text, text, text) owner to postgres;
alter function public.admin_upsert_club_addon(uuid, text, text, numeric, text, boolean) owner to postgres;
alter function public.admin_remove_club_addon(uuid) owner to postgres;
alter function public.admin_upsert_club_coach(uuid, text, text, text, numeric, text, text, boolean) owner to postgres;
alter function public.admin_set_club_coach_photo(uuid, text) owner to postgres;
alter function public.admin_remove_club_coach(uuid) owner to postgres;
alter function public.admin_upsert_club_payment_method(uuid, text, text, text, boolean) owner to postgres;
alter function public.admin_set_club_payment_qr(uuid, text) owner to postgres;
alter function public.admin_remove_club_payment_method(uuid) owner to postgres;
alter function public.admin_add_club_photo(text, text) owner to postgres;
alter function public.admin_remove_club_photo(uuid) owner to postgres;
alter function public.admin_unused_club_pictures() owner to postgres;
alter function public.get_public_club_profile(text) owner to postgres;

revoke all on function private.require_club_admin() from public, anon, authenticated;
revoke all on function private.club_profile_message(text) from public, anon, authenticated;
revoke all on function private.club_media_target(text) from public, anon, authenticated;
revoke all on function private.require_club_media(uuid, text, text) from public, anon, authenticated;
revoke all on function private.can_manage_club_media(text) from public, anon;
-- Storage policies run as the caller, so signed-in users need to call the check.
grant execute on function private.can_manage_club_media(text) to authenticated;

revoke all on function public.admin_club_profile() from public, anon;
revoke all on function public.admin_update_club_profile(text, text, text, text, text, text, text, text[], text, text, text, text) from public, anon;
revoke all on function public.admin_upsert_club_addon(uuid, text, text, numeric, text, boolean) from public, anon;
revoke all on function public.admin_remove_club_addon(uuid) from public, anon;
revoke all on function public.admin_upsert_club_coach(uuid, text, text, text, numeric, text, text, boolean) from public, anon;
revoke all on function public.admin_set_club_coach_photo(uuid, text) from public, anon;
revoke all on function public.admin_remove_club_coach(uuid) from public, anon;
revoke all on function public.admin_upsert_club_payment_method(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.admin_set_club_payment_qr(uuid, text) from public, anon;
revoke all on function public.admin_remove_club_payment_method(uuid) from public, anon;
revoke all on function public.admin_add_club_photo(text, text) from public, anon;
revoke all on function public.admin_remove_club_photo(uuid) from public, anon;
revoke all on function public.admin_unused_club_pictures() from public, anon;
grant execute on function public.admin_club_profile() to authenticated;
grant execute on function public.admin_update_club_profile(text, text, text, text, text, text, text, text[], text, text, text, text) to authenticated;
grant execute on function public.admin_upsert_club_addon(uuid, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.admin_remove_club_addon(uuid) to authenticated;
grant execute on function public.admin_upsert_club_coach(uuid, text, text, text, numeric, text, text, boolean) to authenticated;
grant execute on function public.admin_set_club_coach_photo(uuid, text) to authenticated;
grant execute on function public.admin_remove_club_coach(uuid) to authenticated;
grant execute on function public.admin_upsert_club_payment_method(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_set_club_payment_qr(uuid, text) to authenticated;
grant execute on function public.admin_remove_club_payment_method(uuid) to authenticated;
grant execute on function public.admin_add_club_photo(text, text) to authenticated;
grant execute on function public.admin_remove_club_photo(uuid) to authenticated;
grant execute on function public.admin_unused_club_pictures() to authenticated;

-- Like get_public_club_detail: open to visitors.
revoke all on function public.get_public_club_profile(text) from public;
grant execute on function public.get_public_club_profile(text) to anon, authenticated;

comment on table public.club_profiles is
  'A club''s public business profile: about, contacts, links, amenities, payment note, rules and terms. Written only through admin_update_club_profile.';
comment on table public.club_addons is
  'Extras a club offers (paddle rental and the like). Shown on the club page only; nothing charges for them yet.';
comment on table public.club_coaches is
  'A club''s coaches as the club lists them. Not linked to member records.';
comment on table public.club_payment_methods is
  'Ways to pay the club directly. Rally Point does not take, hold or check these payments.';
comment on table public.club_gallery_photos is
  'The club''s own photo gallery, stored under <club id>/gallery/ in the court-photos bucket.';
