-- Rent-a-coach postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261124110000_rent_a_coach.sql. Every row with
-- required = true must have ok = true.
-- This release adds coach time slots, lesson requests and private player/coach messages.
-- The three new tables are closed to API roles; everything goes through fifteen checked
-- definer functions for signed-in callers. Coaching reserves no court and takes no payment,
-- so the reservation-write pause is unchanged.
with paused_tables(name) as (
  values ('bookings'), ('court_sessions'), ('open_plays'), ('open_play_signups'), ('court_allocations'), ('courts')
), paused_functions(signature) as (
  values
    ('public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)'),
    ('public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer)'),
    ('public.add_member_to_session(uuid, uuid)'),
    ('public.extend_desk_session(uuid, integer)'),
    ('public.end_desk_session(uuid)'),
    ('public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)'),
    ('public.join_open_play_session(uuid, uuid)'),
    ('public.leave_open_play_session(uuid, uuid)'),
    ('public.cancel_booking_reservation(uuid)')
), api_roles(name) as (
  values ('anon'), ('authenticated'), ('service_role')
), coach_tables(name) as (
  values ('coach_booking_slots'), ('coach_booking_requests'), ('coach_request_messages')
), coach_functions(signature) as (
  values
    ('public.admin_link_club_coach_account(uuid, text)'),
    ('public.admin_remove_club_coach(uuid)'),
    ('public.coach_list_my_requests()'),
    ('public.coach_list_my_slots()'),
    ('public.coach_list_request_messages(uuid)'),
    ('public.coach_my_profiles()'),
    ('public.coach_respond_to_booking_request(uuid, boolean)'),
    ('public.coach_send_request_message(uuid, text)'),
    ('public.coach_set_booking_policy(uuid, text)'),
    ('public.coach_set_booking_slot_open(uuid, boolean)'),
    ('public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer)'),
    ('public.member_cancel_coach_request(uuid)'),
    ('public.member_list_coach_slots(timestamptz, timestamptz)'),
    ('public.member_list_my_coach_requests()'),
    ('public.member_request_coach_slot(uuid, integer, text)')
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_rent_a_coach', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261124110000')
         and (select count(*) from supabase_migrations.schema_migrations) = 34,
         (select count(*)::text from supabase_migrations.schema_migrations) || ' versions recorded'
  union all
  select 2, 'reservation_writes_still_paused', true,
         not exists (
           select 1 from paused_tables t, api_roles r
           where has_table_privilege(r.name, format('public.%I', t.name), 'INSERT, UPDATE, DELETE, TRUNCATE'))
         and not exists (
           select 1 from paused_functions f, api_roles r
           where has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE')),
         'no API role can write paused tables or run paused booking functions'
  union all
  select 3, 'coach_tables_closed', true,
         not exists (
           select 1 from coach_tables t
           left join pg_class c on c.oid = to_regclass(format('public.%I', t.name))
           where c.oid is null or not c.relrowsecurity
              or has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
              or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')),
         'the coach tables have row security and no direct access for anon or signed-in callers'
  union all
  select 4, 'coach_functions_signed_in_only', true,
         not exists (
           select 1 from coach_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the fifteen coach functions need a signed-in caller (they check the coach, player or admin inside)'
  union all
  select 5, 'coach_functions_pin_search_path', true,
         not exists (
           select 1 from coach_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
         'coach functions run with definer rights and a fixed search path'
  union all
  select 6, 'coach_foreign_keys_indexed', true,
         not exists (
           select 1 from pg_constraint c
           where c.contype = 'f'
             and c.conrelid in ('public.club_coaches'::regclass, 'public.coach_booking_slots'::regclass,
                                'public.coach_booking_requests'::regclass, 'public.coach_request_messages'::regclass)
             and not exists (
               select 1 from pg_index i
               where i.indrelid = c.conrelid
                 and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])),
         'every coach foreign key has an index in its own column order'
  union all
  select 7, 'coach_counts', false, true,
         (select count(*)::text from public.coach_booking_slots) || ' coach slots, '
         || (select count(*)::text from public.coach_booking_requests) || ' lesson requests, '
         || (select count(*)::text from public.coach_request_messages) || ' messages'
)
select check_name, required, ok, detail from checks order by sort;
