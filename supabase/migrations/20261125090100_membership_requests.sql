-- Membership requests and the QR pass wallet.
--
-- A membership starts only when the club's staff or admin approve it (owner,
-- 2026-11-24). The flow:
--   1. A person who already has a members row at a club (as a player, or as a
--      member who wants to renew) asks for a membership:
--      request_club_membership. One open request per person per club, and at
--      most 5 requests a day per person.
--   2. They pay at the desk or by the club's own GCash. Rally Point does not
--      take, hold or check the money.
--   3. Staff or an admin of that club approve the request with the plan and the
--      amount received (staff_approve_membership_request): the plan is set, the
--      status becomes active, and the expiry moves 30 days on from the later of
--      today (Philippine date) or the current expiry when it has not passed. An
--      amount above zero is recorded as a 'membership' charge, which earns no
--      platform commission (the commission trigger covers court time only). Or
--      they decline it with a reason (staff_decline_membership_request). Either
--      way the player gets a notification. The player may withdraw a pending
--      request (cancel_my_membership_request).
--
-- The wallet: list_my_member_passes returns one check-in pass per active club
-- the person belongs to, whatever club the request header names, because each
-- club's code only works at that club. check_in_qr now also returns the
-- member's nickname, photo and whether their membership is active, so the desk
-- can recognise them.
--
-- An active membership is the same rule the member rate uses in
-- hold_court_booking: a plan, status 'active', and an expiry date that has not
-- passed in Philippine time.
--
-- public.membership_requests is closed to API roles; everything goes through the
-- definer functions below. Platform superadmins gain nothing here. Nothing
-- inside the reservation-write pause changes: no booking, session, open-play or
-- allocation row is written. A hosted apply needs its own approved release.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('private.is_platform_superadmin()') is null
     or to_regprocedure('private.tidy_name(text)') is null
     or to_regprocedure('public.check_in_member(uuid, uuid, text)') is null
     or to_regclass('public.platform_commissions') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.profiles'::regclass and attname = 'nickname' and not attisdropped
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.members'::regclass and conname = 'members_membership_pair_check'
     ) then
    raise exception 'Membership requests need the club platform, player marketplace and member profile migrations first.';
  end if;
  -- Only values that already exist are used. Nothing here adds an enum value.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typnamespace = 'public'::regnamespace and t.typname = 'tx_type' and e.enumlabel = 'membership'
  ) then
    raise exception 'Membership requests need the existing membership charge type.';
  end if;
  -- A membership charge must never earn platform commission.
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.transactions'::regclass and t.tgname = 'transactions_record_platform_commission'
      and pg_get_triggerdef(t.oid) ~ 'membership'
  ) then
    raise exception 'The commission trigger unexpectedly covers membership charges.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

create table public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null,
  status text not null default 'pending'
    constraint membership_requests_status_check check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- Filled in when staff approve: the plan chosen and the amount received.
  membership_type public.membership_type,
  amount numeric(12,2) constraint membership_requests_amount_check check (amount between 0 and 1000000),
  decline_reason text
    constraint membership_requests_decline_reason_check check (char_length(decline_reason) between 1 and 300),
  -- The membership charge an approval recorded, when the amount was above zero.
  transaction_id uuid references public.transactions (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  foreign key (club_id, member_id) references public.members (club_id, id) on delete cascade,
  -- Each status carries exactly its own details.
  constraint membership_requests_decision_check check (
    case status
      when 'pending' then decided_at is null and decided_by is null and membership_type is null
                          and amount is null and decline_reason is null and transaction_id is null
      when 'approved' then decided_at is not null and membership_type is not null and amount is not null
                           and decline_reason is null
      when 'declined' then decided_at is not null and decline_reason is not null
                           and membership_type is null and amount is null and transaction_id is null
      else decided_at is not null and membership_type is null and amount is null
           and decline_reason is null and transaction_id is null
    end
  )
);

comment on table public.membership_requests is
  'A person''s request for a membership (or a renewal) at a club, decided by the club''s staff or admin. No direct API access; see the membership request functions.';

-- One open request per person per club.
create unique index membership_requests_one_pending
  on public.membership_requests (club_id, user_id) where status = 'pending';
