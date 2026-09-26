begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(68);

-- Two ordinary Rally members, one operator, one admin, and a foreign member.
insert into auth.users (id, email, raw_user_meta_data)
select md5('privacy-user-' || n)::uuid, 'privacy-' || n || '@fixture.invalid',
       jsonb_build_object('full_name', 'Privacy Member ' || n)
from generate_series(1, 5) n;
-- Trusted setup only: preserve representative legacy operator identities too.
update public.profiles set role = 'staff' where id = md5('privacy-user-3')::uuid;
update public.profiles set role = 'admin' where id = md5('privacy-user-4')::uuid;
update public.members set club_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where user_id = md5('privacy-user-5')::uuid;
insert into public.club_staff_roles (club_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', md5('privacy-user-3')::uuid, 'staff'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', md5('privacy-user-4')::uuid, 'admin');
insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', md5('privacy-user-3')::uuid,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', md5('privacy-user-4')::uuid);

create temporary table privacy_fixture as
select n, md5('privacy-row-' || n)::uuid as id, m.id as member_id,
       m.club_id, v.id as venue_id,
       (select c.id from public.courts c where c.venue_id = v.id order by c.id limit 1) as court_id,
       timestamptz '2098-06-01 00:00:00+00' + n * interval '3 hours' as start_at
