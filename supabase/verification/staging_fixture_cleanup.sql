-- Public-data cleanup companion for staging_fixture.sql.
-- Replace the same six Auth UUID tokens and run in an explicit transaction.
-- The preflight refuses cleanup if the deterministic fixture marker is absent.
-- After this transaction commits, delete the six synthetic Auth accounts via
-- the trusted Supabase Auth Admin path; do not manage hosted Auth by direct SQL.

do $fixture_cleanup_preflight$
begin
  if (select count(*) from public.members
      where user_id in (
        '{{RALLY_MEMBER_USER_ID}}'::uuid, '{{RALLY_ADMIN_USER_ID}}'::uuid,
        '{{RALLY_STAFF_USER_ID}}'::uuid, '{{SECOND_MEMBER_USER_ID}}'::uuid,
        '{{SECOND_ADMIN_USER_ID}}'::uuid, '{{SECOND_STAFF_USER_ID}}'::uuid
      ) and notes = '[tenant-fixture-v1]') <> 6 then
    raise exception 'cleanup refused: six fixture memberships with the expected marker were not found';
  end if;

  if (select count(*) from public.court_allocations where id in (
        '71000000-0000-4000-8c00-000000000001'::uuid,
        '71000000-0000-4000-8c00-000000000002'::uuid,
        '71000000-0000-4000-8c00-000000000003'::uuid,
        '72000000-0000-4000-8c00-000000000001'::uuid,
        '72000000-0000-4000-8c00-000000000002'::uuid,
        '72000000-0000-4000-8c00-000000000003'::uuid
      )) <> 6 then
    raise exception 'cleanup refused: complete fixture allocation set was not found';
  end if;
end
$fixture_cleanup_preflight$;

delete from public.court_allocations where id in (
  '71000000-0000-4000-8c00-000000000001',
  '71000000-0000-4000-8c00-000000000002',
  '71000000-0000-4000-8c00-000000000003',
  '72000000-0000-4000-8c00-000000000001',
  '72000000-0000-4000-8c00-000000000002',
  '72000000-0000-4000-8c00-000000000003'
);
delete from public.reminders where id in (
  '71000000-0000-4000-8b00-000000000001', '72000000-0000-4000-8b00-000000000001'
);
delete from public.notifications where id in (
  '71000000-0000-4000-8a00-000000000001', '72000000-0000-4000-8a00-000000000001'
);
delete from public.open_play_signups where id in (
  '71000000-0000-4000-8600-000000000001', '72000000-0000-4000-8600-000000000001'
);
delete from public.checkins where id in (
  '71000000-0000-4000-8700-000000000001', '72000000-0000-4000-8700-000000000001'
);
delete from public.walkins where id in (
  '71000000-0000-4000-8800-000000000001', '72000000-0000-4000-8800-000000000001'
);
delete from public.transactions where id in (
  '71000000-0000-4000-8900-000000000001', '72000000-0000-4000-8900-000000000001'
);
delete from public.court_sessions where id in (
  '71000000-0000-4000-8400-000000000001', '72000000-0000-4000-8400-000000000001'
);
delete from public.bookings where id in (
  '71000000-0000-4000-8300-000000000001', '72000000-0000-4000-8300-000000000001'
);
delete from public.open_plays where id in (
  '71000000-0000-4000-8500-000000000001', '72000000-0000-4000-8500-000000000001'
);
delete from public.staff_venue_grants where
  (club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '{{RALLY_STAFF_USER_ID}}' and venue_id = '71000000-0000-4000-8100-000000000001')
  or
  (club_id = '72000000-0000-4000-8000-000000000000' and user_id = '{{SECOND_STAFF_USER_ID}}' and venue_id = '72000000-0000-4000-8100-000000000001');
delete from public.club_staff_roles where
  (club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id in ('{{RALLY_ADMIN_USER_ID}}'::uuid, '{{RALLY_STAFF_USER_ID}}'::uuid))
  or
  (club_id = '72000000-0000-4000-8000-000000000000' and user_id in ('{{SECOND_ADMIN_USER_ID}}'::uuid, '{{SECOND_STAFF_USER_ID}}'::uuid));
delete from public.members where user_id in (
  '{{RALLY_MEMBER_USER_ID}}', '{{RALLY_ADMIN_USER_ID}}', '{{RALLY_STAFF_USER_ID}}',
  '{{SECOND_MEMBER_USER_ID}}', '{{SECOND_ADMIN_USER_ID}}', '{{SECOND_STAFF_USER_ID}}'
);
delete from public.courts where id in (
  '71000000-0000-4000-8200-000000000001',
  '72000000-0000-4000-8200-000000000001',
  '72000000-0000-4000-8200-000000000002'
);
delete from public.venues where id in (
  '71000000-0000-4000-8100-000000000001',
  '72000000-0000-4000-8100-000000000001',
  '72000000-0000-4000-8100-000000000002'
);
delete from public.clubs where id = '72000000-0000-4000-8000-000000000000';

do $fixture_cleanup_postflight$
begin
  if exists (
    select 1 from public.members where user_id in (
      '{{RALLY_MEMBER_USER_ID}}'::uuid, '{{RALLY_ADMIN_USER_ID}}'::uuid,
      '{{RALLY_STAFF_USER_ID}}'::uuid, '{{SECOND_MEMBER_USER_ID}}'::uuid,
      '{{SECOND_ADMIN_USER_ID}}'::uuid, '{{SECOND_STAFF_USER_ID}}'::uuid
    )
  ) or exists (
    select 1 from public.clubs where id = '72000000-0000-4000-8000-000000000000'::uuid
  ) or exists (
    select 1 from public.venues where id in (
      '71000000-0000-4000-8100-000000000001'::uuid,
      '72000000-0000-4000-8100-000000000001'::uuid,
      '72000000-0000-4000-8100-000000000002'::uuid
    )
  ) then
    raise exception 'fixture cleanup postflight found residual public fixture objects';
  end if;
end
$fixture_cleanup_postflight$;
