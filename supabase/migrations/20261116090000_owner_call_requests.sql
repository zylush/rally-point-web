-- Owner call requests: a court owner asks Rally Point to call them about listing
-- their club.
--
-- Anyone may send a request from the public "I own a court" page, without an
-- account, through request_owner_call(). It checks every field, needs a phone
-- number or an email, and refuses floods: at most 3 requests from the same phone
-- or email in a day, and at most 30 from everyone in an hour.
--
-- Only platform superadmins see the requests, through the audited platform_*
-- functions below. They mark a request as called or closed, then set the club
-- up with the existing "Set up a club" step. The table has no direct API access.
-- The audit log records status changes by request id only, never the owner's
-- name, phone or email.
--
-- New table and functions only. Nothing inside the reservation-write pause
-- changes. A hosted apply needs its own approved release.

do $$
begin
  if to_regprocedure('private.require_platform_superadmin()') is null
     or to_regprocedure('private.platform_audit(text, uuid, jsonb)') is null then
    raise exception 'Owner call requests need the platform control migration first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.owner_call_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  full_name text not null constraint owner_call_requests_full_name_check check (char_length(full_name) between 2 and 80),
  club_name text not null constraint owner_call_requests_club_name_check check (char_length(club_name) between 2 and 120),
  city text not null constraint owner_call_requests_city_check check (char_length(city) between 2 and 80),
  court_count integer not null constraint owner_call_requests_court_count_check check (court_count between 1 and 50),
  phone text constraint owner_call_requests_phone_check check (phone ~ '^\+?[0-9 ()-]{7,24}$'),
  email text constraint owner_call_requests_email_check check (
    char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  preferred_date date not null,
  preferred_time text not null constraint owner_call_requests_preferred_time_check
    check (preferred_time in ('morning', 'afternoon', 'evening')),
  message text constraint owner_call_requests_message_check check (char_length(message) between 1 and 1000),
  status text not null default 'new' constraint owner_call_requests_status_check
    check (status in ('new', 'called', 'closed')),
  created_at timestamptz not null default clock_timestamp(),
  handled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null,
  constraint owner_call_requests_contact_check check (phone is not null or email is not null)
);
create index owner_call_requests_created_idx on public.owner_call_requests (created_at desc);
create index owner_call_requests_handled_by_idx on public.owner_call_requests (handled_by);

-- ---------------------------------------------------------------------------
-- Public: send a request (no account needed)
-- ---------------------------------------------------------------------------

