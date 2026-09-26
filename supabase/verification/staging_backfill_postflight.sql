-- Read-only assertions for the confirmed empty-activity/four-court staging baseline.
select jsonb_build_object(
  'club_count', (select count(*) from public.clubs),
  'venue_count', (select count(*) from public.venues),
  'courts', (select count(*) from public.courts),
  'incorrect_court_ownership', (select count(*) from public.courts
    where club_id is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
       or venue_id is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'::uuid),
  'court_venue_mismatches', (select count(*) from public.courts c
    left join public.venues v on v.id = c.venue_id and v.club_id = c.club_id
    where v.id is null),
  'legacy_court_content_md5', (select md5(string_agg(
    (to_jsonb(c) - 'club_id' - 'venue_id')::text, chr(10)
    order by (to_jsonb(c) - 'club_id' - 'venue_id')::text collate "C")) from public.courts c),
  'activity_rows', (select
    (select count(*) from public.bookings) +
    (select count(*) from public.court_sessions) +
    (select count(*) from public.open_plays) +
    (select count(*) from public.open_play_signups) +
    (select count(*) from public.checkins) +
    (select count(*) from public.walkins) +
    (select count(*) from public.transactions) +
    (select count(*) from public.notifications) +
    (select count(*) from public.reminders)),
  'profiles', (select count(*) from public.profiles),
  'members', (select count(*) from public.members),
  'staff_assignments', (select count(*) from public.club_staff_roles),
  'allocations', (select count(*) from public.court_allocations),
  'verified_historical_charges', (select count(*) from public.transactions
    where verification_status is distinct from 'unverified'),
  'overlaps', (select count(*) from public.court_allocations a
    join public.court_allocations b on a.id < b.id and a.court_id = b.court_id
      and a.interval && b.interval
    where a.status in ('held','reserved','playing') and b.status in ('held','reserved','playing')),
  'legacy_booking_insert', has_table_privilege('authenticated','public.bookings','INSERT'),
  'legacy_member_update', has_table_privilege('authenticated','public.members','UPDATE'),
  'legacy_transaction_insert', has_table_privilege('authenticated','public.transactions','INSERT'),
  'ownership_still_nullable', not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('members','courts','bookings','court_sessions')
      and column_name in ('club_id','venue_id') and is_nullable <> 'YES'),
  'enforcement_constraint_present', exists (select 1 from pg_constraint
    where conname = 'court_allocations_no_overlap'),
  'applied_versions', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as postflight;
