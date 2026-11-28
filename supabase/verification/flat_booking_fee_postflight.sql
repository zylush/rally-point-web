-- Flat booking fee postflight. Read-only: catalog, ledger and row counts only.
-- Run against the target after 20261127110000_flat_booking_fee.sql.
-- Every row with required = true must have ok = true.
-- This release replaces the percentage platform fee with a flat peso fee per court booking:
-- club_accounts.booking_fee and platform_commissions.booking_fee (default 0), every club's
-- percentage set to 0, the ledger trigger charging the flat fee (bookings and desk rentals,
-- never extensions, never more than the charge), the audited platform_set_booking_fee, and
-- platform_list_clubs returning booking_fee. No paused table or function changes.
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
), fee_columns(tbl, constraint_name) as (
  values ('public.club_accounts', 'club_accounts_booking_fee_check'),
         ('public.platform_commissions', 'platform_commissions_booking_fee_check')
), signed_in_functions(signature) as (
  values ('public.platform_set_booking_fee(uuid, numeric)'), ('public.platform_list_clubs()')
), rate_setters(signature) as (
  values ('public.platform_set_commission_rate(uuid, numeric)'),
         ('public.platform_provision_club(text, text, text, text, text, text, numeric, integer)')
), changed_functions(signature) as (
  select signature from signed_in_functions
  union all select 'private.record_platform_commission()'
  union all select signature from rate_setters
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_flat_booking_fee', true,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261127110000')
         and (select count(*) from supabase_migrations.schema_migrations) = 44,
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
  select 3, 'booking_fee_columns_checked', true,
         not exists (
           select 1 from fee_columns c
           left join pg_attribute a on a.attrelid = to_regclass(c.tbl) and a.attname = 'booking_fee' and not a.attisdropped
           left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attnum is null or not a.attnotnull
              or format_type(a.atttypid, a.atttypmod) <> 'numeric(10,2)'
              or coalesce(pg_get_expr(d.adbin, d.adrelid), '') <> '0'
              or not exists (select 1 from pg_constraint k where k.conrelid = to_regclass(c.tbl)
                             and k.conname = c.constraint_name and k.convalidated)),
         'club_accounts and platform_commissions carry a checked booking_fee in pesos that defaults to 0'
  union all
  select 4, 'percentage_retired', true,
         not exists (select 1 from public.club_accounts where commission_rate <> 0)
         and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
              join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
              where d.adrelid = 'public.club_accounts'::regclass and a.attname = 'commission_rate') = '0',
         (select count(*)::text from public.club_accounts) || ' club accounts, none with a percentage; new clubs start at 0'
  union all
  select 5, 'fee_functions_signed_in_only', true,
         not exists (
           select 1 from signed_in_functions f
           where to_regprocedure(f.signature) is null
              or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE'))
         and coalesce((select 'booking_fee' = any(p.proargnames) from pg_proc p where p.oid = 'public.platform_list_clubs()'::regprocedure), false),
         'platform_set_booking_fee and platform_list_clubs (now with booking_fee) need a signed-in caller; the superadmin check is inside'
  union all
  select 6, 'changed_functions_pin_search_path', true,
         not exists (
           select 1 from changed_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or not p.prosecdef
              or not ('search_path=""' = any(coalesce(p.proconfig, '{}')))
              or pg_get_userbyid(p.proowner) <> 'postgres')
         and not exists (select 1 from api_roles r
                         where has_function_privilege(r.name, 'private.record_platform_commission()', 'EXECUTE')),
         'the five new or changed functions run with definer rights, an empty search path, and postgres as owner; the trigger function stays private'
  union all
  select 7, 'fee_trigger_covers_court_time_only', true,
         exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.transactions'::regclass
                   and t.tgname = 'transactions_record_platform_commission' and t.tgenabled <> 'D'
                   and pg_get_triggerdef(t.oid) ~ 'booking' and pg_get_triggerdef(t.oid) ~ 'court_rental'
                   and pg_get_triggerdef(t.oid) ~ 'extension' and pg_get_triggerdef(t.oid) !~ 'membership'
                   and pg_get_triggerdef(t.oid) !~ 'walk_in'),
         'the fee trigger is enabled and still records court time only (bookings, desk rentals, extensions)'
  union all
  select 8, 'rate_setters_take_no_percentage', true,
         not exists (
           select 1 from rate_setters f
           where to_regprocedure(f.signature) is null
              or pg_get_functiondef(to_regprocedure(f.signature)) !~ 'p_[a-z_]*rate is distinct from 0'
              or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
              or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE')),
         'platform_set_commission_rate and platform_provision_club keep their signatures and grants but accept only 0'
  union all
  select 9, 'booking_fee_counts', false, true,
         (select count(*)::text from public.club_accounts where booking_fee > 0) || ' clubs with a booking fee, '
         || (select count(*)::text from public.platform_commissions) || ' ledger lines, '
         || (select count(*)::text from public.platform_commissions where booking_fee > 0) || ' with a flat fee'
)
select check_name, required, ok, detail from checks order by sort;