from (values (1, 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'::uuid),
             (2, 2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'::uuid),
             (3, 2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'::uuid),
             (4, 5, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'::uuid)) f(n, user_n, venue_id)
join public.members m on m.user_id = md5('privacy-user-' || user_n)::uuid
join public.venues v on v.id = f.venue_id and v.club_id = m.club_id;

insert into public.bookings (id, club_id, venue_id, court_id, member_id, start_at, end_at, hours, amount, status)
select id, club_id, venue_id, court_id, member_id, start_at, start_at + interval '1 hour', 1, 500, 'pending_payment' from privacy_fixture;
insert into public.court_sessions (id, club_id, venue_id, court_id, member_id, start_at, end_at, amount, guest_name, notes)
select id, club_id, venue_id, court_id, member_id, start_at + interval '1 hour', start_at + interval '2 hours', 500, 'Private guest', 'Private note' from privacy_fixture;
insert into public.open_plays (id, club_id, venue_id, court_id, title, start_at, end_at, capacity)
select id, club_id, venue_id, court_id, 'Public event', start_at + interval '2 hours', start_at + interval '3 hours', 8 from privacy_fixture;
insert into public.open_play_signups (id, club_id, venue_id, open_play_id, member_id)
select id, club_id, venue_id, id, member_id from privacy_fixture;
insert into public.checkins (id, club_id, venue_id, member_id, note)
select id, club_id, venue_id, member_id, 'Private check-in' from privacy_fixture;
insert into public.transactions (id, club_id, venue_id, member_id, amount, description)
select id, club_id, venue_id, member_id, 500, 'Private charge' from privacy_fixture;
insert into public.walkins (id, club_id, venue_id, full_name, phone, purpose)
select id, club_id, venue_id, 'Private guest', '09170000000', 'Private visit' from privacy_fixture;
insert into public.court_allocations (id, club_id, venue_id, court_id, source, source_id, interval, status)
select id, club_id, venue_id, court_id, 'booking', id, tstzrange(start_at, start_at + interval '1 hour', '[)'), 'reserved' from privacy_fixture;

-- Club-wide financial entries, a guest charge, and private signups sharing one
-- event exercise cases hidden by one-member-per-club fixture designs.
insert into public.transactions (id, club_id, venue_id, member_id, amount, description)
select md5('privacy-club-charge-' || n)::uuid, club_id, null, member_id, 1000, 'Private membership charge'
from privacy_fixture where n in (1,2);
insert into public.transactions (id, club_id, venue_id, member_id, amount, description)
select md5('privacy-guest-charge')::uuid, club_id, venue_id, null, 100, 'Guest charge'
from privacy_fixture where n = 1;
insert into public.open_play_signups (club_id, venue_id, open_play_id, member_id, status)
select f.club_id, f.venue_id, f.id, m.id,
       case extra.user_n when 2 then 'joined' when 3 then 'waitlist' else 'cancelled' end::public.open_play_signup_status
from privacy_fixture f cross join generate_series(2,4) extra(user_n)
join public.members m on m.user_id = md5('privacy-user-' || extra.user_n)::uuid
where f.n = 1;

-- Invoker-only helper: every assertion runs under the real caller's RLS/grants.
create function pg_temp.privacy_counts(label text, own_count integer, operational_count integer)
returns setof text language plpgsql security invoker as $$
declare t text; n integer;
begin
  foreach t in array array['bookings','court_sessions','open_play_signups','checkins','transactions','walkins','court_allocations'] loop
    execute format('select count(*)::int from public.%I where id in (select md5(''privacy-row-'' || n)::uuid from generate_series(1,4) n)', t) into n;
    return next extensions.is(n, case when t in ('walkins','court_allocations') then operational_count else own_count end, label || ': ' || t);
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('privacy-user-1')::uuid::text, true);
select * from pg_temp.privacy_counts('member A cannot read peers or guest records', 1, 0);
select extensions.is((select count(*)::int from public.transactions where id = md5('privacy-club-charge-1')::uuid), 1, 'owner sees own club-wide charge');
select extensions.is((select count(*)::int from public.transactions where id = md5('privacy-club-charge-2')::uuid), 0, 'member cannot see peer club-wide charge');
select extensions.is((select count(*)::int from public.transactions where id = md5('privacy-guest-charge')::uuid), 0, 'member cannot see guest charge with null owner');
select extensions.is((select count(*)::int from public.open_play_signups where open_play_id = md5('privacy-row-1')::uuid), 1, 'shared event does not expose peer signups');
select extensions.is((select seats_taken from public.open_play_seat_counts where open_play_id = md5('privacy-row-1')::uuid), 2, 'aggregate includes peers but excludes waitlist and cancelled');
select extensions.is((select count(*)::int from public.open_play_seat_counts where open_play_id = md5('privacy-row-4')::uuid), 0, 'aggregate rejects forged foreign event ID');
select extensions.is((select count(*)::int from public.open_play_seat_counts where open_play_id = md5('privacy-row-3')::uuid), 1, 'member can discover counts across own-club venues');
select extensions.is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'open_play_seat_counts'), array['club_id','venue_id','open_play_id','seats_taken'], 'aggregate has exactly the approved non-identifying fields');
select extensions.ok(not has_table_privilege('authenticated', 'public.open_play_seat_counts', 'insert,update,delete'), 'aggregate does not grant client writes');
select extensions.is((select count(*)::int from public.bookings where id = md5('privacy-row-2')::uuid), 0, 'forged same-club booking ID is denied');
select extensions.is((select count(*)::int from public.public_schedule where id in (select md5('privacy-row-' || n)::uuid from generate_series(1,4) n)), 9, 'safe schedule still exposes all three kinds of Rally occupied interval');

select set_config('request.jwt.claim.sub', md5('privacy-user-2')::uuid::text, true);
select * from pg_temp.privacy_counts('member B owns rows across both venues', 2, 0);
select set_config('request.jwt.claim.sub', md5('privacy-user-3')::uuid::text, true);
select * from pg_temp.privacy_counts('staff sees assigned venue only', 2, 2);
select extensions.is((select count(*)::int from public.transactions where id = md5('privacy-club-charge-2')::uuid), 0, 'staff cannot read club-wide member payments');
select extensions.is((select count(*)::int from public.transactions where id = md5('privacy-guest-charge')::uuid), 1, 'assigned staff sees guest charge');
select extensions.is((select count(*)::int from public.open_play_seat_counts where open_play_id = md5('privacy-row-3')::uuid), 0, 'staff cannot use aggregate to reach unassigned venue');
select set_config('request.jwt.claim.sub', md5('privacy-user-4')::uuid::text, true);
select * from pg_temp.privacy_counts('admin sees own-club venues only', 3, 3);
select extensions.is((select count(*)::int from public.transactions where id in (md5('privacy-club-charge-1')::uuid, md5('privacy-club-charge-2')::uuid)), 2, 'admin can read own-club membership charges');
select extensions.is((select count(*)::int from public.open_play_seat_counts where open_play_id in (select md5('privacy-row-' || n)::uuid from generate_series(1,4) n)), 3, 'admin aggregate is still fixed-club scoped');
select set_config('request.jwt.claim.sub', md5('privacy-user-5')::uuid::text, true);
select * from pg_temp.privacy_counts('foreign member cannot access fixed Rally club', 0, 0);
select extensions.is((select count(*)::int from public.open_play_seat_counts), 0, 'foreign member has no aggregate access');

set local role postgres;
update public.staff_venue_grants set is_active = false where user_id = md5('privacy-user-3')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('privacy-user-3')::uuid::text, true);
select * from pg_temp.privacy_counts('revoked staff loses operational reads', 0, 0);
select extensions.is((select count(*)::int from public.open_play_seat_counts), 0, 'revocation removes aggregate access immediately');

select set_config('request.jwt.claim.sub', '', true);
select extensions.is((select count(*)::int from public.open_play_seat_counts), 0, 'missing user identity cannot read aggregates');
select extensions.is((select count(*)::int from public.transactions), 0, 'missing user identity cannot read financial rows');

set local role anon;
select extensions.throws_ok('select * from public.open_play_seat_counts', '42501', null, 'anonymous aggregate read is denied');
select extensions.throws_ok('select * from public.transactions', '42501', null, 'anonymous financial read is denied');
select extensions.throws_ok('select * from public.walkins', '42501', null, 'anonymous guest read is denied');
select extensions.throws_ok('select * from public.court_allocations', '42501', null, 'anonymous allocation read is denied');
select extensions.throws_ok('select * from public.open_play_signups', '42501', null, 'anonymous signup read is denied');
select extensions.is((select count(*)::int from public.public_schedule where id = md5('privacy-row-2')::uuid and title in ('Reserved','In use','Open play')), 3, 'public schedule contains only safe labels for peer activity');
select * from extensions.finish();
rollback;
