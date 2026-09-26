-- SELECT-only audit. Every row must show violation = false after the pause.
-- Run before and after enforcement; a later grant must not silently reopen
-- reservation writes. This does not replace attempted denied-write tests.
with table_targets(name) as (
  values ('bookings'), ('court_sessions'), ('open_plays'),
         ('open_play_signups'), ('court_allocations'), ('courts')
), function_targets(signature) as (
  values
    ('create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)'),
    ('create_desk_rental(uuid, uuid, uuid, uuid, text, integer)'),
    ('add_member_to_session(uuid, uuid)'),
    ('extend_desk_session(uuid, integer)'),
    ('end_desk_session(uuid)'),
    ('create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)'),
    ('join_open_play_session(uuid, uuid)'),
    ('leave_open_play_session(uuid, uuid)'),
    ('cancel_booking_reservation(uuid)')
), roles(name) as (
  values ('public'), ('anon'), ('authenticated'), ('service_role')
), checks as (
  select 'table write'::text as kind, r.name as role_name, t.name as target,
    to_regclass(format('public.%I', t.name)) is null
      or coalesce(has_table_privilege(r.name, to_regclass(format('public.%I', t.name)), 'INSERT, UPDATE, DELETE'), true)
      or coalesce(has_table_privilege(r.name, to_regclass(format('public.%I', t.name)), 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'), true)
      or coalesce(has_any_column_privilege(r.name, to_regclass(format('public.%I', t.name)), 'INSERT, UPDATE'), true)
      as violation
  from table_targets t cross join roles r
  union all
  select 'RPC execute', r.name, f.signature,
    to_regprocedure('public.' || f.signature) is null
      or coalesce(has_function_privilege(r.name, to_regprocedure('public.' || f.signature), 'EXECUTE'), true)
  from function_targets f cross join roles r
  union all
  select 'authenticated read', 'authenticated', t.name,
    not coalesce(has_table_privilege('authenticated', to_regclass(format('public.%I', t.name)), 'SELECT'), false)
  from table_targets t
)
select kind, role_name, target, violation from checks
order by violation desc, kind, role_name, target;