-- The club's list (and the club foreign key), each person's latest request and the
-- daily limit (and the user foreign key), and the other foreign keys.
create index membership_requests_club_status on public.membership_requests (club_id, status, requested_at);
create index membership_requests_member on public.membership_requests (club_id, member_id);
create index membership_requests_user on public.membership_requests (user_id, requested_at);
create index membership_requests_decided_by on public.membership_requests (decided_by);
create index membership_requests_transaction on public.membership_requests (transaction_id);

-- No direct access for any API role: every read and write goes through the functions below.
alter table public.membership_requests enable row level security;
revoke all on table public.membership_requests from public, anon, authenticated, service_role;
create policy no_direct_api_access on public.membership_requests
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An active membership: a plan, status 'active', and an expiry date that has not
-- passed in Philippine time. The member rate in hold_court_booking uses the same rule.
create or replace function private.membership_is_active(
  p_type public.membership_type, p_status public.member_status, p_expiry date)
returns boolean
language sql stable set search_path = ''
as $$
  select p_type is not null
     and p_status = 'active'
     and p_expiry is not null
     and p_expiry >= (now() at time zone 'Asia/Manila')::date;
$$;

-- The active club, when the caller is its staff or admin; otherwise an error.
-- The header only picks the club: the role comes from club_staff_roles.
-- Platform accounts never decide club memberships, even with a club role.
create or replace function private.require_membership_desk()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot manage membership requests' using errcode = '42501';
  end if;
  if v_club is null or not coalesce(private.current_club_role(v_club)::text in ('staff', 'admin'), false) then
    raise exception 'Only club staff can manage membership requests' using errcode = '42501';
  end if;
  -- Owner decision (2026-11-25): admins, and staff assigned to at least one active
  -- venue of the club. A staff account with no venue does not decide memberships.
  if private.current_club_role(v_club)::text = 'staff' and not exists (
    select 1
    from public.staff_venue_grants g
    join public.venues v on v.club_id = g.club_id and v.id = g.venue_id and v.is_active
    where g.club_id = v_club and g.user_id = auth.uid() and g.is_active
  ) then
    raise exception 'Only staff assigned to one of this club''s venues can manage membership requests' using errcode = '42501';
  end if;
  return v_club;
end;
$$;

-- A pending request of the club, locked. Any other club's request is "not found".
create or replace function private.pending_membership_request(p_club_id uuid, p_request_id uuid)
returns public.membership_requests
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_request public.membership_requests;
begin
  select r.* into v_request
  from public.membership_requests r
  where r.id = p_request_id and r.club_id = p_club_id
  for update;
  if v_request.id is null then
    raise exception 'Membership request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '55000';
  end if;
  -- Owner decision (2026-11-25): nobody decides their own request, so a staff member
  -- or admin who also plays at the club cannot give themselves the member rate.
  if v_request.user_id = auth.uid() then
    raise exception 'You cannot decide your own membership request. Ask another staff member or admin.' using errcode = '42501';
  end if;
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- The person's own passes and requests
-- ---------------------------------------------------------------------------

