-- Dashboard analytics: two read-only summary functions, aggregates only.
--
--   admin_club_analytics(p_club_id, p_days)  a club admin's figures for their own club
--   platform_analytics(p_days)               the platform superadmin's cross-club figures
--
-- Both return one jsonb object shaped like ClubAnalytics / PlatformAnalytics in
-- src/lib/analytics.ts (snake_case keys, source = 'server'), with the same rules as
-- buildClubAnalytics / buildPlatformAnalytics there:
--   * days are Philippine (Asia/Manila) calendar days; a period of p_days (7, 30 or
--     90) ends today and includes it, and the previous period is the p_days before;
--   * charges count by the transaction's day, bookings by their start day,
--     commission lines by their own created_at day;
--   * confirmed, completed and no_show bookings keep their hours (count, hours and
--     average amount come from those); cancellations are cancelled plus no_show.
-- The club summary also counts coach lesson requests, which the browser cannot read
-- (the coach tables are closed to API roles). No row about a person leaves either
-- function: no names, emails, phones or member codes, only counts and sums.
--
-- Access: the club summary needs an active admin role in the club the request
-- names (private.require_club_admin, as every admin_* function), and p_club_id must
-- be that club. The platform summary needs a platform superadmin, like the other
-- platform_* reads, which are not written to platform_audit_log; neither is this.
--
-- New functions only: no table, index, policy or grant on a table changes, nothing
-- is written, and nothing inside the reservation-write pause is touched. A hosted
-- apply needs its own approved release.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('private.require_club_admin()') is null
     or to_regprocedure('private.require_platform_superadmin()') is null
     or to_regclass('public.platform_commissions') is null
     or to_regclass('public.club_accounts') is null
     or to_regclass('public.owner_call_requests') is null
     or to_regclass('public.coach_booking_requests') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.bookings'::regclass and attname = 'payment_reference' and not attisdropped
     ) then
    raise exception 'Dashboard analytics needs the club platform, club profile, owner onboarding, GCash checkout and rent-a-coach migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club admin: one club's figures
-- ---------------------------------------------------------------------------

