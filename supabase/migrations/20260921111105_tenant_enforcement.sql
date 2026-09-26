-- Rally Point tenant-ready ENFORCEMENT phase.
--
-- Run only after a successful backfill and relationship/overlap audit. This is
-- the write-paused cutover: ownership becomes required, composite ownership is
-- enforced, court contention becomes atomic, and legacy direct writes close.

alter table public.members alter column club_id set not null;
alter table public.courts alter column club_id set not null;
alter table public.courts alter column venue_id set not null;
alter table public.court_sessions alter column club_id set not null;
alter table public.court_sessions alter column venue_id set not null;
alter table public.checkins alter column club_id set not null;
alter table public.checkins alter column venue_id set not null;
alter table public.transactions alter column club_id set not null;
alter table public.walkins alter column club_id set not null;
alter table public.walkins alter column venue_id set not null;
alter table public.bookings alter column club_id set not null;
alter table public.bookings alter column venue_id set not null;
alter table public.open_plays alter column club_id set not null;
alter table public.open_plays alter column venue_id set not null;
alter table public.open_play_signups alter column club_id set not null;
alter table public.open_play_signups alter column venue_id set not null;
alter table public.notifications alter column club_id set not null;
alter table public.reminders alter column club_id set not null;

alter table public.transactions
  add constraint transactions_verification_status_check
  check (verification_status in ('unverified', 'verified'));

alter table public.members drop constraint if exists members_member_code_key;
alter table public.members drop constraint if exists members_user_id_key;
alter table public.members add constraint members_club_id_key unique (club_id, id);
alter table public.members add constraint members_club_user_key unique (club_id, user_id);
alter table public.members add constraint members_club_member_code_key unique (club_id, member_code);
alter table public.courts add constraint courts_club_id_key unique (club_id, id);
alter table public.courts add constraint courts_club_venue_id_key unique (club_id, venue_id, id);
alter table public.court_sessions add constraint court_sessions_club_id_key unique (club_id, id);
alter table public.court_sessions add constraint court_sessions_club_venue_id_key unique (club_id, venue_id, id);
alter table public.bookings add constraint bookings_club_id_key unique (club_id, id);
alter table public.bookings add constraint bookings_club_venue_id_key unique (club_id, venue_id, id);
alter table public.open_plays add constraint open_plays_club_id_key unique (club_id, id);
alter table public.open_plays add constraint open_plays_club_venue_id_key unique (club_id, venue_id, id);
alter table public.checkins add constraint checkins_club_id_key unique (club_id, id);
alter table public.walkins add constraint walkins_club_id_key unique (club_id, id);

alter table public.members
  add constraint members_club_fk
  foreign key (club_id) references public.clubs (id) on delete restrict;

alter table public.courts
  add constraint courts_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint courts_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.court_sessions
  add constraint court_sessions_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint court_sessions_court_club_fk
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict,
  add constraint court_sessions_court_venue_fk
    foreign key (club_id, venue_id, court_id) references public.courts (club_id, venue_id, id) on delete restrict,
  add constraint court_sessions_member_club_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete restrict;

alter table public.bookings
  add constraint bookings_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint bookings_court_club_fk
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict,
  add constraint bookings_court_venue_fk
    foreign key (club_id, venue_id, court_id) references public.courts (club_id, venue_id, id) on delete restrict,
  add constraint bookings_member_club_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete restrict;

alter table public.open_plays
  add constraint open_plays_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint open_plays_court_club_fk
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict,
  add constraint open_plays_court_venue_fk
    foreign key (club_id, venue_id, court_id) references public.courts (club_id, venue_id, id) on delete restrict,
  add constraint open_plays_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.open_play_signups
  add constraint open_play_signups_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint open_play_signups_open_play_club_fk
    foreign key (club_id, open_play_id) references public.open_plays (club_id, id) on delete cascade,
  add constraint open_play_signups_open_play_venue_fk
    foreign key (club_id, venue_id, open_play_id) references public.open_plays (club_id, venue_id, id) on delete cascade,
  add constraint open_play_signups_member_club_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete cascade,
  add constraint open_play_signups_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.checkins
  add constraint checkins_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint checkins_member_club_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete cascade,
  add constraint checkins_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.transactions
  add constraint transactions_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint transactions_member_club_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete restrict,
  add constraint transactions_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.notifications
  add constraint notifications_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint notifications_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.walkins
  add constraint walkins_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint walkins_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict;

