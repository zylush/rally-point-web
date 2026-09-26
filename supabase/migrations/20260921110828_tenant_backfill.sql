-- Rally Point tenant-ready BACKFILL phase.
--
-- Run only after the expand migration. This phase repairs historical ownership,
-- records trusted legacy staff assignments, validates relationships and occupied
-- intervals, and reports before/after row counts. It does not tighten access.

do $$
declare
  v_counts jsonb;
begin
  select jsonb_build_object(
    'members', (select count(*) from public.members),
    'courts', (select count(*) from public.courts),
    'court_sessions', (select count(*) from public.court_sessions),
    'bookings', (select count(*) from public.bookings),
    'open_plays', (select count(*) from public.open_plays),
    'open_play_signups', (select count(*) from public.open_play_signups),
    'checkins', (select count(*) from public.checkins),
    'walkins', (select count(*) from public.walkins),
    'transactions', (select count(*) from public.transactions),
    'notifications', (select count(*) from public.notifications),
    'reminders', (select count(*) from public.reminders),
    'court_allocations', (select count(*) from public.court_allocations),
    'club_staff_roles', (select count(*) from public.club_staff_roles),
    'staff_venue_grants', (select count(*) from public.staff_venue_grants)
  ) into v_counts;
  raise notice 'tenant backfill before counts: %', v_counts;
end;
$$;

update public.members
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where club_id is null;

update public.courts
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
where club_id is null or venue_id is null;

update public.court_sessions as s
set club_id = c.club_id,
    venue_id = c.venue_id
from public.courts as c
where c.id = s.court_id
  and (s.club_id is null or s.venue_id is null);

update public.bookings as b
set club_id = c.club_id,
    venue_id = c.venue_id
from public.courts as c
where c.id = b.court_id
  and (b.club_id is null or b.venue_id is null);

update public.open_plays as o
set club_id = c.club_id,
    venue_id = c.venue_id
from public.courts as c
where c.id = o.court_id
  and (o.club_id is null or o.venue_id is null);

update public.open_plays
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
where club_id is null or venue_id is null;

update public.open_play_signups as s
set club_id = o.club_id,
    venue_id = o.venue_id
from public.open_plays as o
where o.id = s.open_play_id
  and (s.club_id is null or s.venue_id is null);

update public.checkins as c
set club_id = m.club_id,
    venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
from public.members as m
where m.id = c.member_id
  and (c.club_id is null or c.venue_id is null);

update public.transactions as t
set club_id = m.club_id
from public.members as m
where m.id = t.member_id
  and t.club_id is null;

update public.transactions
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where club_id is null;

-- Provider collection has not been reconciled for any historical charge.
update public.transactions
set verification_status = 'unverified'
where verification_status is distinct from 'unverified';

update public.notifications as n
set club_id = m.club_id
from public.members as m
where m.user_id = n.user_id
  and n.club_id is null;

update public.notifications
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where club_id is null;

update public.walkins
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    venue_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
where club_id is null or venue_id is null;

update public.reminders as r
set club_id = b.club_id,
    venue_id = b.venue_id
from public.bookings as b
where b.id = r.booking_id
  and (r.club_id is null or r.venue_id is null);

update public.reminders as r
set club_id = o.club_id,
    venue_id = o.venue_id
from public.open_plays as o
where o.id = r.open_play_id
  and (r.club_id is null or r.venue_id is null);

update public.reminders
set club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where club_id is null;

-- Legacy profile roles are trusted only after the operator has reviewed the
-- account list for this rollout. The Gate 8 checklist requires that review.
insert into public.club_staff_roles (club_id, user_id, role, is_active)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p.id, p.role, true
from public.profiles as p
where p.role in ('staff', 'admin')
on conflict (club_id, user_id) do update
set role = excluded.role,
    is_active = true;

insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by, is_active)
select csr.club_id, csr.user_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', null, true
from public.club_staff_roles as csr
where csr.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and csr.role = 'staff'
on conflict (club_id, user_id, venue_id) do update
set is_active = true;

