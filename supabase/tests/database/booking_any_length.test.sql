begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select extensions.plan(7);

-- Bookings have no maximum length: one court, whole hours in a row, at least 1, ending by midnight.

-- 1-2: the table's hours rule is 1 to 24 and the old 1-to-3 rule is gone.
select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.bookings'::regclass and c.conname = 'bookings_hours_check'
      and pg_get_constraintdef(c.oid) ~ '>= 1' and pg_get_constraintdef(c.oid) ~ '<= 24'
  ),
  'bookings.hours allows 1 to 24 hours'
);
select extensions.ok(
  not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.bookings'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mhours\M' and pg_get_constraintdef(c.oid) ~ '<= 3\M'
  ),
  'no 3-hour cap is left on bookings'
);

-- 3-4: the hold function no longer caps the length, and still requires at least 1 hour and ending by midnight.
select extensions.ok(
  (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)'))
    !~ 'between 1 and 3',
  'hold_court_booking has no 3-hour cap'
);
select extensions.ok(
  (select p.prosrc ~ 'p_hours < 1' and p.prosrc ~ 'p_start_hour \+ p_hours > 24'
   from pg_proc p where p.oid = to_regprocedure('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)')),
  'hold_court_booking still needs at least 1 hour, ending by midnight'
);

-- 5-6: it keeps its security settings and owner.
select extensions.ok(
  (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}'))
   from pg_proc p where p.oid = to_regprocedure('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)')),
  'hold_court_booking stays security definer with an empty search_path'
);
select extensions.is(
  (select pg_get_userbyid(p.proowner)::text
   from pg_proc p where p.oid = to_regprocedure('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)')),
  'postgres',
  'hold_court_booking is owned by postgres'
);

-- 7: only signed-in people may call it, as before.
select extensions.ok(
  has_function_privilege('authenticated', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', 'EXECUTE'),
  'hold_court_booking is still for signed-in people only'
);

select * from extensions.finish();
rollback;
