-- Temporary release boundary. Apply in a reviewed pause-only package before
-- allowing any real reservation writer to run at the expanded/backfilled
-- boundary. Do not use an unrestricted db push: the older tenant enforcement
-- migration is still pending in staging. This migration does not enable it.
--
-- A single DO statement makes the preflight, revocations, and postflight
-- atomic even when a migration runner does not wrap the whole file.
do $reservation_pause$
declare
  v_table text;
  v_function text;
  v_role text;
  v_target regclass;
  v_rpc regprocedure;
  v_tables constant text[] := array[
    'bookings', 'court_sessions', 'open_plays', 'open_play_signups',
    'court_allocations', 'courts'
  ];
  v_functions constant text[] := array[
    'create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer)',
    'create_desk_rental(uuid, uuid, uuid, uuid, text, integer)',
    'add_member_to_session(uuid, uuid)',
    'extend_desk_session(uuid, integer)',
    'end_desk_session(uuid)',
    'create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text)',
    'join_open_play_session(uuid, uuid)',
    'leave_open_play_session(uuid, uuid)',
    'cancel_booking_reservation(uuid)'
  ];
begin
  if current_user <> 'postgres' then
    raise exception 'reservation pause must be applied by the postgres migration role';
  end if;

  foreach v_table in array v_tables loop
    v_target := to_regclass(format('public.%I', v_table));
    if v_target is null then
      raise exception 'reservation pause target is missing: %', v_table;
    end if;
    if not has_table_privilege('authenticated', v_target, 'SELECT') then
      raise exception 'reservation pause read baseline is missing: %', v_table;
    end if;
  end loop;
  foreach v_function in array v_functions loop
    if to_regprocedure('public.' || v_function) is null then
      raise exception 'reservation pause RPC is missing: %', v_function;
    end if;
  end loop;

  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.bookings from public, anon, authenticated, service_role;';
  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.court_sessions from public, anon, authenticated, service_role;';
  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.open_plays from public, anon, authenticated, service_role;';
  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.open_play_signups from public, anon, authenticated, service_role;';
  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.court_allocations from public, anon, authenticated, service_role;';
  execute 'revoke insert, update, delete, truncate, references, trigger, maintain on table public.courts from public, anon, authenticated, service_role;';

  execute 'revoke execute on function public.create_unpaid_desk_booking(uuid, uuid, uuid, uuid, date, integer, integer) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.create_desk_rental(uuid, uuid, uuid, uuid, text, integer) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.add_member_to_session(uuid, uuid) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.extend_desk_session(uuid, integer) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.end_desk_session(uuid) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.create_open_play_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer, numeric, public.skill_level, text) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.join_open_play_session(uuid, uuid) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.leave_open_play_session(uuid, uuid) from public, anon, authenticated, service_role;';
  execute 'revoke execute on function public.cancel_booking_reservation(uuid) from public, anon, authenticated, service_role;';

  -- Check effective permissions, not only explicit ACL entries. A role could
  -- otherwise inherit a table, column, or function privilege from elsewhere.
  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
    foreach v_table in array v_tables loop
      v_target := to_regclass(format('public.%I', v_table));
      if has_table_privilege(v_role, v_target, 'INSERT, UPDATE, DELETE')
        or has_table_privilege(v_role, v_target, 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
        or has_any_column_privilege(v_role, v_target, 'INSERT, UPDATE') then
        raise exception 'reservation pause direct write remains: % on %', v_role, v_table;
      end if;
    end loop;
    foreach v_function in array v_functions loop
      v_rpc := to_regprocedure('public.' || v_function);
      if has_function_privilege(v_role, v_rpc, 'EXECUTE') then
        raise exception 'reservation pause RPC remains callable: % on %', v_role, v_function;
      end if;
    end loop;
  end loop;

  foreach v_table in array v_tables loop
    if not has_table_privilege('authenticated', to_regclass(format('public.%I', v_table)), 'SELECT') then
      raise exception 'reservation pause removed authenticated read: %', v_table;
    end if;
  end loop;
end
$reservation_pause$;