alter table public.reminders
  add constraint reminders_club_fk
    foreign key (club_id) references public.clubs (id) on delete restrict,
  add constraint reminders_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict,
  add constraint reminders_booking_club_fk
    foreign key (club_id, booking_id) references public.bookings (club_id, id) on delete restrict,
  add constraint reminders_open_play_club_fk
    foreign key (club_id, open_play_id) references public.open_plays (club_id, id) on delete restrict;

alter table public.court_sessions
  add constraint court_sessions_booking_club_fk
    foreign key (club_id, booking_id) references public.bookings (club_id, id) on delete restrict,
  add constraint court_sessions_booking_venue_fk
    foreign key (club_id, venue_id, booking_id) references public.bookings (club_id, venue_id, id) on delete restrict;

alter table public.bookings
  add constraint bookings_session_club_fk
    foreign key (club_id, session_id) references public.court_sessions (club_id, id) on delete restrict,
  add constraint bookings_session_venue_fk
    foreign key (club_id, venue_id, session_id) references public.court_sessions (club_id, venue_id, id) on delete restrict;

alter table public.court_allocations
  add constraint court_allocations_club_venue_fk
    foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict,
  add constraint court_allocations_court_club_fk
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict,
  add constraint court_allocations_court_venue_fk
    foreign key (club_id, venue_id, court_id) references public.courts (club_id, venue_id, id) on delete restrict;

create index if not exists members_club_status_idx on public.members (club_id, status, full_name);
create index if not exists courts_club_venue_idx on public.courts (club_id, venue_id, name);
create index if not exists sessions_club_venue_time_idx on public.court_sessions (club_id, venue_id, start_at, end_at);
create index if not exists bookings_club_venue_time_idx on public.bookings (club_id, venue_id, start_at, end_at);
create index if not exists open_plays_club_venue_time_idx on public.open_plays (club_id, venue_id, start_at, end_at);
create index if not exists checkins_club_venue_time_idx on public.checkins (club_id, venue_id, checked_in_at desc);
create index if not exists transactions_club_venue_time_idx on public.transactions (club_id, venue_id, created_at desc);

alter table public.court_allocations
  add constraint court_allocations_no_overlap
  exclude using gist (court_id with =, interval with &&)
  where (status in ('held', 'reserved', 'playing'));

