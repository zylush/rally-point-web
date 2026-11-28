-- (Renumbered from 20261123090000 on 2026-11-24 so it follows the member codes and booking length
-- release on staging; it was never applied anywhere hosted.)
-- Coach booking: club-scoped coach accounts, bookable coach time, requests and
-- private player/coach messages. Coaching does not reserve a court or collect payment.
do $$
begin
  if to_regclass('public.club_coaches') is null
     or to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('private.require_club_admin()') is null then
    raise exception 'Rent-a-coach requires the club business profile and club context migrations first.';
  end if;
end;
$$;

alter table public.club_coaches
  add column account_user_id uuid references auth.users (id) on delete set null,
  add column booking_policy text constraint club_coaches_booking_policy_check
    check (char_length(booking_policy) <= 2000);

create unique index club_coaches_id_club_unique on public.club_coaches (id, club_id);
create unique index club_coaches_account_unique
  on public.club_coaches (club_id, account_user_id)
  where account_user_id is not null;

create table public.coach_booking_slots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  coach_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lesson_type text not null check (lesson_type in ('private', 'group')),
  pricing_model text not null check (pricing_model in ('per_student', 'per_session')),
  rate numeric(12,2) not null check (rate between 0 and 100000),
  max_students integer not null check (max_students between 1 and 16),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_booking_slots_coach_club_fk
    foreign key (coach_id, club_id) references public.club_coaches (id, club_id) on delete restrict,
  constraint coach_booking_slots_time_check check (ends_at > starts_at),
  constraint coach_booking_slots_type_capacity_check check (
    (lesson_type = 'private' and max_students = 1)
    or (lesson_type = 'group' and max_students between 2 and 16)
  ),
  unique (id, club_id)
);
create index coach_booking_slots_browse on public.coach_booking_slots (club_id, starts_at)
  where is_open;
create index coach_booking_slots_coach_time on public.coach_booking_slots (coach_id, starts_at);

create table public.coach_booking_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  slot_id uuid not null,
  player_user_id uuid not null references auth.users (id) on delete restrict,
  student_count integer not null check (student_count between 1 and 16),
  quoted_amount numeric(12,2) not null check (quoted_amount between 0 and 1000000),
  message text constraint coach_booking_requests_message_check check (char_length(message) <= 600),
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'cancelled', 'completed', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint coach_booking_requests_slot_club_fk
    foreign key (slot_id, club_id) references public.coach_booking_slots (id, club_id) on delete restrict,
  unique (id, club_id)
);
create index coach_booking_requests_player on public.coach_booking_requests (player_user_id, created_at desc);
create index coach_booking_requests_slot_status on public.coach_booking_requests (slot_id, status);
create unique index coach_booking_requests_one_active_per_player_slot
  on public.coach_booking_requests (slot_id, player_user_id)
  where status in ('requested', 'accepted');

