-- Member account: one full name, a nickname and one profile photo.
--
-- A person changes their own account here:
--   * update_my_account sets the full name on their profile and on every club's
--     member card (public.members.full_name), so the desk of each club sees the
--     same name, plus an optional nickname (profiles.nickname) shown in the app,
--     on their check-in passes and to the desk as "Full Name (Nickname)".
--   * set_my_photo records (or clears) their profile photo (profiles.photo_path).
--
-- API roles may only SELECT public.profiles (tenant enforcement), and only their
-- own row, so both writes go through these definer functions.
--
-- Photos live in the new public Storage bucket "member-photos" under
--   <user id>/<random id>.<webp|jpg>
-- Anyone holding a link can view a photo (the owner chose a public bucket; the
-- random id keeps links unguessable). Signed-in people may upload, read and
-- delete files only in their own folder, and nobody may overwrite a file.
-- profiles.photo_path holds the path inside the bucket.
--
-- New columns and functions only. Nothing inside the reservation-write pause
-- changes. A hosted apply needs its own approved release, and backups must copy
-- this bucket's files (knownStorageBuckets in scripts/club-platform-staging.mjs).

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.members'::regclass and conname = 'members_club_user_key'
     )
     or has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'The member profile needs tenant enforcement and the club platform migrations first, with direct profile writes revoked.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column nickname text,
  add column photo_path text;

-- A nickname is 1 to 30 characters with no outer spaces. A photo path sits in the
-- person's own folder and has a random id for its name.
alter table public.profiles
  add constraint profiles_nickname_check
    check (nickname is null or (char_length(nickname) between 1 and 30 and nickname = btrim(nickname))),
  add constraint profiles_photo_path_check
    check (photo_path is null or photo_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(webp|jpg)$'));

comment on column public.profiles.nickname is
  'What the person likes to be called in the app (1 to 30 characters). Set through update_my_account.';
comment on column public.profiles.photo_path is
  'The person''s profile photo in the public member-photos bucket: <user id>/<random id>.<webp|jpg>. Set through set_my_photo.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Trims the text and turns every run of spaces, tabs or new lines into one space.
create or replace function private.tidy_name(p_text text)
returns text
language sql immutable set search_path = ''
as $$
  -- Spaces of any kind become one space; control, zero-width and text-direction
  -- characters are dropped, so a name cannot hide or reorder what the desk reads.
  select btrim(regexp_replace(
    regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:space:]]+', ' ', 'g'), '[[:cntrl:]\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]', '', 'g'),
    ' {2,}', ' ', 'g'));
$$;

-- True only for a well-formed photo path in the signed-in person's own folder.
create or replace function private.is_own_member_photo(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce(p_name, '') ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|jpg)$');
$$;

-- Owner decision (2026-11-25): a person keeps at most 3 files in their photo folder:
-- the current photo, its replacement while it is being swapped, and one left over from a
-- clean-up that failed (the app clears leftovers before each upload). It counts as the
-- function owner, so the Storage policy that calls it does not check itself again.
create or replace function private.member_photo_folder_has_room()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and (select count(*) from storage.objects o
          where o.bucket_id = 'member-photos'
            and o.name like auth.uid()::text || '/%') < 3;
$$;

-- A plain-English message for each profile check, so people see what to fix.
create or replace function private.member_profile_message(p_constraint text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_constraint
    when 'profiles_nickname_check' then 'Your nickname is limited to 30 characters'
    when 'profiles_photo_path_check' then 'This photo is not in your folder'
    else 'Check the details and try again'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket and policies
-- ---------------------------------------------------------------------------

-- Public: anyone can view a photo by its link. Nobody can list another person's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No UPDATE policy: a saved photo is never overwritten, only added or removed.
-- The SELECT policy lets an upload return its row and a delete find it; public
-- links are served without it.
create policy member_photos_owner_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'member-photos' and private.is_own_member_photo(name)
              and private.member_photo_folder_has_room());
create policy member_photos_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'member-photos' and private.is_own_member_photo(name));
create policy member_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'member-photos' and private.is_own_member_photo(name));

-- ---------------------------------------------------------------------------
-- The person's own account
-- ---------------------------------------------------------------------------

-- One full name everywhere (the profile and every club's member card), plus a
-- nickname. An empty nickname clears it.
create or replace function public.update_my_account(p_full_name text, p_nickname text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := private.tidy_name(p_full_name);
  v_nickname text := nullif(private.tidy_name(p_nickname), '');
  v_constraint text;
begin
  if v_user is null or not exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_name = '' then
    raise exception 'Please enter your name' using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Your name is limited to 80 characters' using errcode = '22023';
  end if;
  if v_nickname is not null and char_length(v_nickname) > 30 then
    raise exception 'Your nickname is limited to 30 characters' using errcode = '22023';
  end if;

  update public.profiles p
  set full_name = v_name,
      nickname = v_nickname
  where p.id = v_user;
  update public.members m
  set full_name = v_name
  where m.user_id = v_user and m.full_name is distinct from v_name;
exception when check_violation then
  get stacked diagnostics v_constraint = constraint_name;
  raise exception '%', private.member_profile_message(v_constraint) using errcode = '22023';
end;
$$;

-- Records the person's uploaded photo, or with NULL removes it. The file must
-- already be in their own folder. The app deletes the replaced file itself.
create or replace function public.set_my_photo(p_path text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_user is null or not exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_path is not null then
    if not private.is_own_member_photo(v_path) then
      raise exception 'This photo is not in your folder' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'member-photos' and o.name = v_path) then
      raise exception 'Upload the photo first' using errcode = 'P0002';
    end if;
  end if;
  update public.profiles p
  set photo_path = v_path
  where p.id = v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function private.tidy_name(text) owner to postgres;
alter function private.is_own_member_photo(text) owner to postgres;
alter function private.member_photo_folder_has_room() owner to postgres;
alter function private.member_profile_message(text) owner to postgres;
alter function public.update_my_account(text, text) owner to postgres;
alter function public.set_my_photo(text) owner to postgres;

revoke all on function private.tidy_name(text) from public, anon, authenticated, service_role;
revoke all on function private.member_profile_message(text) from public, anon, authenticated, service_role;
revoke all on function private.is_own_member_photo(text) from public, anon;
revoke all on function private.member_photo_folder_has_room() from public, anon;
-- Storage policies run as the caller, so signed-in users need to call the checks.
grant execute on function private.is_own_member_photo(text) to authenticated;
grant execute on function private.member_photo_folder_has_room() to authenticated;

revoke all on function public.update_my_account(text, text) from public, anon;
revoke all on function public.set_my_photo(text) from public, anon;
grant execute on function public.update_my_account(text, text) to authenticated;
grant execute on function public.set_my_photo(text) to authenticated;

comment on function public.update_my_account(text, text) is
  'The signed-in person sets their full name (1 to 80 characters, on their profile and every club''s member card) and an optional nickname (up to 30).';
comment on function public.set_my_photo(text) is
  'The signed-in person records an uploaded photo from their own member-photos folder as their profile photo, or with NULL removes it.';