-- The scoped uniqueness now exists, so new signups no longer depend on the
-- legacy global members.user_id unique constraint.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_phone text;
  v_code text;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  v_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
  v_code := 'RP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.profiles (id, email, full_name, role, phone)
  values (new.id, new.email, v_name, 'member', v_phone)
  on conflict (id) do nothing;
  insert into public.members (
    club_id, user_id, member_code, full_name, email, phone,
    membership_type, status, join_date, expiry_date, qr_token
  )
  values (
    private.current_club_id(), new.id, v_code, v_name, new.email, v_phone,
    'standard', 'active', current_date, current_date + 30,
    'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  )
  on conflict (club_id, user_id) do nothing;
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Operational-table policies need an ownership predicate that does not
-- require authenticated clients to SELECT the members base table. The
-- dedicated forward repair repeats this definition for shared databases where
-- enforcement is intentionally deferred.
create or replace function private.is_member_owner(p_club_id uuid, p_member_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_club_id = private.current_club_id()
    and exists (
      select 1 from public.members m
      where m.club_id = p_club_id
        and m.id = p_member_id
        and m.user_id = auth.uid()
    );
$$;

alter function private.is_member_owner(uuid, uuid) owner to postgres;
revoke all on function private.is_member_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_member_owner(uuid, uuid) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'members', 'courts', 'court_sessions', 'checkins',
        'transactions', 'notifications', 'walkins', 'bookings', 'open_plays',
        'open_play_signups', 'reminders', 'clubs', 'venues', 'club_staff_roles',
        'staff_venue_grants', 'court_allocations'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.courts enable row level security;
alter table public.court_sessions enable row level security;
alter table public.checkins enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.walkins enable row level security;
alter table public.bookings enable row level security;
alter table public.open_plays enable row level security;
alter table public.open_play_signups enable row level security;
alter table public.reminders enable row level security;
alter table public.clubs enable row level security;
alter table public.venues enable row level security;
alter table public.club_staff_roles enable row level security;
alter table public.staff_venue_grants enable row level security;
alter table public.court_allocations enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

create policy clubs_select_current on public.clubs
  for select to authenticated
  using (id = private.current_club_id() and is_active);

create policy venues_select_current_authenticated on public.venues
  for select to authenticated
  using (private.can_access_venue(club_id, id));

create policy venues_admin_select_all on public.venues
  for select to authenticated
  using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');

create policy staff_roles_admin_select on public.club_staff_roles
  for select to authenticated
  using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');

create policy staff_grants_admin_select on public.staff_venue_grants
  for select to authenticated
  using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');

create policy members_self_select on public.members
  for select to authenticated
  using (club_id = private.current_club_id() and user_id = auth.uid());

create policy courts_access_select on public.courts
  for select to authenticated using (private.can_access_venue(club_id, venue_id));

create policy sessions_access_select on public.court_sessions
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

create policy bookings_access_select on public.bookings
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

create policy open_plays_access_select on public.open_plays
  for select to authenticated using (private.can_access_venue(club_id, venue_id));

create policy open_play_signups_access_select on public.open_play_signups
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

create policy checkins_access_select on public.checkins
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

create policy transactions_access_select on public.transactions
  for select to authenticated
  using (
    private.is_member_owner(club_id, member_id)
    or (venue_id is not null and private.can_access_venue(club_id, venue_id))
    or (venue_id is null and private.current_club_role(club_id) = 'admin')
  );

create policy notifications_own_select on public.notifications
  for select to authenticated
  using (club_id = private.current_club_id() and user_id = auth.uid());

create policy reminders_own_select on public.reminders
  for select to authenticated
  using (club_id = private.current_club_id() and user_id = auth.uid());

create policy walkins_access_select on public.walkins
  for select to authenticated using (private.can_access_venue(club_id, venue_id));

create policy allocations_access_select on public.court_allocations
  for select to authenticated using (private.can_access_venue(club_id, venue_id));

-- Discovery permission is not permission to read private operational rows.
-- Restrictive SELECT fences also constrain legacy permissive/ALL policies.
-- Keep this block aligned with the forward member_privacy_repair migration.

drop policy if exists private_read_scope on public.court_sessions;
create policy private_read_scope on public.court_sessions
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.bookings;
create policy private_read_scope on public.bookings
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.open_play_signups;
create policy private_read_scope on public.open_play_signups
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.checkins;
create policy private_read_scope on public.checkins
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.transactions;
create policy private_read_scope on public.transactions
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id)
    or (venue_id is null and club_id = private.current_club_id()
        and private.current_club_role(club_id) = 'admin'));

drop policy if exists private_read_scope on public.walkins;
create policy private_read_scope on public.walkins
  as restrictive for select to authenticated
  using (private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.court_allocations;
create policy private_read_scope on public.court_allocations
  as restrictive for select to authenticated
  using (private.can_operate_venue(club_id, venue_id));

revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
-- Preserve the tenant read contract in either deployment order. These tables
-- retain their admin-only, fixed-club SELECT policies; no client writes reopen.
grant select on public.club_staff_roles, public.staff_venue_grants to authenticated;
grant select on public.clubs, public.venues, public.courts, public.court_sessions,
  public.bookings, public.open_plays, public.open_play_signups, public.checkins,
  public.transactions, public.notifications, public.reminders, public.walkins,
  public.court_allocations to authenticated;
grant select on public.public_schedule to anon, authenticated;
-- The additive safe aggregate may arrive before or after deferred enforcement.
do $$ begin
  if to_regclass('public.open_play_seat_counts') is not null then
    grant select on public.open_play_seat_counts to authenticated;
  end if;
end $$;
grant select on public.member_roster, public.member_self, public.member_admin,
  public.staff_accounts to authenticated;

comment on table public.court_allocations is
  'Single source of truth for occupied court intervals; active rows are protected by a GiST exclusion constraint.';
