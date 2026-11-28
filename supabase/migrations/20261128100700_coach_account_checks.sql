-- Coach accounts: only an active coach at an open club works as a coach, and lesson threads have limits.
--
-- Security fix (owner-approved, 2026-11-28). The coach-side functions checked only that
-- club_coaches.account_user_id is the caller. A coach the club removed (admin_remove_club_coach
-- sets is_active = false and keeps the link) or a coach whose club was suspended could still
-- accept waiting requests (the player was told "Your coach accepted the time"), message players,
-- change and open times, and read player names and emails on past requests.
--
-- private.coach_can_act (new) says whether the caller may act for a coach profile: the account is
-- linked to it, the coach is active, and the club is open by the same test as the public coach
-- list (list_public_coaches, get_public_club_detail): clubs.is_active and an active club account.
-- The coach side of these eight functions now requires it. Each is its latest definition
-- (20261124110000_rent_a_coach.sql) copied unchanged except the lines marked below.
--   * coach_list_my_requests, coach_list_my_slots: a coach who lost access sees an empty list.
--     coach_list_my_requests also gives no coach the player's email any more (owner decision,
--     2026-11-28: coaches talk to players in the request's conversation). player_email is always
--     null, kept only for the API shape (the same columns, which create or replace requires).
--   * coach_respond_to_booking_request, coach_set_booking_slot_open, coach_upsert_booking_slot,
--     coach_set_booking_policy: refused with each function's existing plain message.
--   * coach_send_request_message, coach_list_request_messages: the player side works as before.
--     New messages are refused unless the request is waiting or accepted, and a conversation
--     holds at most MAX_THREAD_MESSAGES = 200 messages (the request row is locked while one is
--     added, so two at once cannot pass the limit). The list returns the latest 200, oldest first.
-- admin_remove_club_coach is unchanged. Same signatures, definer rights and empty search paths;
-- create or replace keeps the grants (signed-in callers); owners are set below.

create or replace function private.coach_can_act(p_coach_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_coaches co
    join public.clubs c on c.id = co.club_id
    join public.club_accounts a on a.club_id = c.id
    where co.id = p_coach_id
      and co.account_user_id = (select auth.uid())
      and co.is_active
      and c.is_active
      and a.status = 'active'
  );
$$;

create or replace function public.coach_set_booking_policy(p_coach_id uuid, p_policy text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_policy text := nullif(btrim(coalesce(p_policy, '')), '');
  v_saved text;
begin
  if char_length(coalesce(v_policy, '')) > 2000 then
    raise exception 'Booking policy is limited to 2,000 characters' using errcode = '22023';
  end if;
  update public.club_coaches c
  set booking_policy = v_policy, updated_at = now()
  where c.id = p_coach_id and c.account_user_id = auth.uid()
    and private.coach_can_act(c.id) -- an active coach at an open club
  returning c.booking_policy into v_saved;
  if not found then
    raise exception 'Coach profile not found' using errcode = 'P0002';
  end if;
  return v_saved;
end;
$$;

create or replace function public.coach_upsert_booking_slot(
  p_slot_id uuid,
  p_coach_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_lesson_type text,
  p_pricing_model text,
  p_rate numeric,
  p_max_students integer
)
returns public.coach_booking_slots
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_coach public.club_coaches;
  v_slot public.coach_booking_slots;
begin
  select c.* into v_coach
  from public.club_coaches c
  where c.id = p_coach_id and c.account_user_id = auth.uid()
  for update;
  -- An active coach at an open club (was: an active coach).
  if not found or not private.coach_can_act(p_coach_id) then
    raise exception 'This coach profile is not available to your account' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_starts_at <= now() then
    raise exception 'Choose a future time with an end after its start' using errcode = '22023';
  end if;
  if p_lesson_type is null or p_lesson_type not in ('private', 'group')
     or p_pricing_model is null or p_pricing_model not in ('per_student', 'per_session')
     or p_rate is null or p_rate < 0 or p_rate > 100000
     or p_max_students is null or p_max_students < 1 or p_max_students > 16
     or (p_lesson_type = 'private' and p_max_students <> 1)
     or (p_lesson_type = 'group' and p_max_students < 2) then
    raise exception 'Check the lesson type, price and group size' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.coach_booking_slots s
    where s.coach_id = p_coach_id and s.is_open
      and s.id is distinct from p_slot_id
      and s.starts_at < p_ends_at and p_starts_at < s.ends_at
  ) then
    raise exception 'This time overlaps another open coach slot' using errcode = '23P01';
  end if;

  if p_slot_id is null then
    insert into public.coach_booking_slots (
      club_id, coach_id, starts_at, ends_at, lesson_type, pricing_model, rate, max_students
    ) values (
      v_coach.club_id, p_coach_id, p_starts_at, p_ends_at, p_lesson_type, p_pricing_model, p_rate, p_max_students
    ) returning * into v_slot;
  else
    perform 1 from public.coach_booking_slots s
    where s.id = p_slot_id and s.coach_id = p_coach_id and s.club_id = v_coach.club_id
    for update;
    if not found then
      raise exception 'Coach slot not found' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from public.coach_booking_requests r
      where r.slot_id = p_slot_id and r.status in ('requested', 'accepted')
    ) then
      raise exception 'A slot with active requests cannot be changed' using errcode = '55000';
    end if;
    update public.coach_booking_slots s
    set starts_at = p_starts_at, ends_at = p_ends_at, lesson_type = p_lesson_type,
        pricing_model = p_pricing_model, rate = p_rate, max_students = p_max_students, updated_at = now()
    where s.id = p_slot_id and s.coach_id = p_coach_id and s.club_id = v_coach.club_id
    returning * into v_slot;
    if not found then
      raise exception 'Coach slot not found' using errcode = 'P0002';
    end if;
  end if;
  return v_slot;