do $$
begin
  if exists (select 1 from public.members where club_id is null)
    or exists (select 1 from public.courts where club_id is null or venue_id is null)
    or exists (select 1 from public.court_sessions where club_id is null or venue_id is null)
    or exists (select 1 from public.bookings where club_id is null or venue_id is null)
    or exists (select 1 from public.open_plays where club_id is null or venue_id is null)
    or exists (select 1 from public.open_play_signups where club_id is null or venue_id is null)
    or exists (select 1 from public.checkins where club_id is null or venue_id is null)
    or exists (select 1 from public.walkins where club_id is null or venue_id is null)
    or exists (select 1 from public.transactions where club_id is null)
    or exists (select 1 from public.notifications where club_id is null)
    or exists (select 1 from public.reminders where club_id is null) then
    raise exception 'tenant ownership backfill left orphaned rows';
  end if;

  if exists (
    select 1
    from public.court_sessions s
    left join public.courts c on c.id = s.court_id
    left join public.members m on m.id = s.member_id
    left join public.bookings b on b.id = s.booking_id
    where c.id is null
       or (s.club_id, s.venue_id) is distinct from (c.club_id, c.venue_id)
       or (m.id is not null and m.club_id is distinct from s.club_id)
       or (b.id is not null and (b.club_id, b.venue_id) is distinct from (s.club_id, s.venue_id))
  ) then raise exception 'court session ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.bookings b
    left join public.courts c on c.id = b.court_id
    left join public.members m on m.id = b.member_id
    left join public.court_sessions s on s.id = b.session_id
    where c.id is null
       or (b.club_id, b.venue_id) is distinct from (c.club_id, c.venue_id)
       or (m.id is not null and m.club_id is distinct from b.club_id)
       or (s.id is not null and (s.club_id, s.venue_id) is distinct from (b.club_id, b.venue_id))
  ) then raise exception 'booking ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.open_plays o
    left join public.venues v on v.id = o.venue_id and v.club_id = o.club_id
    left join public.courts c on c.id = o.court_id
    where v.id is null
       or (c.id is not null and (c.club_id, c.venue_id) is distinct from (o.club_id, o.venue_id))
  ) then raise exception 'open-play ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.open_play_signups s
    left join public.open_plays o on o.id = s.open_play_id
    left join public.members m on m.id = s.member_id
    where o.id is null or m.id is null
       or (s.club_id, s.venue_id) is distinct from (o.club_id, o.venue_id)
       or m.club_id is distinct from s.club_id
  ) then raise exception 'open-play signup ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.checkins c
    left join public.members m on m.id = c.member_id
    left join public.venues v on v.id = c.venue_id and v.club_id = c.club_id
    where m.id is null or v.id is null or m.club_id is distinct from c.club_id
  ) then raise exception 'check-in ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.transactions t
    left join public.members m on m.id = t.member_id
    left join public.venues v on v.id = t.venue_id and v.club_id = t.club_id
    where (m.id is not null and m.club_id is distinct from t.club_id)
       or (t.venue_id is not null and v.id is null)
  ) then raise exception 'transaction ownership relationships are inconsistent'; end if;

  if exists (
    select 1
    from public.reminders r
    left join public.venues v on v.id = r.venue_id and v.club_id = r.club_id
    left join public.bookings b on b.id = r.booking_id
    left join public.open_plays o on o.id = r.open_play_id
    where (r.venue_id is not null and v.id is null)
       or (b.id is not null and b.club_id is distinct from r.club_id)
       or (o.id is not null and o.club_id is distinct from r.club_id)
  ) then raise exception 'reminder ownership relationships are inconsistent'; end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.court_sessions a
    join public.court_sessions b on b.club_id = a.club_id and b.court_id = a.court_id
      and b.id > a.id and b.status in ('scheduled', 'playing', 'pending_payment')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
    where a.status in ('scheduled', 'playing', 'pending_payment')
  ) then raise exception 'existing court sessions overlap; reconcile before tenant cutover'; end if;

  if exists (
    select 1 from public.bookings a
    join public.bookings b on b.club_id = a.club_id and b.court_id = a.court_id
      and b.id > a.id and b.session_id is null and b.status in ('pending_payment', 'confirmed')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
    where a.session_id is null and a.status in ('pending_payment', 'confirmed')
  ) then raise exception 'existing bookings overlap; reconcile before tenant cutover'; end if;

  if exists (
    select 1 from public.open_plays a
    join public.open_plays b on b.club_id = a.club_id and b.court_id = a.court_id
      and b.id > a.id and b.status in ('open', 'full')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(a.start_at, a.end_at, '[)')
    where a.court_id is not null and a.status in ('open', 'full')
  ) then raise exception 'existing open-play sessions overlap; reconcile before tenant cutover'; end if;

  if exists (
    select 1 from public.court_sessions s
    join public.bookings b on b.club_id = s.club_id and b.court_id = s.court_id
      and b.session_id is null and b.status in ('pending_payment', 'confirmed')
      and s.status in ('scheduled', 'playing', 'pending_payment')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(s.start_at, s.end_at, '[)')
  ) then raise exception 'existing bookings and court sessions overlap; reconcile before tenant cutover'; end if;

  if exists (
    select 1 from public.court_sessions s
    join public.open_plays o on o.club_id = s.club_id and o.court_id = s.court_id
      and o.status in ('open', 'full') and s.status in ('scheduled', 'playing', 'pending_payment')
      and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(s.start_at, s.end_at, '[)')
  ) then raise exception 'existing open-play and session intervals overlap; reconcile before tenant cutover'; end if;

  if exists (
    select 1 from public.bookings b
    join public.open_plays o on o.club_id = b.club_id and o.court_id = b.court_id
      and o.status in ('open', 'full') and b.session_id is null and b.status in ('pending_payment', 'confirmed')
      and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
  ) then raise exception 'existing open-play and booking intervals overlap; reconcile before tenant cutover'; end if;