create or replace function public.request_owner_call(
  p_full_name text,
  p_club_name text,
  p_city text,
  p_court_count integer,
  p_phone text,
  p_email text,
  p_preferred_date date,
  p_preferred_time text,
  p_message text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_club text := btrim(coalesce(p_club_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_digits text;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Enter your name (2 to 80 characters)' using errcode = '22023';
  end if;
  if char_length(v_club) < 2 or char_length(v_club) > 120 then
    raise exception 'Enter your club or venue name (2 to 120 characters)' using errcode = '22023';
  end if;
  if char_length(v_city) < 2 or char_length(v_city) > 80 then
    raise exception 'Enter the city (2 to 80 characters)' using errcode = '22023';
  end if;
  if p_court_count is null or p_court_count < 1 or p_court_count > 50 then
    raise exception 'Enter how many courts you have (1 to 50)' using errcode = '22023';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Give a mobile number or an email so we can reach you' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,24}$' then
    raise exception 'Enter a mobile number like 0917 123 4567' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter an email like name@example.com' using errcode = '22023';
  end if;
  if p_preferred_date is null or p_preferred_date < v_today or p_preferred_date > v_today + 60 then
    raise exception 'Choose a day from today to 60 days ahead' using errcode = '22023';
  end if;
  if p_preferred_time is null or p_preferred_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Choose morning, afternoon or evening' using errcode = '22023';
  end if;
  if v_message is not null and char_length(v_message) > 1000 then
    raise exception 'Keep the message under 1,000 characters' using errcode = '22023';
  end if;

  -- One request at a time, so the flood checks below count correctly.
  perform pg_advisory_xact_lock(hashtext('public.owner_call_requests'));
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  if (
    select count(*) from public.owner_call_requests r
    where r.created_at > now() - interval '1 day'
      and ((v_digits is not null and regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') = v_digits)
        or (v_email is not null and r.email = v_email))
  ) >= 3 then
    raise exception 'You already asked us to call. We will contact you soon.' using errcode = '54000';
  end if;
  if (select count(*) from public.owner_call_requests r where r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We are getting many requests right now. Please try again in an hour.' using errcode = '54000';
  end if;

  insert into public.owner_call_requests (
    full_name, club_name, city, court_count, phone, email, preferred_date, preferred_time, message
  )
  values (v_name, v_club, v_city, p_court_count, v_phone, v_email, p_preferred_date, p_preferred_time, v_message)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform: read and follow up (superadmin only, audited)
-- ---------------------------------------------------------------------------

create or replace function public.platform_owner_call_requests(p_status text default null, p_limit integer default 100)
returns table (
  id uuid, full_name text, club_name text, city text, court_count integer,
  phone text, email text, preferred_date date, preferred_time text, message text,
  status text, created_at timestamptz, handled_at timestamptz, handled_by_email text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_platform_superadmin();
  if p_status is not null and p_status not in ('new', 'called', 'closed') then
    raise exception 'Unknown request status' using errcode = '22023';
  end if;
  return query
  select r.id, r.full_name, r.club_name, r.city, r.court_count,
         r.phone, r.email, r.preferred_date, r.preferred_time, r.message,
         r.status, r.created_at, r.handled_at, u.email::text
  from public.owner_call_requests r
  left join auth.users u on u.id = r.handled_by
  where p_status is null or r.status = p_status
  order by r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.platform_set_owner_call_status(p_request_id uuid, p_status text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old text;
begin
  perform private.require_platform_superadmin();
  if p_status is null or p_status not in ('new', 'called', 'closed') then
    raise exception 'Unknown request status' using errcode = '22023';
  end if;
  select r.status into v_old from public.owner_call_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  update public.owner_call_requests
  set status = p_status,
      handled_at = case when p_status = 'new' then null else now() end,
      handled_by = case when p_status = 'new' then null else (select auth.uid()) end
  where id = p_request_id;
  -- The request id only: the owner's name and contact details stay out of the log.
  perform private.platform_audit('owner_request.status', null,
    jsonb_build_object('request_id', p_request_id, 'from', v_old, 'to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership, row security and grants. New objects get no privileges by default.
-- ---------------------------------------------------------------------------

alter table public.owner_call_requests enable row level security;
revoke all on table public.owner_call_requests from public, anon, authenticated;
-- Say so with an explicit deny policy, like the platform tables (Supabase lint 0008).
create policy no_direct_api_access on public.owner_call_requests
  as restrictive for all to anon, authenticated using (false) with check (false);

alter function public.request_owner_call(text, text, text, integer, text, text, date, text, text) owner to postgres;
alter function public.platform_owner_call_requests(text, integer) owner to postgres;
alter function public.platform_set_owner_call_status(uuid, text) owner to postgres;

-- Open to visitors on purpose: the "I own a court" page works without an account.
revoke all on function public.request_owner_call(text, text, text, integer, text, text, date, text, text) from public;
grant execute on function public.request_owner_call(text, text, text, integer, text, text, date, text, text) to anon, authenticated;

revoke all on function public.platform_owner_call_requests(text, integer) from public, anon;
revoke all on function public.platform_set_owner_call_status(uuid, text) from public, anon;
grant execute on function public.platform_owner_call_requests(text, integer) to authenticated;
grant execute on function public.platform_set_owner_call_status(uuid, text) to authenticated;

comment on table public.owner_call_requests is
  'Court owners asking Rally Point to call them about listing their club. Written only through request_owner_call; read only by platform superadmins.';