end;
$$;

create or replace function public.coach_set_booking_slot_open(p_slot_id uuid, p_is_open boolean)
returns public.coach_booking_slots
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_slot public.coach_booking_slots;
  v_coach_club uuid;
begin
  select c.club_id into v_coach_club
  from public.coach_booking_slots s
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where s.id = p_slot_id and c.account_user_id = auth.uid()
    and private.coach_can_act(c.id) -- an active coach at an open club
  for update of c;
  if not found then
    raise exception 'Coach slot not found' using errcode = 'P0002';
  end if;
  select s.* into v_slot from public.coach_booking_slots s
  where s.id = p_slot_id and s.club_id = v_coach_club
  for update;
  if not found then
    raise exception 'Coach slot not found' using errcode = 'P0002';
  end if;
  if p_is_open is null then
    raise exception 'Choose whether the coach time is open' using errcode = '22023';
  end if;
  if p_is_open and v_slot.starts_at <= now() then
    raise exception 'A past coach time cannot be opened' using errcode = '22023';
  end if;
  if p_is_open and not exists (
    select 1 from public.club_coaches c where c.id = v_slot.coach_id and c.is_active
  ) then
    raise exception 'An inactive coach cannot open a slot' using errcode = '55000';
  end if;
  if not p_is_open and exists (
    select 1 from public.coach_booking_requests r
    where r.slot_id = p_slot_id and r.status in ('requested', 'accepted')
  ) then
    raise exception 'A slot with active requests cannot be closed' using errcode = '55000';
  end if;
  if p_is_open and exists (
    select 1 from public.coach_booking_slots s
    where s.coach_id = v_slot.coach_id and s.id <> p_slot_id and s.is_open
      and s.starts_at < v_slot.ends_at and v_slot.starts_at < s.ends_at
  ) then
    raise exception 'This time overlaps another open coach slot' using errcode = '23P01';
  end if;
  update public.coach_booking_slots s
  set is_open = p_is_open, updated_at = now()
  where s.id = p_slot_id
  returning * into v_slot;
  return v_slot;
end;
$$;

create or replace function public.coach_list_my_slots()
returns table (
  slot_id uuid, coach_id uuid, club_id uuid, club_name text, coach_name text,
  starts_at timestamptz, ends_at timestamptz, lesson_type text, pricing_model text,
  rate numeric, max_students integer, is_open boolean, active_students integer
)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.coach_id, s.club_id, cl.name, c.full_name,
         s.starts_at, s.ends_at, s.lesson_type, s.pricing_model, s.rate, s.max_students,
         s.is_open, coalesce((
           select sum(r.student_count)::integer from public.coach_booking_requests r
           where r.slot_id = s.id and r.status in ('requested', 'accepted')
         ), 0)
  from public.coach_booking_slots s
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  join public.clubs cl on cl.id = s.club_id
  where c.account_user_id = auth.uid()
    and private.coach_can_act(c.id) -- an active coach at an open club
  order by s.starts_at desc, cl.name;
$$;