create or replace function public.admin_club_analytics(p_club_id uuid, p_days integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date;
  v_prev_from date;
  v_start timestamptz;
  v_end timestamptz;
begin
  -- The header picks the club and the admin role there is checked above; the club
  -- asked for must be that same club.
  if p_club_id is distinct from v_club then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'Choose a period of 7, 30 or 90 days' using errcode = '22023';
  end if;
  v_from := v_today - (p_days - 1);
  v_prev_from := v_from - p_days;
  -- Philippine midnight at the start of the previous period, and after today.
  v_start := v_prev_from::timestamp at time zone 'Asia/Manila';
  v_end := (v_today + 1)::timestamp at time zone 'Asia/Manila';

  return (
    with periods (is_current, lo, hi) as (
      values (true, v_from, v_today), (false, v_prev_from, v_from - 1)
    ),
    days as (
      select v_from + g.i as day from generate_series(0, p_days - 1) as g(i)
    ),
    tx as (
      select (t.created_at at time zone 'Asia/Manila')::date as day,
             t.amount, t.type::text as tx_type, t.venue_id
      from public.transactions t
      where t.club_id = v_club and t.created_at >= v_start and t.created_at < v_end
    ),
    bk as (
      select (b.start_at at time zone 'Asia/Manila')::date as day,
             extract(hour from (b.start_at at time zone 'Asia/Manila'))::integer as start_hour,
             b.court_id, b.hours, b.amount, b.status::text as status,
             b.status in ('confirmed', 'completed', 'no_show') as held,
             b.payment_reference is not null as online
      from public.bookings b
      where b.club_id = v_club and b.start_at >= v_start and b.start_at < v_end
    ),
    mem as (
      select coalesce(m.join_date, (m.created_at at time zone 'Asia/Manila')::date) as day,
             m.membership_type is not null as has_membership,
             m.status::text as status, m.expiry_date
      from public.members m
      where m.club_id = v_club
    ),
    com as (
      select (pc.created_at at time zone 'Asia/Manila')::date as day, pc.commission_amount as amount
      from public.platform_commissions pc
      where pc.club_id = v_club and pc.created_at >= v_start and pc.created_at < v_end
    ),
    coach as (
      select (r.created_at at time zone 'Asia/Manila')::date as day, r.status
      from public.coach_booking_requests r
      where r.club_id = v_club and r.created_at >= v_start and r.created_at < v_end
    ),
    -- Hours a day each location is open; a closed (inactive) location opens none.
    venue_open as (
      select v.id, v.name,
             case when v.is_active then greatest(0, v.close_hour - v.open_hour) else 0 end as per_day
      from public.venues v
      where v.club_id = v_club
    ),
    court_rows as (
      select c.id, c.name, coalesce(vo.name, '') as venue_name,
             case when c.status = 'maintenance' then 0 else coalesce(vo.per_day, 0) end as open_per_day
      from public.courts c
      left join venue_open vo on vo.id = c.venue_id
      where c.club_id = v_club
    ),
    tx_day as (
      select x.day, sum(x.amount) as charges from tx x group by x.day
    ),
    bk_day as (
      select x.day,
             count(*) filter (where x.held) as bookings,
             coalesce(sum(x.hours) filter (where x.held), 0) as hours,
             coalesce(sum(x.amount) filter (where x.held), 0) as held_amount,
             count(*) filter (where x.status in ('cancelled', 'no_show')) as cancellations
      from bk x group by x.day
    ),
    mem_day as (
      select x.day,
             count(*) filter (where x.has_membership) as joined_members,
             count(*) filter (where not x.has_membership) as joined_players
      from mem x
      where x.day between v_prev_from and v_today
      group by x.day
    ),
    com_day as (
      select x.day, sum(x.amount) as commission from com x group by x.day
    ),
    totals as (
      select p.is_current, jsonb_build_object(
        'charges', coalesce((select sum(x.charges) from tx_day x where x.day between p.lo and p.hi), 0),
        'bookings', coalesce((select sum(x.bookings) from bk_day x where x.day between p.lo and p.hi), 0),
        'hours', coalesce((select sum(x.hours) from bk_day x where x.day between p.lo and p.hi), 0),
        'open_hours', (select coalesce(sum(c.open_per_day), 0) from court_rows c) * p_days,
        'new_members', coalesce((select sum(x.joined_members) from mem_day x where x.day between p.lo and p.hi), 0),
        'new_players', coalesce((select sum(x.joined_players) from mem_day x where x.day between p.lo and p.hi), 0),
        'cancellations', coalesce((select sum(x.cancellations) from bk_day x where x.day between p.lo and p.hi), 0),
        'avg_booking', (
          select case when coalesce(sum(x.bookings), 0) > 0
                      then round(sum(x.held_amount) / sum(x.bookings), 2) else 0 end
          from bk_day x where x.day between p.lo and p.hi),
        'commission', coalesce((select sum(x.commission) from com_day x where x.day between p.lo and p.hi), 0)
      ) as figures
      from periods p
    )
    select jsonb_build_object(
      'period', jsonb_build_object(
        'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD'), 'days', p_days),
      'previous_period', jsonb_build_object(
        'from', to_char(v_prev_from, 'YYYY-MM-DD'), 'to', to_char(v_from - 1, 'YYYY-MM-DD'), 'days', p_days),
      'current', (select t.figures from totals t where t.is_current),
      'previous', (select t.figures from totals t where not t.is_current),
      'by_day', (
        select jsonb_agg(jsonb_build_object(
                 'day', to_char(d.day, 'YYYY-MM-DD'),
                 'charges', coalesce(t.charges, 0),
                 'bookings', coalesce(b.bookings, 0),
                 'hours', coalesce(b.hours, 0),
                 'new_members', coalesce(m.joined_members + m.joined_players, 0),
                 'cancellations', coalesce(b.cancellations, 0),
                 'commission', coalesce(c.commission, 0)
               ) order by d.day)
        from days d
        left join tx_day t on t.day = d.day
        left join bk_day b on b.day = d.day
        left join mem_day m on m.day = d.day
        left join com_day c on c.day = d.day),
      'charges_by_type', coalesce((
        select jsonb_agg(jsonb_build_object('type', s.tx_type, 'amount', s.amount)
                 order by array_position(
                   array['booking', 'court_rental', 'extension', 'membership', 'walk_in', 'other'], s.tx_type),
                 s.tx_type)
        from (
          select x.tx_type, sum(x.amount) as amount
          from tx x where x.day between v_from and v_today
          group by x.tx_type
        ) s), '[]'::jsonb),
      'charges_by_venue', coalesce((
        select jsonb_agg(jsonb_build_object('venue_id', s.venue_id, 'name', s.name, 'amount', s.amount)
                 order by s.amount desc, s.name, s.venue_id)
        from (
          select x.venue_id,
                 case when x.venue_id is null then 'No location'
                      else coalesce(max(vo.name), 'Other location') end as name,
                 sum(x.amount) as amount
          from tx x
          left join venue_open vo on vo.id = x.venue_id
          where x.day between v_from and v_today
          group by x.venue_id
        ) s), '[]'::jsonb),
      'bookings_by_status', coalesce((
        select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n)
                 order by array_position(
                   array['confirmed', 'completed', 'pending_payment', 'cancelled', 'no_show'], s.status),
                 s.status)
        from (
          select x.status, count(*) as n
          from bk x where x.day between v_from and v_today
          group by x.status
        ) s), '[]'::jsonb),
      'courts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'court_id', c.id, 'name', c.name, 'venue_name', c.venue_name,
                 'hours', coalesce(h.hours, 0), 'open_hours', c.open_per_day * p_days)
                 order by coalesce(h.hours, 0) desc, c.name, c.id)
        from court_rows c
        left join (
          select x.court_id, sum(x.hours) as hours
          from bk x where x.held and x.day between v_from and v_today
          group by x.court_id
        ) h on h.court_id = c.id), '[]'::jsonb),
      -- 7 rows (Monday first) of 24 hours: each kept booking adds 1 to every hour it
      -- covers, stopping at 23:00.
      'busy_hours', (
        select jsonb_agg(r.cells order by r.wd)
        from (
          select w.wd, jsonb_agg(coalesce(bh.n, 0) order by hr.h) as cells
          from generate_series(0, 6) as w(wd)
          cross join generate_series(0, 23) as hr(h)
          left join (
            select extract(isodow from x.day)::integer - 1 as wd, x.start_hour + k.k as h, count(*) as n
            from bk x
            cross join lateral generate_series(0, x.hours - 1) as k(k)
            where x.held and x.day between v_from and v_today and x.start_hour + k.k < 24
            group by 1, 2
          ) bh on bh.wd = w.wd and bh.h = hr.h
          group by w.wd
        ) r),
      'payment_split', (
        select jsonb_build_object(
                 'online', count(*) filter (where x.online),
                 'desk', count(*) filter (where not x.online))
        from bk x where x.held and x.day between v_from and v_today),
      -- How things stand today, whatever the period.
      'members', (
        select jsonb_build_object(
                 'active_members', count(*) filter (
                   where x.has_membership and x.status = 'active'
                     and (x.expiry_date is null or x.expiry_date >= v_today)),
                 'ending_soon', count(*) filter (
                   where x.has_membership and x.status = 'active'
                     and x.expiry_date >= v_today and x.expiry_date <= v_today + 7),
                 'players', count(*) filter (where not x.has_membership))
        from mem x),
      -- Lesson requests made in each period, and those of the current period the
      -- coach accepted (still accepted, or since played or missed).
      'coaching', (
        select jsonb_build_object(
                 'requests', count(*) filter (where x.day between v_from and v_today),
                 'previous_requests', count(*) filter (where x.day between v_prev_from and v_from - 1),
                 'accepted', count(*) filter (
                   where x.day between v_from and v_today and x.status in ('accepted', 'completed', 'no_show')))
        from coach x),
      'source', 'server'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform superadmin: figures across clubs
