-- Member GCash checkout postflight. Read-only: catalog, ledger and counts only.
-- Run against the target after 20261122090000_member_gcash_checkout.sql. Every row
-- with required = true must have ok = true.
-- This release adds a member write path into bookings and court_allocations through
-- five checked definer functions (hold, release, submit, staff confirm, staff reject).
-- The reservation-write pause itself is unchanged: no API role may write the paused
-- tables directly or run the nine paused booking functions.
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
), checkout_functions(signature) as (
  values
    ('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)'),
    ('public.release_booking_hold(uuid)'),
    ('public.submit_booking_payment(uuid, text)'),
    ('public.staff_confirm_booking_payment(uuid)'),
    ('public.staff_reject_booking_payment(uuid, text)')
), checkout_helpers(signature) as (
  values
    ('private.booking_slot_text(uuid)'),
    ('private.own_booking_for_update(uuid)'),
    ('private.payment_to_decide(uuid, text)'),
    ('private.release_lapsed_holds(uuid)')
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_member_gcash_checkout', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261122090000')
         and (select count(*) from supabase_migrations.schema_migrations) = 31,
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
  select 3, 'checkout_functions_signed_in_only', true,
         not exists (
           select 1 from checkout_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('service_role', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'the five checkout functions need a signed-in caller (they check the member, staff or admin inside)'
  union all
  select 4, 'checkout_helpers_private', true,
         not exists (
           select 1 from checkout_helpers f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or exists (select 1 from api_roles r
                         where has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE'))),
         'the four private helpers are run only by the checkout functions'
  union all
  select 5, 'new_functions_pin_search_path', true,
         not exists (
           select 1 from checkout_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}'))))
         and not exists (
           select 1 from checkout_helpers f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
         'checkout functions run with definer rights, helpers with the caller''s, all with an empty search path'
  union all
  select 6, 'booking_payment_columns', true,
         (select string_agg(column_name::text || ':' || data_type::text, ',' order by column_name::text)
          from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings'
            and column_name in ('hold_expires_at', 'payment_reference', 'payment_submitted_at', 'confirm_by'))
         = 'confirm_by:timestamp with time zone,hold_expires_at:timestamp with time zone,payment_reference:text,payment_submitted_at:timestamp with time zone'
         and (select count(*) from pg_constraint c
              where c.conrelid = 'public.bookings'::regclass and c.convalidated
                and c.conname in ('bookings_payment_reference_check', 'bookings_payment_submission_check')) = 2,
         'bookings hold the hold and payment columns, with the reference and submission checks'
  union all
  select 7, 'payment_reference_unique_per_club', true,
         exists (select 1 from pg_index i
                 join pg_class c on c.oid = i.indexrelid
                 where i.indrelid = 'public.bookings'::regclass and c.relname = 'bookings_club_payment_reference_key'
                   and i.indisunique and i.indisvalid),
         'a GCash reference pays for one live booking per club'
  union all
  select 8, 'schedule_board_still_shared', true,
         to_regclass('public.public_schedule') is not null
         and (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}'))
                     and p.prosrc like '%hold_expires_at%'
              from pg_proc p where p.oid = to_regprocedure('board.public_schedule_rows()'))
         and has_function_privilege('anon', 'board.public_schedule_rows()', 'EXECUTE')
         and has_function_privilege('authenticated', 'board.public_schedule_rows()', 'EXECUTE')
         and not has_function_privilege('public', 'board.public_schedule_rows()', 'EXECUTE'),
         'the TV board still reads the schedule function, which now leaves out lapsed unpaid holds'
  union all
  select 9, 'checkout_counts', false, true,
         (select count(*)::text from public.bookings where hold_expires_at is not null) || ' online holds, '
         || (select count(*)::text from public.bookings
             where status = 'pending_payment' and payment_submitted_at is not null) || ' payments waiting, '
         || (select count(*)::text from public.bookings
             where status = 'confirmed' and payment_reference is not null) || ' GCash bookings confirmed'
)
select check_name, required, ok, detail from checks order by sort;