-- One check-in pass per active club the caller has a members row in. It ignores
-- the club header, gives a pass its QR token when it has none, and carries the
-- latest request at that club.
create or replace function public.list_my_member_passes()
returns table (
  club_id uuid, club_slug text, club_name text, member_id uuid, member_code text, full_name text,
  membership_type public.membership_type, status public.member_status, expiry_date date,
  is_active_member boolean, qr_token text, request_id uuid, request_status text,
  request_decline_reason text, request_requested_at timestamptz, request_decided_at timestamptz
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Please sign in to see your passes' using errcode = '42501';
  end if;

  update public.members m
  set qr_token = 'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  where m.user_id = v_user
    and nullif(btrim(coalesce(m.qr_token, '')), '') is null
    and exists (select 1 from public.clubs c where c.id = m.club_id and c.is_active);

  return query
  select c.id, c.slug, c.name, m.id, m.member_code, m.full_name,
         m.membership_type, m.status, m.expiry_date,
         private.membership_is_active(m.membership_type, m.status, m.expiry_date),
         m.qr_token, r.id, r.status, r.decline_reason, r.requested_at, r.decided_at
  from public.members m
  join public.clubs c on c.id = m.club_id and c.is_active
  left join lateral (
    select q.id, q.status, q.decline_reason, q.requested_at, q.decided_at
    from public.membership_requests q
    where q.club_id = m.club_id and q.user_id = v_user
    order by q.requested_at desc, q.id desc
    limit 1
  ) r on true
  where m.user_id = v_user
  order by c.name, c.id;
end;
$$;

-- Asks a club the caller already belongs to for a membership (or a renewal).
-- Returns the new request's id.
create or replace function public.request_club_membership(p_club_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_member uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Please sign in to ask for a membership' using errcode = '42501';
  end if;
  if private.is_platform_superadmin() then
    raise exception 'Platform accounts cannot ask for memberships' using errcode = '42501';
  end if;
  select m.id into v_member
  from public.members m
  join public.clubs c on c.id = m.club_id and c.is_active
  where m.club_id = p_club_id and m.user_id = v_user;
  if v_member is null then
    raise exception 'Join this club before asking for a membership' using errcode = '42501';
  end if;
  -- A suspension is the club's call; asking for a membership does not get round it.
  if exists (select 1 from public.members m where m.id = v_member and m.status = 'suspended') then
    raise exception 'Your account at this club is on hold. Please talk to the club.' using errcode = '42501';
  end if;

  -- One request at a time per person, so the checks below count correctly.
  perform pg_advisory_xact_lock(hashtextextended('membership_requests:' || v_user::text, 0));
  if exists (
    select 1 from public.membership_requests r
    where r.club_id = p_club_id and r.user_id = v_user and r.status = 'pending'
  ) then
    raise exception 'You already asked this club. Staff will confirm it at the desk.' using errcode = '23505';
  end if;
  if (
    select count(*) from public.membership_requests r
    where r.user_id = v_user and r.requested_at > now() - interval '1 day'
  ) >= 5 then
    raise exception 'You have asked for a membership many times today. Please try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.membership_requests (club_id, user_id, member_id, requested_at)
  values (p_club_id, v_user, v_member, clock_timestamp())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'You already asked this club. Staff will confirm it at the desk.' using errcode = '23505';
end;
$$;

-- Withdraws the caller's own pending request.
create or replace function public.cancel_my_membership_request(p_request_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_request public.membership_requests;
begin
  select r.* into v_request
  from public.membership_requests r
  where r.id = p_request_id and r.user_id = auth.uid()
  for update;
  if v_request.id is null then
    raise exception 'Membership request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '55000';
  end if;
  update public.membership_requests r
  set status = 'cancelled', decided_at = clock_timestamp()
  where r.id = v_request.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club staff and admins (active club from x-club-id, staff or admin role required)
-- ---------------------------------------------------------------------------

-- The active club's requests: 'pending' oldest first (up to 200), or 'decided'
-- (approved and declined) newest first (up to 50).
create or replace function public.staff_list_membership_requests(p_which text default 'pending')
returns table (
  id uuid, member_id uuid, member_code text, full_name text, nickname text, photo_path text,
  membership_type public.membership_type, member_status public.member_status, expiry_date date,
  status text, requested_at timestamptz, decided_at timestamptz, decline_reason text, amount numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_club uuid := private.require_membership_desk();
  v_which text := coalesce(p_which, 'pending');
begin
  if v_which not in ('pending', 'decided') then
    raise exception 'Choose pending or decided requests' using errcode = '22023';
  end if;
  return query
  select r.id, m.id, m.member_code, m.full_name, p.nickname, p.photo_path,
         m.membership_type, m.status, m.expiry_date,
         r.status, r.requested_at, r.decided_at, r.decline_reason, r.amount::numeric
  from public.membership_requests r
  join public.members m on m.id = r.member_id and m.club_id = r.club_id
  left join public.profiles p on p.id = r.user_id
  where r.club_id = v_club
    and ((v_which = 'pending' and r.status = 'pending')
      or (v_which = 'decided' and r.status in ('approved', 'declined')))
  order by
    case when v_which = 'pending' then r.requested_at end asc,
    case when v_which = 'decided' then r.decided_at end desc,
    r.id
  limit case when v_which = 'pending' then 200 else 50 end;
end;
$$;

-- Starts or extends the membership by 30 days, records the amount received as a
-- membership charge, and tells the player.
create or replace function public.staff_approve_membership_request(
  p_request_id uuid, p_membership_type public.membership_type, p_amount numeric)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_membership_desk();
  v_request public.membership_requests;
  v_member public.members;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_renewing boolean;
  v_expiry date;
  v_amount numeric(12,2);
  v_transaction uuid;
begin
  v_request := private.pending_membership_request(v_club, p_request_id);
  if p_membership_type is null then
    raise exception 'Choose a membership plan' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 then
    raise exception 'Enter the amount received (0 or more)' using errcode = '22023';
  end if;
  v_amount := round(p_amount, 2);

  select m.* into v_member
  from public.members m
  where m.id = v_request.member_id and m.club_id = v_club
  for update;
  if v_member.id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  -- Approving must not quietly lift a suspension (security review, 2026-11-25).
  if v_member.status = 'suspended' then
    raise exception 'This member is suspended. Lift the suspension in Members first.' using errcode = '55000';
  end if;

  v_renewing := private.membership_is_active(v_member.membership_type, v_member.status, v_member.expiry_date);
  v_expiry := (case when v_renewing then greatest(v_today, v_member.expiry_date) else v_today end) + 30;

  update public.members m
  set membership_type = p_membership_type,
      status = 'active',
      expiry_date = v_expiry
  where m.id = v_member.id;

  -- A 'membership' charge: the commission trigger covers court time only, so no
  -- platform commission line is added. Rally Point did not collect this money.
  if v_amount > 0 then
    insert into public.transactions (
      club_id, venue_id, member_id, amount, type, description, created_by, verification_status
    )
    values (
      v_club, null, v_member.id, v_amount, 'membership',
      case when v_renewing then 'Membership renewal (confirmed by staff)'
           else 'New membership (confirmed by staff)' end,
      auth.uid(), 'unverified'
    )
    returning id into v_transaction;
  end if;

  update public.membership_requests r
  set status = 'approved',
      membership_type = p_membership_type,
      amount = v_amount,
      transaction_id = v_transaction,
      decided_at = clock_timestamp(),
      decided_by = auth.uid()
  where r.id = v_request.id;

  insert into public.notifications (club_id, venue_id, user_id, title, body)
  values (
    v_club, null, v_request.user_id,
    case when v_renewing then 'Membership renewed' else 'Membership approved' end,
    'Your membership is active until ' || to_char(v_expiry, 'YYYY-MM-DD')
      || '. You now pay the member rate where a court has one.'
  );
end;
$$;

-- Declines a request with a reason the player sees.
create or replace function public.staff_decline_membership_request(p_request_id uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_membership_desk();
  v_request public.membership_requests;
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\r\n');
begin
  v_request := private.pending_membership_request(v_club, p_request_id);
  if v_reason = '' then
    raise exception 'Please give a reason the player will see' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'The reason is limited to 300 characters' using errcode = '22023';
  end if;

  update public.membership_requests r
  set status = 'declined',
      decline_reason = v_reason,
      decided_at = clock_timestamp(),
      decided_by = auth.uid()
  where r.id = v_request.id;

  insert into public.notifications (club_id, venue_id, user_id, title, body)
  values (v_club, null, v_request.user_id, 'Membership request declined', v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- QR check-in: the member object also says who the desk is looking at
-- ---------------------------------------------------------------------------

-- Copied from 20261017090000_club_context.sql with three additions to the member
-- object: nickname, photo_path and is_active_member. The access check still comes
-- before the code lookup, so the error never reveals whether a code exists in a
-- club the caller cannot work in. Every name is now schema-qualified, so the
-- function runs with an empty search path. CREATE OR REPLACE keeps the owner and
-- execute grants; they are restated below.
create or replace function public.check_in_qr(p_payload text, p_venue_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_member public.members;
  v_profile public.profiles;
  v_checkin public.checkins;
  v_code text := upper(btrim(p_payload));
begin
  if v_club is null or private.can_operate_venue(v_club, p_venue_id) is not true then
    raise exception 'member or venue is outside assigned club';
  end if;
  if left(v_code, 4) = 'RP1|' then v_code := split_part(v_code, '|', 2); end if;
  select * into v_member from public.members m
  where m.club_id = v_club
    and (upper(m.member_code) = v_code or m.qr_token = btrim(p_payload))
  limit 1;
  if v_member.id is null then raise exception 'QR not recognized'; end if;
  v_checkin := public.check_in_member(v_member.id, p_venue_id, 'QR check-in');
  select * into v_profile from public.profiles p where p.id = v_member.user_id;
  return jsonb_build_object(
    'checkin', to_jsonb(v_checkin),
    'member', jsonb_build_object('id', v_member.id, 'club_id', v_member.club_id, 'member_code', v_member.member_code,
      'full_name', v_member.full_name, 'membership_type', v_member.membership_type, 'status', v_member.status,
      'expiry_date', v_member.expiry_date, 'nickname', v_profile.nickname, 'photo_path', v_profile.photo_path,
      'is_active_member', private.membership_is_active(v_member.membership_type, v_member.status, v_member.expiry_date))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and grants. Every public function checks the caller inside.
-- ---------------------------------------------------------------------------

alter function private.membership_is_active(public.membership_type, public.member_status, date) owner to postgres;
alter function private.require_membership_desk() owner to postgres;
alter function private.pending_membership_request(uuid, uuid) owner to postgres;
revoke all on function private.membership_is_active(public.membership_type, public.member_status, date)
  from public, anon, authenticated, service_role;
revoke all on function private.require_membership_desk() from public, anon, authenticated, service_role;
revoke all on function private.pending_membership_request(uuid, uuid) from public, anon, authenticated, service_role;

alter function public.list_my_member_passes() owner to postgres;
alter function public.request_club_membership(uuid) owner to postgres;
alter function public.cancel_my_membership_request(uuid) owner to postgres;
alter function public.staff_list_membership_requests(text) owner to postgres;
alter function public.staff_approve_membership_request(uuid, public.membership_type, numeric) owner to postgres;
alter function public.staff_decline_membership_request(uuid, text) owner to postgres;
alter function public.check_in_qr(text, uuid) owner to postgres;

revoke all on function public.list_my_member_passes() from public, anon;
revoke all on function public.request_club_membership(uuid) from public, anon;
revoke all on function public.cancel_my_membership_request(uuid) from public, anon;
revoke all on function public.staff_list_membership_requests(text) from public, anon;
revoke all on function public.staff_approve_membership_request(uuid, public.membership_type, numeric) from public, anon;
revoke all on function public.staff_decline_membership_request(uuid, text) from public, anon;
revoke all on function public.check_in_qr(text, uuid) from public, anon;

grant execute on function public.list_my_member_passes() to authenticated;
grant execute on function public.request_club_membership(uuid) to authenticated;
grant execute on function public.cancel_my_membership_request(uuid) to authenticated;
grant execute on function public.staff_list_membership_requests(text) to authenticated;
grant execute on function public.staff_approve_membership_request(uuid, public.membership_type, numeric) to authenticated;
grant execute on function public.staff_decline_membership_request(uuid, text) to authenticated;
grant execute on function public.check_in_qr(text, uuid) to authenticated;

comment on function public.list_my_member_passes() is
  'One check-in pass per active club the signed-in person belongs to, whatever club the request names, with the latest membership request at each.';
comment on function public.request_club_membership(uuid) is
  'The signed-in person asks a club they already belong to for a membership or a renewal. One open request per club; at most 5 a day.';
comment on function public.cancel_my_membership_request(uuid) is
  'The signed-in person withdraws their own pending membership request.';
comment on function public.staff_list_membership_requests(text) is
  'Staff or an admin of the active club list its pending or recently decided membership requests.';
comment on function public.staff_approve_membership_request(uuid, public.membership_type, numeric) is
  'Staff or an admin of the active club approve a pending request: plan set, active for 30 more days, amount received recorded as a membership charge, player told.';
comment on function public.staff_decline_membership_request(uuid, text) is
  'Staff or an admin of the active club decline a pending request with a reason the player sees.';