-- ---------------------------------------------------------------------------

create or replace function public.platform_analytics(p_days integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date;
  v_prev_from date;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_platform_superadmin();
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'Choose a period of 7, 30 or 90 days' using errcode = '22023';
  end if;
  v_from := v_today - (p_days - 1);
  v_prev_from := v_from - p_days;
  v_start := v_prev_from::timestamp at time zone 'Asia/Manila';
  v_end := (v_today + 1)::timestamp at time zone 'Asia/Manila';

  return (
    with periods (is_current, lo, hi) as (
      values (true, v_from, v_today), (false, v_prev_from, v_from - 1)
    ),
    days as (
      select v_from + g.i as day from generate_series(0, p_days - 1) as g(i)
    ),
    ledger as (
      select (pc.created_at at time zone 'Asia/Manila')::date as day,
             pc.club_id, pc.gross_amount, pc.commission_amount
      from public.platform_commissions pc
      where pc.created_at >= v_start and pc.created_at < v_end
    ),
    -- The same status platform_list_clubs shows.
    club_rows as (
      select c.id, c.name,
             coalesce(a.status, case when c.is_active then 'active' else 'provisioning' end) as status,
             (c.created_at at time zone 'Asia/Manila')::date as day
      from public.clubs c
      left join public.club_accounts a on a.club_id = c.id
    ),
    owner_requests as (
      select (r.created_at at time zone 'Asia/Manila')::date as day, r.status,
             coalesce(nullif(btrim(r.city), ''), 'Not given') as city
      from public.owner_call_requests r
      where r.created_at >= v_start and r.created_at < v_end
    ),
    ledger_day as (
      select x.day, sum(x.gross_amount) as gross, sum(x.commission_amount) as commission, count(*) as lines
      from ledger x group by x.day
    ),
    club_day as (
      select x.day, count(*) as new_clubs
      from club_rows x where x.day between v_prev_from and v_today
      group by x.day
    ),
    request_day as (
      select x.day, count(*) as requests from owner_requests x group by x.day
    ),
    totals as (
      select p.is_current, jsonb_build_object(
        'gross', coalesce((select sum(x.gross) from ledger_day x where x.day between p.lo and p.hi), 0),
        'commission', coalesce((select sum(x.commission) from ledger_day x where x.day between p.lo and p.hi), 0),
        'lines', coalesce((select sum(x.lines) from ledger_day x where x.day between p.lo and p.hi), 0),
        'new_clubs', coalesce((select sum(x.new_clubs) from club_day x where x.day between p.lo and p.hi), 0),
        'requests', coalesce((select sum(x.requests) from request_day x where x.day between p.lo and p.hi), 0)
      ) as figures
      from periods p
    )
    select jsonb_build_object(
      'period', jsonb_build_object(
        'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD'), 'days', p_days),
      'previous_period', jsonb_build_object(
        'from', to_char(v_prev_from, 'YYYY-MM-DD'), 'to', to_char(v_from - 1, 'YYYY-MM-DD'), 'days', p_days),
      'current', (select t.figures from totals t where t.is_current),
      'previous', (select t.figures from totals t where not t.is_current),
      'by_day', (
        select jsonb_agg(jsonb_build_object(
                 'day', to_char(d.day, 'YYYY-MM-DD'),
                 'gross', coalesce(l.gross, 0),
                 'commission', coalesce(l.commission, 0),
                 'lines', coalesce(l.lines, 0),
                 'new_clubs', coalesce(c.new_clubs, 0),
                 'requests', coalesce(r.requests, 0)
               ) order by d.day)
        from days d
        left join ledger_day l on l.day = d.day
        left join club_day c on c.day = d.day
        left join request_day r on r.day = d.day),
      -- Clubs ranked by charges recorded in the current period.
      'top_clubs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'club_id', s.club_id, 'name', s.name, 'gross', s.gross,
                 'commission', s.commission, 'lines', s.lines)
                 order by s.gross desc, s.name, s.club_id)
        from (
          select x.club_id, c.name, sum(x.gross_amount) as gross,
                 sum(x.commission_amount) as commission, count(*) as lines
          from ledger x
          join public.clubs c on c.id = x.club_id
          where x.day between v_from and v_today
          group by x.club_id, c.name
        ) s), '[]'::jsonb),
      'clubs_by_status', coalesce((
        select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n)
                 order by array_position(array['active', 'provisioning', 'suspended'], s.status), s.status)
        from (select x.status, count(*) as n from club_rows x group by x.status) s), '[]'::jsonb),
      -- Requests received in the current period, by where they stand now.
      'requests_by_status', coalesce((
        select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n)
                 order by array_position(array['new', 'called', 'closed'], s.status), s.status)
        from (
          select x.status, count(*) as n
          from owner_requests x where x.day between v_from and v_today
          group by x.status
        ) s), '[]'::jsonb),
      'requests_by_city', coalesce((
        select jsonb_agg(jsonb_build_object('city', s.city, 'count', s.n) order by s.n desc, s.city)
        from (
          select x.city, count(*) as n
          from owner_requests x where x.day between v_from and v_today
          group by x.city
        ) s), '[]'::jsonb),
      'ledger_capped', false,
      'source', 'server'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and grants. Both functions check the caller inside.
-- ---------------------------------------------------------------------------

alter function public.admin_club_analytics(uuid, integer) owner to postgres;
alter function public.platform_analytics(integer) owner to postgres;

revoke all on function public.admin_club_analytics(uuid, integer) from public, anon, service_role;
revoke all on function public.platform_analytics(integer) from public, anon, service_role;

grant execute on function public.admin_club_analytics(uuid, integer) to authenticated;
grant execute on function public.platform_analytics(integer) to authenticated;

comment on function public.admin_club_analytics(uuid, integer) is
  'Club admin only: read-only totals for the current club over the last 7, 30 or 90 Philippine days and the same span before (charges, bookings, hours, members, commission, coach requests). Counts and sums only, never people.';
comment on function public.platform_analytics(integer) is
  'Platform superadmin only: read-only totals across clubs over the last 7, 30 or 90 Philippine days and the same span before (ledger, new clubs, owner requests). Counts and sums only, never people.';