create table public.coach_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.coach_booking_requests (id) on delete restrict,
  sender_user_id uuid not null references auth.users (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index coach_request_messages_thread on public.coach_request_messages (request_id, created_at, id);
-- Every foreign key gets an index in its own column order (the Supabase advisor suites check this).
create index club_coaches_account_user_id on public.club_coaches (account_user_id);
create index coach_booking_slots_coach_club on public.coach_booking_slots (coach_id, club_id);
create index coach_booking_requests_slot_club on public.coach_booking_requests (slot_id, club_id);
create index coach_request_messages_sender on public.coach_request_messages (sender_user_id);

alter table public.coach_booking_slots enable row level security;
alter table public.coach_booking_requests enable row level security;
alter table public.coach_request_messages enable row level security;
revoke all on table public.coach_booking_slots from public, anon, authenticated;
revoke all on table public.coach_booking_requests from public, anon, authenticated;
revoke all on table public.coach_request_messages from public, anon, authenticated;
create policy no_direct_api_access on public.coach_booking_slots
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.coach_booking_requests
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.coach_request_messages
  as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function public.admin_link_club_coach_account(p_coach_id uuid, p_email text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_user uuid;
  v_current_user uuid;
begin
  select c.account_user_id into v_current_user
  from public.club_coaches c
  where c.id = p_coach_id and c.club_id = v_club
  for update;
  if not found then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;

  if nullif(btrim(p_email), '') is null then
    if exists (
      select 1 from public.coach_booking_requests r
      join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
      where s.coach_id = p_coach_id and s.club_id = v_club
        and r.status in ('requested', 'accepted')
    ) then
      raise exception 'Cancel or finish active coaching requests before changing this account' using errcode = '55000';
    end if;
    update public.club_coaches c
    set account_user_id = null, updated_at = now()
    where c.id = p_coach_id and c.club_id = v_club;
    return null;
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'No confirmed account uses that email. Ask the coach to sign up first.' using errcode = '22023';
  end if;
  if v_current_user is distinct from v_user and exists (
    select 1 from public.coach_booking_requests r
    join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
    where s.coach_id = p_coach_id and s.club_id = v_club
      and r.status in ('requested', 'accepted')
  ) then
    raise exception 'Cancel or finish active coaching requests before changing this account' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.club_coaches c
    where c.club_id = v_club and c.account_user_id = v_user and c.id <> p_coach_id
  ) then
    raise exception 'That account is already linked to another coach profile in this club' using errcode = '23505';
  end if;

  update public.club_coaches c
  set account_user_id = v_user, updated_at = now()
  where c.id = p_coach_id and c.club_id = v_club;
  return v_user;
end;
$$;

create or replace function public.coach_my_profiles()
returns table (
  coach_id uuid, club_id uuid, club_slug text, club_name text, full_name text,
  headline text, bio text, hourly_rate numeric, photo_path text, is_active boolean, booking_policy text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.club_id, cl.slug, cl.name, c.full_name,
         c.headline, c.bio, c.hourly_rate, c.photo_path, c.is_active, c.booking_policy
  from public.club_coaches c
  join public.clubs cl on cl.id = c.club_id and cl.is_active
  where c.account_user_id = auth.uid()
  order by cl.name, c.position, c.id;
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
  if not found or not v_coach.is_active then
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

create or replace function public.member_list_coach_slots(p_from timestamptz, p_until timestamptz)
returns table (
  slot_id uuid, coach_id uuid, club_id uuid, coach_name text, headline text, photo_path text,
  starts_at timestamptz, ends_at timestamptz, lesson_type text, pricing_model text,
  rate numeric, max_students integer, remaining_students integer, booking_policy text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if auth.uid() is null or v_club is null
     or private.current_club_role(v_club) is distinct from 'member' then
    raise exception 'Join this club as a player to book a coach' using errcode = '42501';
  end if;
  if p_from is null or p_until is null or p_until <= p_from then
    raise exception 'Choose a valid date range' using errcode = '22023';
  end if;
  return query
  select s.id, c.id, c.club_id, c.full_name, c.headline, c.photo_path,
         s.starts_at, s.ends_at, s.lesson_type, s.pricing_model, s.rate, s.max_students,
         s.max_students - coalesce((
           select sum(r.student_count)::integer from public.coach_booking_requests r
           where r.slot_id = s.id and r.status in ('requested', 'accepted')
         ), 0), c.booking_policy
  from public.coach_booking_slots s
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where s.club_id = v_club and c.is_active and s.is_open
    and s.starts_at >= greatest(p_from, now()) and s.starts_at < p_until
    and not exists (
      select 1 from public.coach_booking_requests r
      where r.slot_id = s.id and r.status = 'requested'
    )
    and s.max_students > coalesce((
      select sum(r.student_count)::integer from public.coach_booking_requests r
      where r.slot_id = s.id and r.status in ('requested', 'accepted')
    ), 0)
  order by s.starts_at, c.position, c.full_name;
end;
$$;

create or replace function public.member_request_coach_slot(
  p_slot_id uuid,
  p_student_count integer,
  p_message text
)
returns public.coach_booking_requests
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_slot public.coach_booking_slots;
  v_coach_id uuid;
  v_coach public.club_coaches;
  v_count integer;
  v_amount numeric;
  v_row public.coach_booking_requests;
begin
  if auth.uid() is null or v_club is null
     or private.current_club_role(v_club) is distinct from 'member' then
    raise exception 'Join this club as a player to book a coach' using errcode = '42501';
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
  select r.id, s.id, r.club_id, cl.name, c.id, c.full_name, r.player_user_id,
         p.full_name, p.email, s.starts_at, s.ends_at, s.lesson_type, s.pricing_model,
         s.rate, r.student_count, r.quoted_amount, r.message, r.status, r.created_at
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  join public.clubs cl on cl.id = r.club_id
  join public.profiles p on p.id = r.player_user_id
  where c.account_user_id = auth.uid()
  order by (r.status = 'requested') desc, s.starts_at, r.created_at;
$$;

create or replace function public.member_list_my_coach_requests()
returns table (
  request_id uuid, slot_id uuid, club_id uuid, coach_id uuid, coach_name text,
  coach_photo_path text, starts_at timestamptz, ends_at timestamptz,
  lesson_type text, pricing_model text, rate numeric, student_count integer,
  quoted_amount numeric, message text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if auth.uid() is null or v_club is null
     or private.current_club_role(v_club) is distinct from 'member' then
    raise exception 'Join this club as a player to see coach requests' using errcode = '42501';
  end if;
  return query
  select r.id, s.id, r.club_id, c.id, c.full_name, c.photo_path,
         s.starts_at, s.ends_at, s.lesson_type, s.pricing_model, s.rate,
         r.student_count, r.quoted_amount, r.message, r.status, r.created_at
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where r.club_id = v_club and r.player_user_id = auth.uid()
  order by r.created_at desc;
end;
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

create or replace function public.member_cancel_coach_request(p_request_id uuid)
returns public.coach_booking_requests
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.coach_booking_requests;
begin
  select r.* into v_row
  from public.coach_booking_requests r
  where r.id = p_request_id and r.player_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Coaching request not found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('requested', 'accepted') then
    raise exception 'This coaching request can no longer be cancelled' using errcode = '55000';
  end if;
  update public.coach_booking_requests r
  set status = 'cancelled', updated_at = now()
  where r.id = p_request_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.coach_send_request_message(p_request_id uuid, p_body text)
returns public.coach_request_messages
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.coach_request_messages;
  v_other_user uuid;
  v_club uuid;
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Message must be 1 to 2,000 characters' using errcode = '22023';
  end if;
  select case when r.player_user_id = auth.uid() then null else r.player_user_id end,
         r.club_id
  into v_other_user, v_club
  from public.coach_booking_requests r
  join public.coach_booking_slots s on s.id = r.slot_id and s.club_id = r.club_id
  join public.club_coaches c on c.id = s.coach_id and c.club_id = s.club_id
  where r.id = p_request_id
    and (r.player_user_id = auth.uid() or c.account_user_id = auth.uid());
  if not found then
    raise exception 'Coaching request not found' using errcode = 'P0002';
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
      and (r.player_user_id = auth.uid() or c.account_user_id = auth.uid())
  ) then
    raise exception 'Coaching request not found' using errcode = 'P0002';
  end if;
  return query
  select m.* from public.coach_request_messages m
  where m.request_id = p_request_id
  order by m.created_at, m.id;
end;
$$;

create or replace function public.admin_remove_club_coach(p_coach_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_path text;
begin
  if exists (select 1 from public.coach_booking_slots s where s.coach_id = p_coach_id and s.club_id = v_club) then
    select c.photo_path into v_path
    from public.club_coaches c where c.id = p_coach_id and c.club_id = v_club;
    if not found then
      raise exception 'coach not found' using errcode = 'P0002';
    end if;
    update public.club_coaches c
    set is_active = false, photo_path = null, updated_at = now()
    where c.id = p_coach_id and c.club_id = v_club;
    return v_path;
  end if;
  delete from public.club_coaches c where c.id = p_coach_id and c.club_id = v_club
  returning c.photo_path into v_path;
  if not found then
    raise exception 'coach not found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

alter function public.admin_link_club_coach_account(uuid, text) owner to postgres;
alter function public.coach_my_profiles() owner to postgres;
alter function public.coach_set_booking_policy(uuid, text) owner to postgres;
alter function public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer) owner to postgres;
alter function public.coach_set_booking_slot_open(uuid, boolean) owner to postgres;
alter function public.member_list_coach_slots(timestamptz, timestamptz) owner to postgres;
alter function public.member_request_coach_slot(uuid, integer, text) owner to postgres;
alter function public.coach_list_my_slots() owner to postgres;
alter function public.coach_list_my_requests() owner to postgres;
alter function public.member_list_my_coach_requests() owner to postgres;
alter function public.coach_respond_to_booking_request(uuid, boolean) owner to postgres;
alter function public.member_cancel_coach_request(uuid) owner to postgres;
alter function public.coach_send_request_message(uuid, text) owner to postgres;
alter function public.coach_list_request_messages(uuid) owner to postgres;
alter function public.admin_remove_club_coach(uuid) owner to postgres;

revoke all on function public.admin_link_club_coach_account(uuid, text) from public, anon;
revoke all on function public.coach_my_profiles() from public, anon;
revoke all on function public.coach_set_booking_policy(uuid, text) from public, anon;
revoke all on function public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer) from public, anon;
revoke all on function public.coach_set_booking_slot_open(uuid, boolean) from public, anon;
revoke all on function public.member_list_coach_slots(timestamptz, timestamptz) from public, anon;
revoke all on function public.member_request_coach_slot(uuid, integer, text) from public, anon;
revoke all on function public.coach_list_my_slots() from public, anon;
revoke all on function public.coach_list_my_requests() from public, anon;
revoke all on function public.member_list_my_coach_requests() from public, anon;
revoke all on function public.coach_respond_to_booking_request(uuid, boolean) from public, anon;
revoke all on function public.member_cancel_coach_request(uuid) from public, anon;
revoke all on function public.coach_send_request_message(uuid, text) from public, anon;
revoke all on function public.coach_list_request_messages(uuid) from public, anon;
revoke all on function public.admin_remove_club_coach(uuid) from public, anon;

grant execute on function public.admin_link_club_coach_account(uuid, text) to authenticated;
grant execute on function public.coach_my_profiles() to authenticated;
grant execute on function public.coach_set_booking_policy(uuid, text) to authenticated;
grant execute on function public.coach_upsert_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text, numeric, integer) to authenticated;
grant execute on function public.coach_set_booking_slot_open(uuid, boolean) to authenticated;
grant execute on function public.member_list_coach_slots(timestamptz, timestamptz) to authenticated;
grant execute on function public.member_request_coach_slot(uuid, integer, text) to authenticated;
grant execute on function public.coach_list_my_slots() to authenticated;
grant execute on function public.coach_list_my_requests() to authenticated;
grant execute on function public.member_list_my_coach_requests() to authenticated;
grant execute on function public.coach_respond_to_booking_request(uuid, boolean) to authenticated;
grant execute on function public.member_cancel_coach_request(uuid) to authenticated;
grant execute on function public.coach_send_request_message(uuid, text) to authenticated;
grant execute on function public.coach_list_request_messages(uuid) to authenticated;
grant execute on function public.admin_remove_club_coach(uuid) to authenticated;
