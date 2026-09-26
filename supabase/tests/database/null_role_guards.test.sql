begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(36);

insert into public.clubs (id,slug,name) values ('72000000-0000-4000-8000-000000000001','guard-foreign','Guard foreign club');
insert into auth.users (id,email,raw_user_meta_data) values
('71000000-0000-4000-8000-000000000001','unassigned@guard.example.invalid','{"full_name":"unassigned"}'::jsonb),
('71000000-0000-4000-8000-000000000002','foreign-admin@guard.example.invalid','{"full_name":"foreign-admin"}'::jsonb),
('71000000-0000-4000-8000-000000000003','revoked-admin@guard.example.invalid','{"full_name":"revoked-admin"}'::jsonb),
('71000000-0000-4000-8000-000000000004','active-admin@guard.example.invalid','{"full_name":"active-admin"}'::jsonb),
('71000000-0000-4000-8000-000000000005','staff@guard.example.invalid','{"full_name":"staff"}'::jsonb);
delete from public.members where user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003');
insert into public.club_staff_roles (club_id,user_id,role,is_active) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','admin',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','71000000-0000-4000-8000-000000000003','admin',false),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','71000000-0000-4000-8000-000000000004','admin',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','71000000-0000-4000-8000-000000000005','staff',true);
insert into public.staff_venue_grants (club_id,user_id,venue_id,is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select extensions.throws_ok($test$select public.admin_upsert_venue(null,'guard-test','Guard Test','Asia/Manila',6::smallint,22::smallint,true)$test$,'P0001','admin access required','unassigned: select public.admin_upsert_venue denied');
select extensions.throws_ok($test$select public.admin_upsert_member(null,'Guard Test','guard@example.invalid',null,'standard','active',current_date,current_date+30,null)$test$,'P0001','admin access required','unassigned: select public.admin_upsert_member denied');
select extensions.throws_ok($test$select public.set_staff_venue_grant('71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',true)$test$,'P0001','admin access required','unassigned: select public.set_staff_venue_grant denied');
select extensions.throws_ok($test$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Guard Test',null,'play',0)$test$,'P0001','venue is outside assigned club','unassigned: select public.create_desk_walkin denied');
select extensions.throws_ok($test$select public.create_unpaid_desk_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,current_date,10,1)$test$,'P0001','venue is not assigned to this operator','unassigned: select public.create_unpaid_desk_booking denied');
select extensions.throws_ok($test$select public.create_desk_rental('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,'Guard Test',1)$test$,'P0001','venue is not assigned to this operator','unassigned: select public.create_desk_rental denied');
select extensions.throws_ok($test$select public.create_open_play_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,'Guard Test',now(),now()+interval '1 hour',4,0,'all',null)$test$,'P0001','venue is not assigned to this operator','unassigned: select public.create_open_play_session denied');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($test$select public.admin_upsert_venue(null,'guard-test','Guard Test','Asia/Manila',6::smallint,22::smallint,true)$test$,'P0001','admin access required','foreign-admin: select public.admin_upsert_venue denied');
select extensions.throws_ok($test$select public.admin_upsert_member(null,'Guard Test','guard@example.invalid',null,'standard','active',current_date,current_date+30,null)$test$,'P0001','admin access required','foreign-admin: select public.admin_upsert_member denied');
select extensions.throws_ok($test$select public.set_staff_venue_grant('71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',true)$test$,'P0001','admin access required','foreign-admin: select public.set_staff_venue_grant denied');
select extensions.throws_ok($test$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Guard Test',null,'play',0)$test$,'P0001','venue is outside assigned club','foreign-admin: select public.create_desk_walkin denied');
select extensions.throws_ok($test$select public.create_unpaid_desk_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,current_date,10,1)$test$,'P0001','venue is not assigned to this operator','foreign-admin: select public.create_unpaid_desk_booking denied');
select extensions.throws_ok($test$select public.create_desk_rental('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,'Guard Test',1)$test$,'P0001','venue is not assigned to this operator','foreign-admin: select public.create_desk_rental denied');
select extensions.throws_ok($test$select public.create_open_play_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,'Guard Test',now(),now()+interval '1 hour',4,0,'all',null)$test$,'P0001','venue is not assigned to this operator','foreign-admin: select public.create_open_play_session denied');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select extensions.throws_ok($test$select public.admin_upsert_venue(null,'guard-test','Guard Test','Asia/Manila',6::smallint,22::smallint,true)$test$,'P0001','admin access required','revoked-admin: select public.admin_upsert_venue denied');
select extensions.throws_ok($test$select public.admin_upsert_member(null,'Guard Test','guard@example.invalid',null,'standard','active',current_date,current_date+30,null)$test$,'P0001','admin access required','revoked-admin: select public.admin_upsert_member denied');
select extensions.throws_ok($test$select public.set_staff_venue_grant('71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',true)$test$,'P0001','admin access required','revoked-admin: select public.set_staff_venue_grant denied');
select extensions.throws_ok($test$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Guard Test',null,'play',0)$test$,'P0001','venue is outside assigned club','revoked-admin: select public.create_desk_walkin denied');
select extensions.throws_ok($test$select public.create_unpaid_desk_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,current_date,10,1)$test$,'P0001','venue is not assigned to this operator','revoked-admin: select public.create_unpaid_desk_booking denied');
select extensions.throws_ok($test$select public.create_desk_rental('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,'Guard Test',1)$test$,'P0001','venue is not assigned to this operator','revoked-admin: select public.create_desk_rental denied');
select extensions.throws_ok($test$select public.create_open_play_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,'Guard Test',now(),now()+interval '1 hour',4,0,'all',null)$test$,'P0001','venue is not assigned to this operator','revoked-admin: select public.create_open_play_session denied');
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok($test$select public.admin_upsert_venue(null,'guard-test','Guard Test','Asia/Manila',6::smallint,22::smallint,true)$test$,'P0001','admin access required','missing-auth: select public.admin_upsert_venue denied');
select extensions.throws_ok($test$select public.admin_upsert_member(null,'Guard Test','guard@example.invalid',null,'standard','active',current_date,current_date+30,null)$test$,'P0001','admin access required','missing-auth: select public.admin_upsert_member denied');
select extensions.throws_ok($test$select public.set_staff_venue_grant('71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',true)$test$,'P0001','admin access required','missing-auth: select public.set_staff_venue_grant denied');
select extensions.throws_ok($test$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Guard Test',null,'play',0)$test$,'P0001','venue is outside assigned club','missing-auth: select public.create_desk_walkin denied');
select extensions.throws_ok($test$select public.create_unpaid_desk_booking('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,current_date,10,1)$test$,'P0001','venue is not assigned to this operator','missing-auth: select public.create_unpaid_desk_booking denied');
select extensions.throws_ok($test$select public.create_desk_rental('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,'Guard Test',1)$test$,'P0001','venue is not assigned to this operator','missing-auth: select public.create_desk_rental denied');
select extensions.throws_ok($test$select public.create_open_play_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,'Guard Test',now(),now()+interval '1 hour',4,0,'all',null)$test$,'P0001','venue is not assigned to this operator','missing-auth: select public.create_open_play_session denied');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select extensions.throws_ok($test$select public.create_desk_walkin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Guard Test',null,'play',0)$test$,'P0001','venue is outside assigned club','revoked venue grant denies walk-in');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
select extensions.lives_ok($test$select public.admin_upsert_venue(null,'guard-test','Guard Test','Asia/Manila',6::smallint,22::smallint,true)$test$,'active admin: select public.admin_upsert_venue allowed');
select extensions.lives_ok($test$select public.admin_upsert_member(null,'Guard Test','guard@example.invalid',null,'standard','active',current_date,current_date+30,null)$test$,'active admin: select public.admin_upsert_member allowed');
select extensions.lives_ok($test$select public.set_staff_venue_grant('71000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',true)$test$,'active admin: select public.set_staff_venue_grant allowed');
select extensions.throws_ok($test$select public.create_desk_walkin(null,'Null venue',null,'play',0)$test$,'P0001','venue is outside assigned club','active admin cannot bypass scope with NULL IDs');
select extensions.throws_ok($test$select public.create_unpaid_desk_booking(null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,null,current_date,10,1)$test$,'P0001','venue is not assigned to this operator','active admin cannot bypass scope with NULL IDs');
select extensions.throws_ok($test$select public.create_desk_rental('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,null,'Null venue',1)$test$,'P0001','venue is not assigned to this operator','active admin cannot bypass scope with NULL IDs');
select extensions.throws_ok($test$select public.create_open_play_session(null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',null,'Null club',now(),now()+interval '1 hour',4,0,'all',null)$test$,'P0001','venue is not assigned to this operator','active admin cannot bypass scope with NULL IDs');
select * from extensions.finish();
rollback;
