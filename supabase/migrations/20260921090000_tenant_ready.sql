-- Rally Point tenant-ready EXPAND phase.
--
-- Additive and backward-compatible: create tenant structures and command/read
-- surfaces without rewriting legacy rows or revoking legacy application access.

create extension if not exists btree_gist;

create table if not exists public.clubs (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  default_timezone text not null default 'Asia/Manila',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.venues (
  id uuid primary key,
  club_id uuid not null references public.clubs (id) on delete restrict,
  slug text not null,
  name text not null,
  timezone text not null default 'Asia/Manila',
  open_hour smallint not null default 6,
  close_hour smallint not null default 22,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (open_hour between 0 and 23),
  check (close_hour between 1 and 24 and close_hour > open_hour),
  unique (club_id, slug),
  unique (club_id, id)
);

create table if not exists public.club_staff_roles (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null check (role in ('staff', 'admin')),
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  primary key (club_id, user_id),
  unique (club_id, user_id)
);

create table if not exists public.staff_venue_grants (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null,
  venue_id uuid not null,
  granted_by uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  primary key (club_id, user_id, venue_id),
  foreign key (club_id, user_id) references public.club_staff_roles (club_id, user_id) on delete cascade,
  foreign key (club_id, venue_id) references public.venues (club_id, id) on delete cascade
);

insert into public.clubs (id, slug, name, default_timezone, is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rally-point-gensan', 'Rally Point Gensan', 'Asia/Manila', true)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  default_timezone = excluded.default_timezone,
  is_active = excluded.is_active;

insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'gensan-main',
  'Rally Point Gensan',
  'Asia/Manila',
  6,
  22,
  true
)
on conflict (id) do update set
  club_id = excluded.club_id,
  slug = excluded.slug,
  name = excluded.name,
  timezone = excluded.timezone,
  open_hour = excluded.open_hour,
  close_hour = excluded.close_hour,
  is_active = excluded.is_active;

alter table public.members add column if not exists club_id uuid;
alter table public.courts add column if not exists club_id uuid;
alter table public.courts add column if not exists venue_id uuid;
alter table public.court_sessions add column if not exists club_id uuid;
alter table public.court_sessions add column if not exists venue_id uuid;
alter table public.checkins add column if not exists club_id uuid;
alter table public.checkins add column if not exists venue_id uuid;
alter table public.transactions add column if not exists club_id uuid;
alter table public.transactions add column if not exists venue_id uuid;
alter table public.transactions add column if not exists verification_status text not null default 'unverified';
alter table public.notifications add column if not exists club_id uuid;
alter table public.notifications add column if not exists venue_id uuid;
alter table public.walkins add column if not exists club_id uuid;
alter table public.walkins add column if not exists venue_id uuid;
alter table public.bookings add column if not exists club_id uuid;
alter table public.bookings add column if not exists venue_id uuid;
alter table public.open_plays add column if not exists club_id uuid;
alter table public.open_plays add column if not exists venue_id uuid;
alter table public.open_play_signups add column if not exists club_id uuid;
alter table public.open_play_signups add column if not exists venue_id uuid;
alter table public.reminders add column if not exists club_id uuid;
alter table public.reminders add column if not exists venue_id uuid;

create table if not exists public.court_allocations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  court_id uuid not null references public.courts (id) on delete restrict,
  source text not null check (source in ('booking', 'session', 'open_play', 'hold')),
  source_id uuid not null,
  interval tstzrange not null check (not isempty(interval)),
  status text not null default 'reserved' check (status in ('held', 'reserved', 'playing', 'completed', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);


create or replace function public.create_unpaid_desk_booking(
  p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid,
  p_date date, p_start_hour integer, p_hours integer
)
returns public.bookings
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v public.bookings;
  v_start timestamptz;
  v_end timestamptz;
  v_rate numeric;
  v_timezone text;
begin
  if p_club_id is distinct from private.current_club_id() or private.can_operate_venue(p_club_id, p_venue_id) is not true then
    raise exception 'venue is not assigned to this operator';
  end if;
  if p_hours not between 1 and 3 or p_start_hour < 0 or p_start_hour + p_hours > 24 then
    raise exception 'invalid reservation interval';
  end if;
  if not exists (select 1 from public.courts c where c.id = p_court_id and c.club_id = p_club_id and c.venue_id = p_venue_id and c.status <> 'maintenance') then
    raise exception 'court is not in the selected venue';
  end if;
  if not exists (select 1 from public.members m where m.id = p_member_id and m.club_id = p_club_id) then
    raise exception 'member is not in this club';
  end if;
  select c.hourly_rate, v.timezone into v_rate, v_timezone
  from public.courts c
  join public.venues v on v.club_id = c.club_id and v.id = c.venue_id
  where c.id = p_court_id and c.club_id = p_club_id and c.venue_id = p_venue_id;
  v_start := (p_date::timestamp + make_interval(hours => p_start_hour)) at time zone coalesce(v_timezone, 'Asia/Manila');
  v_end := v_start + make_interval(hours => p_hours);
  insert into public.bookings (club_id, venue_id, court_id, member_id, start_at, end_at, hours, amount, status)
  values (p_club_id, p_venue_id, p_court_id, p_member_id, v_start, v_end, p_hours, v_rate * p_hours, 'pending_payment')
  returning * into v;
  insert into public.court_allocations (club_id, venue_id, court_id, source, source_id, interval, status)
  values (p_club_id, p_venue_id, p_court_id, 'booking', v.id, tstzrange(v_start, v_end, '[)'), 'reserved');
  return v;
end;
$$;

create or replace function public.create_desk_rental(
  p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_member_id uuid, p_guest_name text, p_hours integer
)
returns public.court_sessions
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v public.court_sessions;
  v_start timestamptz := now();
  v_end timestamptz := now() + make_interval(hours => p_hours);
  v_rate numeric;
begin
  if p_club_id is distinct from private.current_club_id() or private.can_operate_venue(p_club_id, p_venue_id) is not true then raise exception 'venue is not assigned to this operator'; end if;
  if p_hours not between 1 and 4 then raise exception 'invalid rental duration'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and club_id = p_club_id and venue_id = p_venue_id and status <> 'maintenance') then raise exception 'court is unavailable'; end if;
  if p_member_id is not null and not exists (select 1 from public.members where id = p_member_id and club_id = p_club_id) then raise exception 'member is not in this club'; end if;
  select hourly_rate into v_rate from public.courts where id = p_court_id;
  insert into public.court_sessions (club_id, venue_id, court_id, member_id, guest_name, start_at, end_at, status, amount, created_by)
  values (p_club_id, p_venue_id, p_court_id, p_member_id, nullif(p_guest_name, ''), v_start, v_end, 'playing', v_rate * p_hours, auth.uid())
  returning * into v;
  insert into public.court_allocations (club_id, venue_id, court_id, source, source_id, interval, status, created_by)
  values (p_club_id, p_venue_id, p_court_id, 'session', v.id, tstzrange(v_start, v_end, '[)'), 'playing', auth.uid());
  update public.courts set status = 'occupied' where id = p_court_id and club_id = p_club_id;
  insert into public.transactions (club_id, venue_id, member_id, amount, type, description, created_by, verification_status)
  values (p_club_id, p_venue_id, p_member_id, v.amount, 'court_rental', 'Desk rental — recorded charge', auth.uid(), 'unverified');
  return v;
end;
$$;

create or replace function public.add_member_to_session(p_session_id uuid, p_member_id uuid)
returns public.court_sessions
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.court_sessions;
begin
  select s.* into v from public.court_sessions s where s.id = p_session_id for update;
  if v.id is null or private.can_operate_venue(v.club_id, v.venue_id) is not true then raise exception 'session is outside assigned venue'; end if;
  if not exists (select 1 from public.members m where m.id = p_member_id and m.club_id = v.club_id) then raise exception 'member is not in this club'; end if;
  update public.court_sessions set member_id = coalesce(member_id, p_member_id), created_by = auth.uid() where id = p_session_id returning * into v;
  return v;
end;
$$;

create or replace function public.extend_desk_session(p_session_id uuid, p_hours integer)
returns public.court_sessions
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v public.court_sessions;
  v_rate numeric;
  v_end timestamptz;
begin
  if p_hours not between 1 and 4 then raise exception 'invalid extension duration'; end if;
  select s.* into v from public.court_sessions s where s.id = p_session_id for update;
  if v.id is null or private.can_operate_venue(v.club_id, v.venue_id) is not true then raise exception 'session is outside assigned venue'; end if;
  select hourly_rate into v_rate from public.courts where id = v.court_id and club_id = v.club_id;
  v_end := v.end_at + make_interval(hours => p_hours);
  update public.court_allocations set interval = tstzrange(v.start_at, v_end, '[)') where source = 'session' and source_id = v.id and status = 'playing';
  update public.court_sessions set end_at = v_end, amount = amount + (v_rate * p_hours) where id = v.id returning * into v;
  insert into public.transactions (club_id, venue_id, member_id, amount, type, description, created_by, verification_status)
  values (v.club_id, v.venue_id, v.member_id, v_rate * p_hours, 'extension', 'Desk extension — recorded charge', auth.uid(), 'unverified');
  return v;
end;
$$;

create or replace function public.end_desk_session(p_session_id uuid)
returns public.court_sessions
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.court_sessions;
begin
  select s.* into v from public.court_sessions s where s.id = p_session_id for update;
  if v.id is null or private.can_operate_venue(v.club_id, v.venue_id) is not true then raise exception 'session is outside assigned venue'; end if;
  update public.court_sessions set status = 'completed', end_at = least(end_at, now()) where id = v.id returning * into v;
  update public.court_allocations set status = 'completed' where source = 'session' and source_id = v.id;
  update public.courts set status = 'available' where id = v.court_id and not exists (
    select 1 from public.court_allocations a where a.court_id = v.court_id and a.status in ('held', 'reserved', 'playing')
  );
  return v;
end;
$$;

create or replace function public.check_in_member(p_member_id uuid, p_venue_id uuid, p_note text)
returns public.checkins
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.checkins;
declare v_club uuid;
begin
  select club_id into v_club from public.members where id = p_member_id;
  if v_club is null or private.can_operate_venue(v_club, p_venue_id) is not true then raise exception 'member or venue is outside assigned club'; end if;
  insert into public.checkins (club_id, venue_id, member_id, staff_id, note)
  values (v_club, p_venue_id, p_member_id, auth.uid(), p_note) returning * into v;
  return v;
end;
$$;

create or replace function public.check_in_qr(p_payload text, p_venue_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_member public.members;
  v_checkin public.checkins;
  v_code text := upper(btrim(p_payload));
begin
  if left(v_code, 4) = 'RP1|' then v_code := split_part(v_code, '|', 2); end if;
  select * into v_member from public.members m
  where m.club_id = private.current_club_id()
    and (upper(m.member_code) = v_code or m.qr_token = btrim(p_payload))
  limit 1;
  if v_member.id is null then raise exception 'QR not recognized'; end if;
  v_checkin := public.check_in_member(v_member.id, p_venue_id, 'QR check-in');
  return jsonb_build_object(
    'checkin', to_jsonb(v_checkin),
    'member', jsonb_build_object('id', v_member.id, 'club_id', v_member.club_id, 'member_code', v_member.member_code, 'full_name', v_member.full_name, 'membership_type', v_member.membership_type, 'status', v_member.status, 'expiry_date', v_member.expiry_date)
  );
end;
$$;

create or replace function public.create_desk_walkin(p_venue_id uuid, p_full_name text, p_phone text, p_purpose text, p_amount numeric)
returns public.walkins
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.walkins;
declare v_club uuid := private.current_club_id();
begin
  if private.can_operate_venue(v_club, p_venue_id) is not true then raise exception 'venue is outside assigned club'; end if;
  insert into public.walkins (club_id, venue_id, full_name, phone, purpose, amount, created_by)
  values (v_club, p_venue_id, p_full_name, nullif(p_phone, ''), p_purpose, p_amount, auth.uid()) returning * into v;
  insert into public.transactions (club_id, venue_id, amount, type, description, created_by, verification_status)
  values (v_club, p_venue_id, p_amount, 'walk_in', 'Walk-in — recorded charge', auth.uid(), 'unverified');
  return v;
end;
$$;


create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.current_club_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.clubs c
  where c.slug = 'rally-point-gensan' and c.is_active
  limit 1;
$$;

create or replace function private.current_club_role(p_club_id uuid)
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.club_staff_roles csr where csr.club_id = p_club_id and csr.user_id = auth.uid() and csr.role = 'admin' and csr.is_active) then 'admin'::public.user_role
    when exists (select 1 from public.club_staff_roles csr where csr.club_id = p_club_id and csr.user_id = auth.uid() and csr.role = 'staff' and csr.is_active) then 'staff'::public.user_role
    when exists (select 1 from public.members m where m.club_id = p_club_id and m.user_id = auth.uid()) then 'member'::public.user_role
    else null::public.user_role
  end;
$$;

create or replace function private.can_access_club(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_club_id = private.current_club_id()
     and private.current_club_role(p_club_id) is not null;
$$;

create or replace function private.can_access_venue(p_club_id uuid, p_venue_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_club(p_club_id)
     and exists (select 1 from public.venues v where v.club_id = p_club_id and v.id = p_venue_id and v.is_active)
     and (
       private.current_club_role(p_club_id) in ('member', 'admin')
       or exists (select 1 from public.staff_venue_grants g
                  where g.club_id = p_club_id and g.venue_id = p_venue_id
                    and g.user_id = auth.uid() and g.is_active)
     );
$$;

create or replace function private.can_operate_venue(p_club_id uuid, p_venue_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_venue(p_club_id, p_venue_id)
     and private.current_club_role(p_club_id) in ('staff', 'admin');
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_club_id() to authenticated;
grant execute on function private.current_club_role(uuid) to authenticated;
grant execute on function private.can_access_club(uuid) to authenticated;
grant execute on function private.can_access_venue(uuid, uuid) to authenticated;
grant execute on function private.can_operate_venue(uuid, uuid) to authenticated;

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
  -- The expand phase retains the legacy global user_id uniqueness. The
  -- enforcement phase replaces this with the club-scoped conflict target.
  on conflict (user_id) do nothing;
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace function public.get_current_access()
returns table (club_id uuid, role public.user_role)
language sql stable security definer set search_path = ''
as $$
  select c.id, private.current_club_role(c.id)
  from public.clubs c
  where c.id = private.current_club_id()
    and private.current_club_role(c.id) is not null;
$$;
revoke all on function public.get_current_access() from public, anon;
grant execute on function public.get_current_access() to authenticated;

drop view if exists public.member_roster;
create view public.member_roster with (security_barrier = true) as
select m.club_id, m.id, m.member_code, m.full_name, m.membership_type, m.status, m.expiry_date, m.created_at
from public.members m
where m.club_id = private.current_club_id()
  and private.current_club_role(m.club_id) in ('staff', 'admin');

drop view if exists public.member_self;
create view public.member_self with (security_barrier = true) as
select m.* from public.members m
where m.club_id = private.current_club_id() and m.user_id = auth.uid();

drop view if exists public.member_admin;
create view public.member_admin with (security_barrier = true) as
select m.* from public.members m
where m.club_id = private.current_club_id() and private.current_club_role(m.club_id) = 'admin';

drop view if exists public.staff_accounts;
create view public.staff_accounts with (security_barrier = true) as
select csr.club_id, p.id as user_id, p.email, p.full_name, p.phone, csr.role,
       coalesce(array_agg(g.venue_id) filter (where g.is_active), '{}'::uuid[]) as venue_ids
from public.club_staff_roles csr
join public.profiles p on p.id = csr.user_id
left join public.staff_venue_grants g on g.club_id = csr.club_id and g.user_id = csr.user_id
where csr.club_id = private.current_club_id()
  and csr.is_active and private.current_club_role(csr.club_id) = 'admin'
group by csr.club_id, p.id, p.email, p.full_name, p.phone, csr.role;

drop view if exists public.public_schedule;
create view public.public_schedule with (security_barrier = true) as
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
union all
select o.id, o.club_id, o.venue_id, v.name, o.court_id, c.name,
       'open_play'::text, 'Open play'::text,
       o.start_at, o.end_at, o.status::text, (o.capacity::text || ' seats')::text
from public.open_plays o
left join public.courts c on c.id = o.court_id and c.club_id = o.club_id
join public.venues v on v.id = o.venue_id and v.club_id = o.club_id
where o.club_id = private.current_club_id() and o.status in ('open', 'full');

revoke all on public.member_roster, public.member_self, public.member_admin, public.staff_accounts, public.public_schedule from public, anon, authenticated;
grant select on public.member_roster, public.member_self, public.member_admin, public.public_schedule to authenticated;
grant select on public.staff_accounts to authenticated;
grant select on public.public_schedule to anon;

alter table public.clubs enable row level security;
alter table public.venues enable row level security;
alter table public.club_staff_roles enable row level security;
alter table public.staff_venue_grants enable row level security;
alter table public.court_allocations enable row level security;

create policy clubs_select_current on public.clubs for select to authenticated using (id = private.current_club_id() and is_active);
create policy venues_select_current_authenticated on public.venues for select to authenticated
  using (private.can_access_venue(club_id, id));
create policy venues_admin_select_all on public.venues for select to authenticated
  using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');
create policy staff_roles_admin_select on public.club_staff_roles for select to authenticated using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');
create policy staff_grants_admin_select on public.staff_venue_grants for select to authenticated using (club_id = private.current_club_id() and private.current_club_role(club_id) = 'admin');
create policy allocations_access_select on public.court_allocations for select to authenticated using (private.can_access_venue(club_id, venue_id));

grant select on public.clubs, public.venues, public.club_staff_roles,
  public.staff_venue_grants, public.court_allocations to authenticated;


create or replace function public.admin_upsert_member(
  p_member_id uuid, p_full_name text, p_email text, p_phone text,
  p_membership_type public.membership_type, p_status public.member_status,
  p_join_date date, p_expiry_date date, p_notes text
)
returns public.members
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.members;
declare v_club uuid := private.current_club_id();
begin
  if private.current_club_role(v_club) is distinct from 'admin' then raise exception 'admin access required'; end if;
  if p_member_id is null then
    insert into public.members (club_id, member_code, full_name, email, phone, membership_type, status, join_date, expiry_date, notes)
    values (v_club, 'RP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8)), p_full_name, p_email, p_phone, p_membership_type, p_status, p_join_date, p_expiry_date, p_notes)
    returning * into v;
  else
    update public.members
    set full_name = p_full_name, email = p_email, phone = p_phone,
        membership_type = p_membership_type, status = p_status,
        join_date = p_join_date, expiry_date = p_expiry_date, notes = p_notes
    where id = p_member_id and club_id = v_club
    returning * into v;
  end if;
  if v.id is null then raise exception 'member not found'; end if;
  return v;
end;
$$;

create or replace function public.create_open_play_session(
  p_club_id uuid, p_venue_id uuid, p_court_id uuid, p_title text,
  p_start_at timestamptz, p_end_at timestamptz, p_capacity integer,
  p_fee numeric, p_skill_level public.skill_level, p_notes text
)
returns public.open_plays
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.open_plays;
begin
  if p_club_id is distinct from private.current_club_id() or private.can_operate_venue(p_club_id, p_venue_id) is not true then raise exception 'venue is not assigned to this operator'; end if;
  if p_court_id is not null and not exists (select 1 from public.courts where id = p_court_id and club_id = p_club_id and venue_id = p_venue_id) then raise exception 'court is outside selected venue'; end if;
  insert into public.open_plays (club_id, venue_id, title, court_id, start_at, end_at, capacity, fee, skill_level, notes, created_by)
  values (p_club_id, p_venue_id, p_title, p_court_id, p_start_at, p_end_at, p_capacity, p_fee, p_skill_level, p_notes, auth.uid())
  returning * into v;
  if p_court_id is not null then
    insert into public.court_allocations (club_id, venue_id, court_id, source, source_id, interval, status, created_by)
    values (p_club_id, p_venue_id, p_court_id, 'open_play', v.id, tstzrange(p_start_at, p_end_at, '[)'), 'reserved', auth.uid());
  end if;
  return v;
end;
$$;

create or replace function public.join_open_play_session(p_open_play_id uuid, p_member_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v public.open_plays;
  v_status public.open_play_signup_status;
  v_signup public.open_play_signups;
begin
  select * into v from public.open_plays where id = p_open_play_id and club_id = private.current_club_id() for update;
  if v.id is null then raise exception 'session not found'; end if;
  if not exists (select 1 from public.members where id = p_member_id and club_id = v.club_id and user_id = auth.uid()) then raise exception 'member access denied'; end if;
  if exists (select 1 from public.open_play_signups where open_play_id = v.id and member_id = p_member_id and status <> 'cancelled') then raise exception 'already joined'; end if;
  if (select count(*) from public.open_play_signups where open_play_id = v.id and status = 'joined') >= v.capacity then v_status := 'waitlist'; else v_status := 'joined'; end if;
  insert into public.open_play_signups (club_id, venue_id, open_play_id, member_id, status)
  values (v.club_id, v.venue_id, v.id, p_member_id, v_status)
  returning * into v_signup;
  return jsonb_build_object('signup', to_jsonb(v_signup), 'session', to_jsonb(v));
end;
$$;

create or replace function public.leave_open_play_session(p_open_play_id uuid, p_member_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  update public.open_play_signups s set status = 'cancelled'
  where s.open_play_id = p_open_play_id and s.member_id = p_member_id
    and s.club_id = private.current_club_id()
    and exists (select 1 from public.open_plays o where o.id = s.open_play_id and o.club_id = private.current_club_id())
    and exists (select 1 from public.members m where m.id = s.member_id and m.user_id = auth.uid());
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path = pg_catalog, public, private
as $$ update public.notifications set read = true where id = p_notification_id and user_id = auth.uid(); $$;

create or replace function public.ensure_member_qr(p_member_id uuid)
returns public.members
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.members;
begin
  select * into v from public.members
  where id = p_member_id
    and club_id = private.current_club_id()
    and (user_id = auth.uid() or private.current_club_role(club_id) = 'admin')
  for update;
  if v.id is null then raise exception 'member access denied'; end if;
  if v.qr_token is null then
    update public.members
    set qr_token = 'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
    where id = v.id returning * into v;
  end if;
  return v;
end;
$$;

create or replace function public.admin_upsert_venue(
  p_venue_id uuid, p_slug text, p_name text, p_timezone text,
  p_open_hour smallint, p_close_hour smallint, p_is_active boolean
)
returns public.venues
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.venues;
declare v_club uuid := private.current_club_id();
begin
  if private.current_club_role(v_club) is distinct from 'admin' then raise exception 'admin access required'; end if;
  if p_venue_id is null then
    insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
    values (extensions.gen_random_uuid(), v_club, p_slug, p_name, coalesce(p_timezone, 'Asia/Manila'), p_open_hour, p_close_hour, coalesce(p_is_active, true))
    returning * into v;
  else
    update public.venues
    set slug = p_slug, name = p_name, timezone = coalesce(p_timezone, timezone),
        open_hour = p_open_hour, close_hour = p_close_hour, is_active = p_is_active
    where id = p_venue_id and club_id = v_club returning * into v;
  end if;
  if v.id is null then raise exception 'venue not found'; end if;
  return v;
end;
$$;

create or replace function public.set_staff_venue_grant(p_user_id uuid, p_venue_id uuid, p_is_active boolean)
returns public.staff_venue_grants
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.staff_venue_grants;
declare v_club uuid := private.current_club_id();
begin
  if private.current_club_role(v_club) is distinct from 'admin' then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.club_staff_roles where club_id = v_club and user_id = p_user_id and role = 'staff' and is_active) then raise exception 'user is not a provisioned staff account'; end if;
  if not exists (select 1 from public.venues where club_id = v_club and id = p_venue_id) then raise exception 'venue not found'; end if;
  insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by, is_active)
  values (v_club, p_user_id, p_venue_id, auth.uid(), p_is_active)
  on conflict (club_id, user_id, venue_id) do update set is_active = excluded.is_active, granted_by = excluded.granted_by
  returning * into v;
  return v;
end;
$$;

alter function private.current_club_id() owner to postgres;
alter function private.current_club_role(uuid) owner to postgres;
alter function private.can_access_club(uuid) owner to postgres;
alter function private.can_access_venue(uuid, uuid) owner to postgres;
alter function private.can_operate_venue(uuid, uuid) owner to postgres;
alter function public.get_current_access() owner to postgres;
alter function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer) owner to postgres;
alter function public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer) owner to postgres;
alter function public.add_member_to_session(uuid, uuid) owner to postgres;
alter function public.extend_desk_session(uuid, integer) owner to postgres;
alter function public.end_desk_session(uuid) owner to postgres;
alter function public.check_in_member(uuid, uuid, text) owner to postgres;
alter function public.check_in_qr(text, uuid) owner to postgres;
alter function public.create_desk_walkin(uuid, text, text, text, numeric) owner to postgres;
alter function public.admin_upsert_member(uuid, text, text, text, public.membership_type, public.member_status, date, date, text) owner to postgres;
alter function public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text) owner to postgres;
alter function public.join_open_play_session(uuid, uuid) owner to postgres;
alter function public.leave_open_play_session(uuid, uuid) owner to postgres;
alter function public.mark_notification_read(uuid) owner to postgres;
alter function public.ensure_member_qr(uuid) owner to postgres;
alter function public.admin_upsert_venue(uuid, text, text, text, smallint, smallint, boolean) owner to postgres;
alter function public.set_staff_venue_grant(uuid, uuid, boolean) owner to postgres;

revoke all on function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer) from public, anon;
revoke all on function public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer) from public, anon;
revoke all on function public.add_member_to_session(uuid, uuid) from public, anon;
revoke all on function public.extend_desk_session(uuid, integer) from public, anon;
revoke all on function public.end_desk_session(uuid) from public, anon;
revoke all on function public.check_in_member(uuid, uuid, text) from public, anon;
revoke all on function public.check_in_qr(text, uuid) from public, anon;
revoke all on function public.create_desk_walkin(uuid, text, text, text, numeric) from public, anon;
revoke all on function public.admin_upsert_member(uuid, text, text, text, public.membership_type, public.member_status, date, date, text) from public, anon;
revoke all on function public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text) from public, anon;
revoke all on function public.join_open_play_session(uuid, uuid) from public, anon;
revoke all on function public.leave_open_play_session(uuid, uuid) from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.ensure_member_qr(uuid) from public, anon;
revoke all on function public.admin_upsert_venue(uuid, text, text, text, smallint, smallint, boolean) from public, anon;
revoke all on function public.set_staff_venue_grant(uuid, uuid, boolean) from public, anon;

