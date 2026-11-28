-- Coach request limits: a cap on open requests per player, and no requests while on hold.
--
-- Security fix (owner-approved, 2026-11-28). public.member_request_coach_slot lets a player ask a
-- coach for a lesson time. Each time takes one open request at a time (the next player waits
-- until the coach decides), but nothing limited how many times one player could ask for, so one
-- account could hold every coach time at a club. A member the club put on hold could ask too:
-- private.current_club_role still answers 'member' for a suspended member.
--
-- The function is its latest definition (20261124110000_rent_a_coach.sql) copied unchanged except
-- three checks right after the club role check:
--   * one request at a time per player and club (an advisory lock), so two quick taps cannot get
--     past the limit below;
--   * a suspended member is refused, with the message hold_court_booking uses;
--   * MAX_OPEN_COACH_REQUESTS = 3: a player may have at most 3 requests in the club still waiting
--     for the coach's answer (status 'requested'). Accepted, declined and cancelled requests do
--     not count. Players can cancel a request themselves (member_cancel_coach_request, the
--     "Cancel request" button), so the message says so. The number is a named constant at the top
--     of the function body.
-- Same signature, definer rights and empty search path; create or replace keeps the grants
-- (signed-in callers; the function checks the caller inside); the owner is set below.

create or replace function public.member_request_coach_slot(
  p_slot_id uuid,
  p_student_count integer,
  p_message text
)
returns public.coach_booking_requests
language plpgsql volatile security definer set search_path = ''
as $$
declare
  -- MAX_OPEN_COACH_REQUESTS: requests a player may have waiting for a coach's answer per club.
  c_max_open_requests constant integer := 3;
  v_club uuid := private.current_club_id();
  v_slot public.coach_booking_slots;
  v_coach_id uuid;
  v_coach public.club_coaches;
  v_count integer;
  v_open integer;
  v_amount numeric;
  v_row public.coach_booking_requests;
begin
  if auth.uid() is null or v_club is null
     or private.current_club_role(v_club) is distinct from 'member' then
    raise exception 'Join this club as a player to book a coach' using errcode = '42501';
  end if;
  -- One request at a time per player and club, so two quick taps cannot pass the limit below.
  perform pg_advisory_xact_lock(hashtextextended('coach_request:' || v_club::text || ':' || auth.uid()::text, 0));
  -- current_club_role answers 'member' for a suspended member too.
  if exists (
    select 1 from public.members m
    where m.club_id = v_club and m.user_id = auth.uid() and m.status = 'suspended'
  ) then
    raise exception 'Your account at this club is on hold. Ask the desk.' using errcode = '42501';
  end if;
  -- MAX_OPEN_COACH_REQUESTS: without a cap one account could hold every coach time at the club.
  select count(*)::integer into v_open
  from public.coach_booking_requests r
  where r.club_id = v_club and r.player_user_id = auth.uid() and r.status = 'requested';
  if v_open >= c_max_open_requests then
    raise exception 'You have % % waiting for an answer. Cancel one, or wait for a coach to answer, before you ask for another time.',
      v_open, case when v_open = 1 then 'coach request' else 'coach requests' end
      using errcode = '55000';
  end if;
  select s.coach_id into v_coach_id
  from public.coach_booking_slots s
  where s.id = p_slot_id and s.club_id = v_club;
  if not found then
    raise exception 'This coach time is no longer available' using errcode = '55000';
  end if;
  select c.* into v_coach from public.club_coaches c
  where c.id = v_coach_id and c.club_id = v_club and c.is_active
  for update;
  if not found then
    raise exception 'This coach time is no longer available' using errcode = '55000';
  end if;
  select s.* into v_slot from public.coach_booking_slots s
  where s.id = p_slot_id and s.club_id = v_club
  for update;
  if not found or not v_slot.is_open or v_slot.starts_at <= now() then
    raise exception 'This coach time is no longer available' using errcode = '55000';
  end if;
  if p_student_count is null or p_student_count < 1 or p_student_count > v_slot.max_students
     or (v_slot.lesson_type = 'private' and p_student_count <> 1) then
    raise exception 'Choose a valid number of players for this lesson' using errcode = '22023';
  end if;
  if char_length(coalesce(p_message, '')) > 600 then
    raise exception 'The note is limited to 600 characters' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.coach_booking_requests r
    where r.slot_id = p_slot_id and r.player_user_id = auth.uid()
      and r.status in ('requested', 'accepted')
  ) then
    raise exception 'You already have an active request for this coach time' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.coach_booking_requests r
    where r.slot_id = p_slot_id and r.status = 'requested'
  ) then
    raise exception 'This coach time is waiting for another player''s request to be decided' using errcode = '55000';
  end if;
  select coalesce(sum(r.student_count), 0)::integer into v_count
  from public.coach_booking_requests r
  where r.slot_id = p_slot_id and r.status in ('requested', 'accepted');
  if v_count + p_student_count > v_slot.max_students then
    raise exception 'Not enough places remain for this group' using errcode = '55000';
  end if;
  v_amount := case
    when v_slot.pricing_model = 'per_student'
      then round(v_slot.rate * p_student_count * extract(epoch from (v_slot.ends_at - v_slot.starts_at)) / 3600, 2)
    else v_slot.rate
  end;
  if v_amount > 1000000 then
    raise exception 'The lesson total is over the allowed amount' using errcode = '22023';
  end if;
  insert into public.coach_booking_requests (
    club_id, slot_id, player_user_id, student_count, quoted_amount, message
  ) values (
    v_club, p_slot_id, auth.uid(), p_student_count, v_amount, nullif(btrim(p_message), '')
  ) returning * into v_row;

  return v_row;
end;
$$;

alter function public.member_request_coach_slot(uuid, integer, text) owner to postgres;
