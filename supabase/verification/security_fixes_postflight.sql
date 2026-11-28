-- Security fixes postflight. Read-only: catalog, ledger and row counts only.
-- Run against the target after the nine migrations 20261128100000_booking_hold_limits.sql to
-- 20261128100800_suspended_member_payments.sql. Every row with required = true must have ok = true.
-- The database fixes from the security review of 2026-11-28: online holds at most 30 days ahead and
-- at most 4 sent payments waiting per player and club; a locked sign-in stays locked for the right
-- password; a club admin needs a confirmed email and is never a platform account; at most 3 coach
-- requests waiting per player and none while on hold; staff notes on a member stay with the club's
-- admins; desk walk-in amounts and text are checked; a support inquiry inserted through the API
-- starts unanswered; the coach side works only for an active coach at an open club, with limited
-- lesson threads and no player emails; a member on hold cannot send a GCash payment. Eighteen
-- functions are redefined, and three private helpers and one trigger are new; no table, policy or
-- table grant changes, and nothing in the reservation-write pause changes.
-- Each source check looks for the new lines (one line each, so it holds for LF and CRLF files).
-- Rows with required = false count rows stored before the fixes, which the migrations leave as they
-- are; ok is true when the count is 0. They give counts only (never names, emails, phones or ids)
-- and never stop a release.
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
), changed_functions(signature, definer, search_path, access) as (
  -- access: signed_in means a signed-in caller may run it (each checks the caller inside),
  -- closed means no API role may run it, and auth_hook means only the Auth service may run it.
  values
    ('public.hold_court_booking(uuid, uuid, uuid, date, integer, integer)', true, '""', 'signed_in'),
    ('private.auth_rate_limit_status(text, text, timestamptz)', false, '""', 'closed'),
    ('private.auth_rate_limit_password_verification(jsonb)', true, '""', 'auth_hook'),
    ('public.platform_assign_club_admin(uuid, text)', true, '""', 'signed_in'),
    ('public.platform_invite_club_owner(uuid, text)', true, '""', 'signed_in'),
    ('public.claim_my_owner_clubs()', true, '""', 'signed_in'),
    ('public.member_request_coach_slot(uuid, integer, text)', true, '""', 'signed_in'),
    ('private.member_self_rows()', true, '""', 'signed_in'),
    ('public.ensure_member_qr(uuid)', true, 'pg_catalog, public, private', 'signed_in'),
    ('public.create_desk_walkin(uuid, text, text, text, numeric)', true, 'pg_catalog, public, private', 'signed_in'),
    ('private.support_inquiry_insert_guard()', true, '""', 'closed'),
    ('private.coach_can_act(uuid)', false, '""', 'closed'),
    ('public.coach_set_booking_policy(uuid, text)', true, '""', 'signed_in'),
    ('public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer)', true, '""', 'signed_in'),
    ('public.coach_set_booking_slot_open(uuid, boolean)', true, '""', 'signed_in'),
    ('public.coach_list_my_slots()', true, '""', 'signed_in'),
    ('public.coach_list_my_requests()', true, '""', 'signed_in'),
    ('public.coach_respond_to_booking_request(uuid, boolean)', true, '""', 'signed_in'),
    ('public.coach_send_request_message(uuid, text)', true, '""', 'signed_in'),
    ('public.coach_list_request_messages(uuid)', true, '""', 'signed_in'),
    ('public.submit_booking_payment(uuid, text)', true, '""', 'signed_in')
), src(name, body) as (
  -- The function names above are unique, so each body is found by name.
  select p.proname::text, p.prosrc
  from changed_functions f
  join pg_proc p on p.oid = to_regprocedure(f.signature)
), stored as (
  -- Counts of rows stored before the fixes, for the information rows.
  select
    (select count(*) from public.transactions where type = 'walk_in') as walkin_charges,
    (select count(*) from public.transactions where type = 'walk_in' and amount < 0) as walkin_charges_negative,
    (select count(*) from public.transactions where type = 'walk_in' and amount > 100000) as walkin_charges_over_cap,
    (select count(*) from public.walkins where amount < 0) as walkin_records_negative,
    (select count(*) from public.support_inquiries) as inquiries,
    (select count(*) from public.support_inquiries
     where responded_at is not null and responded_at <= created_at) as inquiries_answered_at_once,
    (select count(*) from public.support_inquiries where created_at > now()) as inquiries_dated_ahead,
    (select count(*) from public.support_inquiries i
     where i.responded_by is not null
       and not exists (select 1 from public.club_staff_roles r
                       where r.club_id = i.club_id and r.user_id = i.responded_by and r.role = 'admin')) as inquiries_answered_by_non_admin,
    (select count(distinct p.user_id) from public.platform_roles p
     join public.club_staff_roles r on r.user_id = p.user_id and r.is_active) as platform_accounts_with_club_role,
    (select count(distinct p.user_id) from public.platform_roles p
     join public.club_staff_roles r on r.user_id = p.user_id and r.is_active and r.role = 'admin') as platform_accounts_as_club_admin,
    (select count(*) from (
       select 1 from public.bookings b
       where b.status = 'pending_payment' and b.hold_expires_at is not null and b.payment_submitted_at is not null
       group by b.club_id, b.member_id having count(*) > 4) x) as players_over_payment_cap,
    (select count(*) from (
       select 1 from public.coach_booking_requests r
       where r.status = 'requested'
       group by r.club_id, r.player_user_id having count(*) > 3) x) as players_over_coach_request_cap,
    (select count(*) from public.bookings b
     where b.hold_expires_at is not null and b.status in ('pending_payment', 'confirmed')
       and (b.start_at at time zone 'Asia/Manila')::date > (now() at time zone 'Asia/Manila')::date + 30) as online_bookings_past_window,
    (select count(*) from public.bookings b
     join public.members m on m.id = b.member_id
     where b.status = 'pending_payment' and b.payment_submitted_at is not null and m.status = 'suspended') as payments_waiting_from_suspended
), checks(sort, check_name, required, ok, detail) as (
  select 1, 'ledger_has_security_fixes', true,
         (select count(*) from supabase_migrations.schema_migrations
          where version in ('20261128100000', '20261128100100', '20261128100200', '20261128100300', '20261128100400',
                            '20261128100500', '20261128100600', '20261128100700', '20261128100800')) = 9
         and (select count(*) from supabase_migrations.schema_migrations) = 53,
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
  select 3, 'changed_functions_keep_settings', true,
         not exists (
           select 1 from changed_functions f
           left join pg_proc p on p.oid = to_regprocedure(f.signature)
           where p.oid is null or p.prosecdef is distinct from f.definer
              or not (('search_path=' || f.search_path) = any(coalesce(p.proconfig, '{}')))
              or pg_get_userbyid(p.proowner) <> 'postgres'),
         (select count(*)::text from changed_functions) || ' new or changed functions keep their definer or caller rights '
         || 'and search path (empty, or pg_catalog, public, private for ensure_member_qr and create_desk_walkin), owned by postgres'
  union all
  select 4, 'changed_functions_signed_in_only', true,
         not exists (
           select 1 from changed_functions f
           where f.access = 'signed_in'
             and (to_regprocedure(f.signature) is null
                  or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
                  or has_function_privilege('anon', to_regprocedure(f.signature), 'EXECUTE')
                  or not has_function_privilege('authenticated', to_regprocedure(f.signature), 'EXECUTE'))),
         (select count(*)::text from changed_functions where access = 'signed_in')
         || ' functions need a signed-in caller (each checks the caller inside); none is open to visitors'
  union all
  select 5, 'login_hook_for_auth_only', true,
         coalesce((
           select not has_function_privilege('public', p.oid, 'EXECUTE')
                  and not exists (select 1 from api_roles r where has_function_privilege(r.name, p.oid, 'EXECUTE'))
                  and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('private.auth_rate_limit_password_verification(jsonb)')), false),
         'only the Auth service (supabase_auth_admin) can run the password-verification hook'
  union all
  select 6, 'new_helpers_private', true,
         not exists (
           select 1 from changed_functions f
           where f.access = 'closed'
             and (to_regprocedure(f.signature) is null
                  or has_function_privilege('public', to_regprocedure(f.signature), 'EXECUTE')
                  or exists (select 1 from api_roles r where has_function_privilege(r.name, to_regprocedure(f.signature), 'EXECUTE')))),
         'no API role can run the lock lookup, the coach check or the inquiry guard'
  union all
  select 7, 'hold_window_and_payment_cap', true,
         coalesce((
           select strpos(body, 'c_booking_window_days constant integer := 30;') > 0
                  and strpos(body, 'p_date > (now() at time zone v_venue.timezone)::date + c_booking_window_days') > 0
                  and strpos(body, 'c_max_payments_waiting constant integer := 4;') > 0
                  and strpos(body, 'v_waiting >= c_max_payments_waiting') > 0
                  and strpos(body, 'v_waiting >= c_max_payments_waiting') < strpos(body, 'insert into public.bookings')
           from src where name = 'hold_court_booking'), false),
         'hold_court_booking takes a date at most 30 days ahead and refuses a new hold while 4 sent payments wait'
  union all
  select 8, 'locked_login_stays_locked', true,
         coalesce((
           select strpos(h.body, 'private.auth_rate_limit_status(') > 0
                  and strpos(h.body, 'private.auth_rate_limit_status(') < strpos(h.body, 'delete from private.auth_rate_limit_events')
                  and strpos(h.body, 'private.auth_rate_limit_check(') > 0
                  and strpos(s.body, 'v_attempt_count >= 5') > 0
                  and strpos(s.body, 'p_at - interval ''5 minutes''') > 0
                  and s.body !~* '\m(insert|update|delete)\M'
           from src h, src s
           where h.name = 'auth_rate_limit_password_verification' and s.name = 'auth_rate_limit_status'), false),
         'the sign-in hook looks at the lock before a right password clears the failures; the lookup records nothing'
  union all
  select 9, 'club_admins_confirmed_not_platform', true,
         coalesce((
           select strpos(a.body, 'and u.email_confirmed_at is not null') > 0
                  and strpos(a.body, 'join public.platform_roles r on r.user_id = u.id') > 0
                  and strpos(i.body, 'and u.email_confirmed_at is not null') > 0
                  and strpos(i.body, 'join public.platform_roles r on r.user_id = u.id') > 0
                  and strpos(i.body, 'join public.platform_roles r on r.user_id = u.id') < strpos(i.body, 'insert into public.club_staff_roles')
                  and strpos(i.body, 'join public.platform_roles r on r.user_id = u.id') < strpos(i.body, 'insert into public.club_owner_invites')
                  and strpos(c.body, 'not exists (select 1 from public.platform_roles r where r.user_id = v_user)') > 0
           from src a, src i, src c
           where a.name = 'platform_assign_club_admin' and i.name = 'platform_invite_club_owner' and c.name = 'claim_my_owner_clubs'), false),
         'assigning or inviting a club admin needs a confirmed email and refuses a platform account; sign-in claims no invite for one'
  union all
  select 10, 'coach_requests_capped', true,
         coalesce((
           select strpos(body, 'c_max_open_requests constant integer := 3;') > 0
                  and strpos(body, 'v_open >= c_max_open_requests') > 0
                  and strpos(body, 'm.status = ''suspended''') > 0
                  and strpos(body, 'hashtextextended(''coach_request:''') > 0
                  and strpos(body, 'v_open >= c_max_open_requests') < strpos(body, 'insert into public.coach_booking_requests')
           from src where name = 'member_request_coach_slot'), false),
         'a player may have at most 3 coach requests waiting per club, and none while on hold'
  union all
  select 11, 'member_notes_admins_only', true,
         coalesce((
           select strpos(s.body, 'm.notes') = 0
                  and strpos(s.body, 'null::text') > 0
                  and strpos(q.body, 'v.notes := null;') > 0
           from src s, src q
           where s.name = 'member_self_rows' and q.name = 'ensure_member_qr'), false)
         and exists (select 1 from pg_attribute a
                     where a.attrelid = to_regclass('public.member_self') and a.attname = 'notes' and not a.attisdropped),
         'the member''s own card and QR refresh leave staff notes out (admins still see them); member_self keeps its columns'
  union all
  select 12, 'walkin_entries_checked', true,
         coalesce((
           select strpos(body, 'p_amount < 0 or p_amount > 100000') > 0
                  and strpos(body, 'v_name := private.tidy_name(p_full_name);') > 0
                  and strpos(body, 'char_length(v_name) > 80') > 0
                  and strpos(body, 'char_length(v_phone) > 24') > 0
                  and strpos(body, 'char_length(v_purpose) > 200') > 0
                  and strpos(body, 'private.can_operate_venue(') < strpos(body, 'private.tidy_name(p_full_name)')
                  and strpos(body, 'p_amount < 0 or p_amount > 100000') < strpos(body, 'insert into public.walkins')
           from src where name = 'create_desk_walkin'), false),
         'a desk walk-in takes 0 to 100,000 pesos and a tidied name, phone and purpose of limited length, after the venue check'
  union all
  select 13, 'inquiry_insert_guard_enabled', true,
         exists (
           select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.support_inquiries')
             and t.tgname = 'support_inquiries_insert_guard' and not t.tgisinternal
             and t.tgenabled in ('O', 'A')
             and t.tgtype = 7
             and t.tgfoid = to_regprocedure('private.support_inquiry_insert_guard()')::oid
             and pg_get_triggerdef(t.oid) ~ '\manon\M' and pg_get_triggerdef(t.oid) ~ '\mauthenticated\M')
         and coalesce((
           select strpos(body, 'new.status := ''open'';') > 0
                  and strpos(body, 'new.response := null;') > 0
                  and strpos(body, 'new.responded_by := null;') > 0
                  and strpos(body, 'new.responded_at := null;') > 0
                  and strpos(body, 'new.created_at := now();') > 0
           from src where name = 'support_inquiry_insert_guard'), false),
         'an enabled BEFORE INSERT row trigger gives every inquiry an API role inserts the state of a new one'
  union all
  select 14, 'coach_side_active_coach_only', true,
         (select count(*) from src
          where name in ('coach_set_booking_policy', 'coach_upsert_booking_slot', 'coach_set_booking_slot_open',
                         'coach_list_my_slots', 'coach_list_my_requests', 'coach_respond_to_booking_request',
                         'coach_send_request_message', 'coach_list_request_messages')
            and strpos(body, 'private.coach_can_act(') > 0) = 8
         and coalesce((
           select strpos(k.body, 'co.account_user_id = (select auth.uid())') > 0
                  and strpos(k.body, 'and co.is_active') > 0
                  and strpos(k.body, 'and c.is_active') > 0
                  and strpos(k.body, 'and a.status = ''active''') > 0
                  and strpos(m.body, 'c_max_thread_messages constant integer := 200;') > 0
                  and strpos(m.body, 'v_status not in (''requested'', ''accepted'')') > 0
                  and strpos(m.body, '>= c_max_thread_messages') > 0
                  and strpos(l.body, 'limit 200') > 0
           from src k, src m, src l
           where k.name = 'coach_can_act' and m.name = 'coach_send_request_message' and l.name = 'coach_list_request_messages'), false),
         'the eight coach-side functions need an active coach at an open club; a lesson thread takes at most 200 messages'
  union all
  -- Owner decision (2026-11-28): coaches talk to players in the request's conversation. The request
  -- list keeps its player_email column (the API shape) but returns null in it and reads no email.
  select 15, 'coach_requests_without_player_email', true,
         coalesce((
           select strpos(body, 'p.full_name, null::text, s.starts_at') > 0
                  and strpos(body, '.email') = 0
           from src where name = 'coach_list_my_requests'), false)
         and coalesce(pg_get_function_result(to_regprocedure('public.coach_list_my_requests()')) like '%player_email text,%', false),
         'coach_list_my_requests gives a coach the player''s name but never their email: player_email stays for the API shape, always null'
  union all
  select 16, 'suspended_members_cannot_pay', true,
         coalesce((
           select strpos(body, 'private.own_booking_for_update(p_booking_id)') > 0
                  and strpos(body, 'private.own_booking_for_update(p_booking_id)') < strpos(body, 'm.status = ''suspended''')
                  and strpos(body, 'm.status = ''suspended''') < strpos(body, 'set payment_reference = v_reference')
           from src where name = 'submit_booking_payment'), false),
         'submit_booking_payment refuses a member on hold before any payment is recorded'
  union all
  select 17, 'negative_walkin_charges', false,
         (select walkin_charges_negative = 0 and walkin_records_negative = 0 from stored),
         (select walkin_charges_negative::text || ' walk-in charges below 0 pesos and ' || walkin_records_negative::text
                 || ' walk-in records below 0; ' || walkin_charges_over_cap::text || ' charges above 100,000 pesos; '
                 || walkin_charges::text || ' walk-in charges in all'
          from stored)
  union all
  -- An inquiry inserted already answered is visible only when its answer is not later than the
  -- inquiry, it is dated ahead, or its responder holds no admin role at the club. One with a later
  -- answer time and a real admin named as responder cannot be told apart from a real answer.
  select 18, 'inquiries_inserted_answered', false,
         (select inquiries_answered_at_once = 0 and inquiries_dated_ahead = 0 and inquiries_answered_by_non_admin = 0 from stored),
         (select inquiries_answered_at_once::text || ' inquiries answered no later than they were raised, '
                 || inquiries_dated_ahead::text || ' dated ahead, ' || inquiries_answered_by_non_admin::text
                 || ' answered by an account with no admin role at the club; ' || inquiries::text || ' inquiries in all'
          from stored)
  union all
  select 19, 'platform_accounts_with_club_roles', false,
         (select platform_accounts_with_club_role = 0 from stored),
         (select platform_accounts_with_club_role::text || ' platform accounts hold an active club role, '
                 || platform_accounts_as_club_admin::text || ' of them as admin (the release leaves these rows as they are)'
          from stored)
  union all
  select 20, 'rows_over_new_limits', false,
         (select players_over_payment_cap = 0 and players_over_coach_request_cap = 0
                 and online_bookings_past_window = 0 and payments_waiting_from_suspended = 0 from stored),
         (select players_over_payment_cap::text || ' players with more than 4 payments waiting, '
                 || players_over_coach_request_cap::text || ' with more than 3 coach requests waiting, '
                 || online_bookings_past_window::text || ' online bookings more than 30 days ahead, '
                 || payments_waiting_from_suspended::text || ' payments waiting from members on hold'
          from stored)
)
select check_name, required, ok, detail from checks order by sort;