grant execute on function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer) to authenticated;
grant execute on function public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer) to authenticated;
grant execute on function public.add_member_to_session(uuid, uuid) to authenticated;
grant execute on function public.extend_desk_session(uuid, integer) to authenticated;
grant execute on function public.end_desk_session(uuid) to authenticated;
grant execute on function public.check_in_member(uuid, uuid, text) to authenticated;
grant execute on function public.check_in_qr(text, uuid) to authenticated;
grant execute on function public.create_desk_walkin(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.admin_upsert_member(uuid, text, text, text, public.membership_type, public.member_status, date, date, text) to authenticated;
grant execute on function public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text) to authenticated;
grant execute on function public.join_open_play_session(uuid, uuid) to authenticated;
grant execute on function public.leave_open_play_session(uuid, uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.ensure_member_qr(uuid) to authenticated;
grant execute on function public.admin_upsert_venue(uuid, text, text, text, smallint, smallint, boolean) to authenticated;
grant execute on function public.set_staff_venue_grant(uuid, uuid, boolean) to authenticated;

comment on table public.court_allocations is 'Single source of truth for occupied court intervals; overlap protection is activated in the tenant enforcement phase.';
comment on column public.transactions.verification_status is 'Historical and desk-recorded charges remain unverified until a trusted collection process confirms them.';