end;
$$;

insert into public.court_allocations (
  club_id, venue_id, court_id, source, source_id, interval, status, created_by
)
select club_id, venue_id, court_id, 'session', id, tstzrange(start_at, end_at, '[)'),
       case when status = 'playing' then 'playing' else 'reserved' end, created_by
from public.court_sessions
where status in ('scheduled', 'playing', 'pending_payment')
on conflict (source, source_id) do nothing;

insert into public.court_allocations (
  club_id, venue_id, court_id, source, source_id, interval, status
)
select club_id, venue_id, court_id, 'booking', id, tstzrange(start_at, end_at, '[)'), 'reserved'
from public.bookings
where session_id is null and status in ('pending_payment', 'confirmed')
on conflict (source, source_id) do nothing;

insert into public.court_allocations (
  club_id, venue_id, court_id, source, source_id, interval, status, created_by
)
select club_id, venue_id, court_id, 'open_play', id, tstzrange(start_at, end_at, '[)'), 'reserved', created_by
from public.open_plays
where court_id is not null and status in ('open', 'full')
on conflict (source, source_id) do nothing;

do $$
declare
  v_counts jsonb;
begin
  select jsonb_build_object(
    'members', (select count(*) from public.members),
    'courts', (select count(*) from public.courts),
    'court_sessions', (select count(*) from public.court_sessions),
    'bookings', (select count(*) from public.bookings),
    'open_plays', (select count(*) from public.open_plays),
    'open_play_signups', (select count(*) from public.open_play_signups),
    'checkins', (select count(*) from public.checkins),
    'walkins', (select count(*) from public.walkins),
    'transactions', (select count(*) from public.transactions),
    'notifications', (select count(*) from public.notifications),
    'reminders', (select count(*) from public.reminders),
    'court_allocations', (select count(*) from public.court_allocations),
    'club_staff_roles', (select count(*) from public.club_staff_roles),
    'staff_venue_grants', (select count(*) from public.staff_venue_grants)
  ) into v_counts;
  raise notice 'tenant backfill after counts: %', v_counts;
end;
$$;