create or replace function public.coach_list_my_requests()
returns table (
  request_id uuid, slot_id uuid, club_id uuid, club_name text, coach_id uuid,
  coach_name text, player_user_id uuid, player_name text, player_email text,
  starts_at timestamptz, ends_at timestamptz, lesson_type text, pricing_model text,
  rate numeric, student_count integer, quoted_amount numeric, message text,
  status text, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  -- player_email is always null (owner decision, 2026-11-28): coaches talk to players in the
  -- request's conversation. The column stays only for the API shape.
  select r.id, s.id, r.club_id, cl.name, c.id, c.full_name, r.player_user_id,
         p.full_name, null::text, s.starts_at, s.ends_at, s.lesson_type, s.pricing_model,
         s.rate, r.student_count, r.quoted_amount, r.message, r.status, r.created_at
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  join public.clubs cl on cl.id = r.club_id
  join public.profiles p on p.id = r.player_user_id
  where c.account_user_id = auth.uid()
    and private.coach_can_act(c.id) -- an active coach at an open club
  order by (r.status = 'requested') desc, s.starts_at, r.created_at;
$$;

create or replace function public.coach_respond_to_booking_request(p_request_id uuid, p_accept boolean)
returns public.coach_booking_requests
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.coach_booking_requests;
  v_player uuid;
begin
  select r.* into v_row
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where r.id = p_request_id and c.account_user_id = auth.uid()
    and private.coach_can_act(c.id) -- an active coach at an open club
  for update of r;
  if not found then
    raise exception 'Coaching request not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'This coaching request has already been decided' using errcode = '55000';
  end if;
  if p_accept and not exists (
    select 1 from public.coach_booking_slots s
    where s.id = v_row.slot_id and s.starts_at > now()
  ) then
    raise exception 'A past coach time cannot be accepted' using errcode = '55000';
  end if;
  update public.coach_booking_requests r
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now(), updated_at = now()
  where r.id = p_request_id
  returning * into v_row;
  select r.player_user_id into v_player from public.coach_booking_requests r where r.id = p_request_id;
  insert into public.notifications (club_id, user_id, title, body)
  values (
    v_row.club_id,
    v_player,
    case when p_accept then 'Lesson request accepted' else 'Lesson request declined' end,
    case when p_accept then 'Your coach accepted the time. Message them to agree on a court.'
      else 'Your coach declined the requested time. You can choose another available time.' end
  );
  return v_row;
end;
$$;

create or replace function public.coach_send_request_message(p_request_id uuid, p_body text)
returns public.coach_request_messages
language plpgsql volatile security definer set search_path = ''
as $$
declare
  -- MAX_THREAD_MESSAGES: messages one lesson request's conversation may hold.
  c_max_thread_messages constant integer := 200;
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.coach_request_messages;
  v_other_user uuid;
  v_club uuid;
  v_status text;
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Message must be 1 to 2,000 characters' using errcode = '22023';
  end if;
  -- The request row is locked, so two messages at once cannot pass the limit below.
  select case when r.player_user_id = auth.uid() then null else r.player_user_id end,
         r.club_id, r.status
  into v_other_user, v_club, v_status
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where r.id = p_request_id
    and (r.player_user_id = auth.uid()
         or (c.account_user_id = auth.uid() and private.coach_can_act(c.id))) -- coach: active, open club
  for update of r;
  if not found then
    raise exception 'Coaching request not found' using errcode = 'P0002';
  end if;
  -- New: a conversation stays open only while the request waits for an answer or is accepted.
  if v_status not in ('requested', 'accepted') then
    raise exception 'This lesson request is closed, so no new messages can be sent.' using errcode = '55000';
  end if;
  -- New: MAX_THREAD_MESSAGES.
  if (select count(*) from public.coach_request_messages m where m.request_id = p_request_id)
     >= c_max_thread_messages then
    raise exception 'This conversation has reached the limit of % messages.', c_max_thread_messages
      using errcode = '55000';
  end if;
  insert into public.coach_request_messages (request_id, sender_user_id, body)
  values (p_request_id, auth.uid(), v_body)
  returning * into v_message;
  if v_other_user is not null then
    insert into public.notifications (club_id, user_id, title, body)
    values (v_club, v_other_user, 'New coaching message', 'You have a new message about a lesson request.');
  end if;
  return v_message;
end;
$$;

create or replace function public.coach_list_request_messages(p_request_id uuid)
returns setof public.coach_request_messages
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.coach_booking_requests r
    join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
    join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
    where r.id = p_request_id
      and (r.player_user_id = auth.uid()
           or (c.account_user_id = auth.uid() and private.coach_can_act(c.id))) -- coach: active, open club
  ) then
    raise exception 'Coaching request not found' using errcode = 'P0002';
  end if;
  -- New: the latest 200 messages (MAX_THREAD_MESSAGES), oldest first.
  return query
  select m.* from (
    select m.* from public.coach_request_messages m
    where m.request_id = p_request_id
    order by m.created_at desc, m.id desc
    limit 200
  ) m
  order by m.created_at, m.id;
end;
$$;

alter function private.coach_can_act(uuid) owner to postgres;
alter function public.coach_set_booking_policy(uuid, text) owner to postgres;
alter function public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer) owner to postgres;
alter function public.coach_set_booking_slot_open(uuid, boolean) owner to postgres;
alter function public.coach_list_my_slots() owner to postgres;
alter function public.coach_list_my_requests() owner to postgres;
alter function public.coach_respond_to_booking_request(uuid, boolean) owner to postgres;
alter function public.coach_send_request_message(uuid, text) owner to postgres;
alter function public.coach_list_request_messages(uuid) owner to postgres;

revoke all on function private.coach_can_act(uuid) from public, anon, authenticated;

comment on function private.coach_can_act(uuid) is
  'Whether the signed-in account may act for this coach profile: linked to it, the coach active, and the club open (clubs.is_active and an active club account, as the public coach list).';
