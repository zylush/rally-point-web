-- Club leaderboard: matches, derived player rankings, and designated staff scorers.
--
-- Rankings are derived from completed club_matches rows so voiding a mistaken entry
-- cleanly recalculates every player's points (+3 win, +1 played/loss), wins, losses,
-- win percentage, point differential, and streak.
--
-- All three tables stay closed to direct API roles; public, player, staff, and admin
-- reads/writes go through the security-definer functions below. Public reads expose
-- display names, optional nicknames, profile photo paths, and match stats only —
-- never member email, phone, member_code, QR token, or billing fields.
--
-- Nothing inside the reservation-write pause changes.

do $$
begin
  if to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('private.require_club_admin()') is null
     or to_regprocedure('private.tidy_name(text)') is null
     or to_regclass('public.club_accounts') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.profiles'::regclass and attname = 'nickname' and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.profiles'::regclass and attname = 'photo_path' and not attisdropped
     ) then
    raise exception 'Club leaderboard requires club context, club platform, and member profile migrations first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables and covering foreign-key indexes
-- ---------------------------------------------------------------------------

create table public.club_leaderboard_scorers (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_leaderboard_scorers_user_id on public.club_leaderboard_scorers (user_id);
create index club_leaderboard_scorers_granted_by on public.club_leaderboard_scorers (granted_by);

create table public.club_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  venue_id uuid,
  court_id uuid,
  -- Reserved for Phase 2 tournaments so tournament matches feed the club leaderboard directly.
  tournament_id uuid,
  format text not null constraint club_matches_format_check check (format in ('doubles', 'singles')),
  winner_side text not null constraint club_matches_winner_side_check check (winner_side in ('a', 'b')),
  score_a integer constraint club_matches_score_a_check check (score_a is null or (score_a between 0 and 99)),
  score_b integer constraint club_matches_score_b_check check (score_b is null or (score_b between 0 and 99)),
  notes text constraint club_matches_notes_check check (notes is null or (char_length(notes) between 1 and 200 and notes = btrim(notes))),
  status text not null default 'completed' constraint club_matches_status_check check (status in ('completed', 'voided')),
  recorded_by uuid references auth.users (id) on delete set null,
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  void_reason text constraint club_matches_void_reason_check check (void_reason is null or (char_length(void_reason) between 1 and 200 and void_reason = btrim(void_reason))),
  played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (club_id, id),
  constraint club_matches_scores_pair_check check ((score_a is null) = (score_b is null)),
  constraint club_matches_winner_score_check check (
    score_a is null
    or (winner_side = 'a' and score_a > score_b)
    or (winner_side = 'b' and score_b > score_a)
  ),
  constraint club_matches_void_state_check check (
    (status = 'completed' and voided_at is null)
    or (status = 'voided' and voided_at is not null)
  ),
  constraint club_matches_venue_fk foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict,
  constraint club_matches_court_fk foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict
);
create index club_matches_club_played on public.club_matches (club_id, played_at desc);
create index club_matches_club_venue on public.club_matches (club_id, venue_id);
create index club_matches_club_court on public.club_matches (club_id, court_id);
create index club_matches_recorded_by on public.club_matches (recorded_by);
create index club_matches_voided_by on public.club_matches (voided_by);

create table public.club_match_players (
  match_id uuid not null,
  club_id uuid not null,
  member_id uuid not null,
  side text not null constraint club_match_players_side_check check (side in ('a', 'b')),
  slot smallint not null constraint club_match_players_slot_check check (slot in (1, 2)),
  primary key (match_id, member_id),
  unique (match_id, side, slot),
  constraint club_match_players_match_fk foreign key (club_id, match_id) references public.club_matches (club_id, id) on delete cascade,
  constraint club_match_players_member_fk foreign key (club_id, member_id) references public.members (club_id, id) on delete restrict
);
create index club_match_players_club_match on public.club_match_players (club_id, match_id);
create index club_match_players_club_member on public.club_match_players (club_id, member_id);

-- Closed to direct PostgREST access: every operation goes through the checked RPCs below.
alter table public.club_leaderboard_scorers enable row level security;
alter table public.club_matches enable row level security;
alter table public.club_match_players enable row level security;

revoke all on table public.club_leaderboard_scorers from public, anon, authenticated;
revoke all on table public.club_matches from public, anon, authenticated;
revoke all on table public.club_match_players from public, anon, authenticated;

create policy no_direct_api_access on public.club_leaderboard_scorers
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_matches
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_match_players
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function private.can_score_club_matches(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and p_club_id is not null
     and (
       private.current_club_role(p_club_id) = 'admin'::public.user_role
       or (
         private.current_club_role(p_club_id) = 'staff'::public.user_role
         and exists (
           select 1 from public.club_leaderboard_scorers s
           where s.club_id = p_club_id and s.user_id = auth.uid()
         )
       )
     );
$$;

create or replace function private.require_club_scorer()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if auth.uid() is null or v_club is null or private.can_score_club_matches(v_club) is not true then
    raise exception 'Only club admins and designated scorers can record match results' using errcode = '42501';
  end if;
  return v_club;
end;
$$;

create or replace function private.club_match_json(p_match_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'club_id', m.club_id,
    'venue_id', m.venue_id,
    'venue_name', v.name,
    'court_id', m.court_id,
    'court_name', co.name,
    'tournament_id', m.tournament_id,
    'format', m.format,
    'winner_side', m.winner_side,
    'score_a', m.score_a,
    'score_b', m.score_b,
    'notes', m.notes,
    'status', m.status,
    'void_reason', m.void_reason,
    'played_at', m.played_at,
    'created_at', m.created_at,
    'team_a', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', mem.id,
        'full_name', mem.full_name,
        'nickname', prof.nickname,
        'photo_path', prof.photo_path
      ) order by mp.slot)
      from public.club_match_players mp
      join public.members mem on mem.club_id = mp.club_id and mem.id = mp.member_id
      left join public.profiles prof on prof.id = mem.user_id
      where mp.match_id = m.id and mp.side = 'a'
    ), '[]'::jsonb),
    'team_b', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', mem.id,
        'full_name', mem.full_name,
        'nickname', prof.nickname,
        'photo_path', prof.photo_path
      ) order by mp.slot)
      from public.club_match_players mp
      join public.members mem on mem.club_id = mp.club_id and mem.id = mp.member_id
      left join public.profiles prof on prof.id = mem.user_id
      where mp.match_id = m.id and mp.side = 'b'
    ), '[]'::jsonb)
  )
  from public.club_matches m
  left join public.venues v on v.club_id = m.club_id and v.id = m.venue_id
  left join public.courts co on co.club_id = m.club_id and co.id = m.court_id
  where m.id = p_match_id;
$$;

create or replace function private.club_leaderboard_payload(
  p_club_id uuid,
  p_period text,
  p_format text,
  p_limit integer,
  p_include_voided boolean,
  p_my_member_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_period text := lower(btrim(coalesce(p_period, 'month')));
  v_format text := lower(btrim(coalesce(p_format, 'all')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_since timestamptz := null;
  v_club jsonb;
  v_entries jsonb;
  v_recent jsonb;
  v_my_entry jsonb;
  v_total_players integer := 0;
  v_total_matches integer := 0;
begin
  if v_period not in ('month', 'all') then
    raise exception 'Invalid leaderboard period' using errcode = '22023';
  end if;
  if v_format not in ('all', 'doubles', 'singles') then
    raise exception 'Invalid match format' using errcode = '22023';
  end if;
  if v_period = 'month' then
    v_since := date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  end if;

  select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name)
  into v_club
  from public.clubs c
  where c.id = p_club_id;

  with scoped_completed as (
    select m.*
    from public.club_matches m
    where m.club_id = p_club_id
      and m.status = 'completed'
      and (v_since is null or m.played_at >= v_since)
      and (v_format = 'all' or m.format = v_format)
  ),
  player_games as (
    select
      mp.member_id,
      (m.winner_side = mp.side) as won,
      case
        when m.score_a is null or m.score_b is null then 0
        when mp.side = 'a' then m.score_a - m.score_b
        else m.score_b - m.score_a
      end as diff,
      row_number() over (partition by mp.member_id order by m.played_at desc, m.created_at desc, m.id desc) as rn
    from scoped_completed m
    join public.club_match_players mp on mp.club_id = m.club_id and mp.match_id = m.id
  ),
  latest_outcomes as (
    select member_id, won as first_won
    from player_games
    where rn = 1
  ),
  streak_breaks as (
    select pg.member_id, min(pg.rn) as break_rn
    from player_games pg
    join latest_outcomes lo on lo.member_id = pg.member_id
    where pg.won <> lo.first_won
    group by pg.member_id
  ),
  agg as (
    select
      pg.member_id,
      count(*) filter (where pg.won)::integer as wins,
      count(*) filter (where not pg.won)::integer as losses,
      count(*)::integer as games_played,
      (count(*) filter (where pg.won) * 3 + count(*) filter (where not pg.won))::integer as points,
      coalesce(sum(pg.diff), 0)::integer as score_diff,
      case
        when lo.first_won then coalesce(sb.break_rn - 1, count(*))::integer
        else -coalesce(sb.break_rn - 1, count(*))::integer
      end as streak
    from player_games pg
    join latest_outcomes lo on lo.member_id = pg.member_id
    left join streak_breaks sb on sb.member_id = pg.member_id
    group by pg.member_id, lo.first_won, sb.break_rn
  ),
  ranked as (
    select
      row_number() over (
        order by
          a.points desc,
          a.wins desc,
          (a.wins::numeric / greatest(a.games_played, 1)) desc,
          a.score_diff desc,
          a.games_played desc,
          lower(mem.full_name) asc,
          mem.id asc
      )::integer as rank,
      mem.id as member_id,
      mem.full_name,
      prof.nickname,
      prof.photo_path,
      a.points,
      a.wins,
      a.losses,
      a.games_played,
      round((a.wins::numeric * 100.0) / greatest(a.games_played, 1))::integer as win_pct,
      a.score_diff,
      a.streak
    from agg a
    join public.members mem on mem.club_id = p_club_id and mem.id = a.member_id
    left join public.profiles prof on prof.id = mem.user_id
  )
  select
    count(*)::integer,
    coalesce((
      select jsonb_agg(to_jsonb(r) order by r.rank)
      from ranked r
      where r.rank <= v_limit
    ), '[]'::jsonb),
    (
      select to_jsonb(r)
      from ranked r
      where p_my_member_id is not null and r.member_id = p_my_member_id
      limit 1
    )
  into v_total_players, v_entries, v_my_entry
  from ranked;

  select count(*)::integer
  into v_total_matches
  from public.club_matches m
  where m.club_id = p_club_id
    and m.status = 'completed'
    and (v_since is null or m.played_at >= v_since)
    and (v_format = 'all' or m.format = v_format);

  select coalesce((
    select jsonb_agg(private.club_match_json(m.id) order by m.played_at desc, m.created_at desc, m.id desc)
    from (
      select m.id, m.played_at, m.created_at
      from public.club_matches m
      where m.club_id = p_club_id
        and (p_include_voided or m.status = 'completed')
        and (v_since is null or m.played_at >= v_since)
        and (v_format = 'all' or m.format = v_format)
      order by m.played_at desc, m.created_at desc, m.id desc
      limit 25
    ) m
  ), '[]'::jsonb)
  into v_recent;

  return jsonb_build_object(
    'club', v_club,
    'period', v_period,
    'format', v_format,
    'entries', coalesce(v_entries, '[]'::jsonb),
    'recent_matches', coalesce(v_recent, '[]'::jsonb),
    'total_players', coalesce(v_total_players, 0),
    'total_matches', coalesce(v_total_matches, 0),
    'my_member_id', p_my_member_id,
    'my_entry', v_my_entry
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public and member-facing reads
-- ---------------------------------------------------------------------------

create or replace function public.get_public_club_leaderboard(
  p_slug text,
  p_period text default 'month',
  p_format text default 'all',
  p_limit integer default 50
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club_id uuid;
begin
  select c.id into v_club_id
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.slug = lower(btrim(coalesce(p_slug, '')))
    and c.is_active
    and a.status = 'active';
  if v_club_id is null then
    return null;
  end if;
  return private.club_leaderboard_payload(v_club_id, p_period, p_format, p_limit, false, null);
end;
$$;

create or replace function public.get_public_player_matches(
  p_slug text,
  p_member_id uuid,
  p_limit integer default 15
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
begin
  select c.id into v_club_id
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.slug = lower(btrim(coalesce(p_slug, '')))
    and c.is_active
    and a.status = 'active';
  if v_club_id is null then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(private.club_match_json(m.id) order by m.played_at desc, m.created_at desc, m.id desc)
    from (
      select m.id, m.played_at, m.created_at
      from public.club_matches m
      where m.club_id = v_club_id
        and m.status = 'completed'
        and exists (
          select 1 from public.club_match_players mp
          where mp.club_id = m.club_id and mp.match_id = m.id and mp.member_id = p_member_id
        )
      order by m.played_at desc, m.created_at desc, m.id desc
      limit v_limit
    ) m
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_club_leaderboard(
  p_period text default 'month',
  p_format text default 'all',
  p_limit integer default 100
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_role public.user_role;
  v_member_id uuid;
  v_payload jsonb;
begin
  if auth.uid() is null or v_club is null then
    raise exception 'Sign in to view club standings' using errcode = '42501';
  end if;
  v_role := private.current_club_role(v_club);
  if v_role is null then
    raise exception 'You do not belong to this club' using errcode = '42501';
  end if;

  select mem.id into v_member_id
  from public.members mem
  where mem.club_id = v_club and mem.user_id = auth.uid()
  limit 1;

  v_payload := private.club_leaderboard_payload(
    v_club,
    p_period,
    p_format,
    p_limit,
    v_role in ('staff'::public.user_role, 'admin'::public.user_role),
    v_member_id
  );
  return v_payload || jsonb_build_object('can_score', private.can_score_club_matches(v_club));
end;
$$;

-- ---------------------------------------------------------------------------
-- Designated scorer and admin writes
-- ---------------------------------------------------------------------------

create or replace function public.staff_record_club_match(
  p_format text,
  p_team_a uuid[],
  p_team_b uuid[],
  p_winner_side text,
  p_score_a integer default null,
  p_score_b integer default null,
  p_venue_id uuid default null,
  p_court_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_scorer();
  v_format text := lower(btrim(coalesce(p_format, '')));
  v_winner text := lower(btrim(coalesce(p_winner_side, '')));
  v_expected_size integer;
  v_all_players uuid[];
  v_distinct_count integer;
  v_member_count integer;
  v_venue_id uuid := p_venue_id;
  v_court_venue_id uuid;
  v_notes text := nullif(private.tidy_name(p_notes), '');
  v_match_id uuid;
begin
  if v_format not in ('doubles', 'singles') then
    raise exception 'Choose singles or doubles' using errcode = '22023';
  end if;
  if v_winner not in ('a', 'b') then
    raise exception 'Choose which team won' using errcode = '22023';
  end if;

  v_expected_size := case when v_format = 'singles' then 1 else 2 end;
  if array_ndims(p_team_a) is distinct from 1
     or array_ndims(p_team_b) is distinct from 1
     or coalesce(array_length(p_team_a, 1), 0) <> v_expected_size
     or coalesce(array_length(p_team_b, 1), 0) <> v_expected_size then
    raise exception 'Choose % player(s) per team for %', v_expected_size, v_format using errcode = '22023';
  end if;

  v_all_players := p_team_a || p_team_b;
  select count(distinct x)::integer into v_distinct_count
  from unnest(v_all_players) as t(x)
  where x is not null;
  if v_distinct_count <> (v_expected_size * 2) then
    raise exception 'Choose different players for each spot' using errcode = '22023';
  end if;

  select count(*)::integer into v_member_count
  from public.members mem
  where mem.club_id = v_club and mem.id = any(v_all_players);
  if v_member_count <> (v_expected_size * 2) then
    raise exception 'Every player must belong to this club' using errcode = '22023';
  end if;

  if (p_score_a is null) <> (p_score_b is null) then
    raise exception 'Enter scores for both teams, or leave both blank' using errcode = '22023';
  end if;
  if p_score_a is not null then
    if p_score_a < 0 or p_score_a > 99 or p_score_b < 0 or p_score_b > 99 then
      raise exception 'Scores must be between 0 and 99' using errcode = '22023';
    end if;
    if (v_winner = 'a' and p_score_a <= p_score_b) or (v_winner = 'b' and p_score_b <= p_score_a) then
      raise exception 'Winning team score must be higher than the losing team score' using errcode = '22023';
    end if;
  end if;

  if v_notes is not null and char_length(v_notes) > 200 then
    raise exception 'Notes are limited to 200 characters' using errcode = '22023';
  end if;

  if p_court_id is not null then
    select co.venue_id into v_court_venue_id
    from public.courts co
    where co.id = p_court_id and co.club_id = v_club;
    if not found then
      raise exception 'Court not found in this club' using errcode = 'P0002';
    end if;
    if v_venue_id is not null and v_venue_id <> v_court_venue_id then
      raise exception 'Court belongs to another venue' using errcode = '22023';
    end if;
    v_venue_id := v_court_venue_id;
  elsif v_venue_id is not null then
    if not exists (select 1 from public.venues v where v.id = v_venue_id and v.club_id = v_club) then
      raise exception 'Venue not found in this club' using errcode = 'P0002';
    end if;
  end if;

  insert into public.club_matches (
    club_id, venue_id, court_id, format, winner_side, score_a, score_b, notes, recorded_by
  )
  values (
    v_club, v_venue_id, p_court_id, v_format, v_winner, p_score_a, p_score_b, v_notes, auth.uid()
  )
  returning id into v_match_id;

  insert into public.club_match_players (match_id, club_id, member_id, side, slot)
  select v_match_id, v_club, u.member_id, 'a', u.ord::smallint
  from unnest(p_team_a) with ordinality as u(member_id, ord)
  union all
  select v_match_id, v_club, u.member_id, 'b', u.ord::smallint
  from unnest(p_team_b) with ordinality as u(member_id, ord);

  return private.club_match_json(v_match_id);
end;
$$;

create or replace function public.staff_void_club_match(
  p_match_id uuid,
  p_reason text default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_scorer();
  v_reason text := nullif(private.tidy_name(p_reason), '');
begin
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'Reason is limited to 200 characters' using errcode = '22023';
  end if;

  update public.club_matches m
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = clock_timestamp(),
      void_reason = v_reason
  where m.id = p_match_id
    and m.club_id = v_club
    and m.status = 'completed';

  if not found then
    raise exception 'Match not found or already voided' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_list_leaderboard_scorers()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', r.user_id,
      'full_name', coalesce(p.full_name, 'Staff'),
      'email', coalesce(p.email, ''),
      'can_score', (s.user_id is not null)
    ) order by lower(coalesce(p.full_name, '')), r.user_id)
    from public.club_staff_roles r
    left join public.profiles p on p.id = r.user_id
    left join public.club_leaderboard_scorers s on s.club_id = r.club_id and s.user_id = r.user_id
    where r.club_id = v_club
      and r.role = 'staff'::public.user_role
      and r.is_active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_leaderboard_scorer(
  p_user_id uuid,
  p_can_score boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  if p_user_id is null or not exists (
    select 1 from public.club_staff_roles r
    where r.club_id = v_club
      and r.user_id = p_user_id
      and r.role = 'staff'::public.user_role
      and r.is_active
  ) then
    raise exception 'Active staff member not found in this club' using errcode = 'P0002';
  end if;

  if coalesce(p_can_score, false) then
    insert into public.club_leaderboard_scorers (club_id, user_id, granted_by)
    values (v_club, p_user_id, auth.uid())
    on conflict (club_id, user_id) do nothing;
  else
    delete from public.club_leaderboard_scorers s
    where s.club_id = v_club and s.user_id = p_user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function private.can_score_club_matches(uuid) owner to postgres;
alter function private.require_club_scorer() owner to postgres;
alter function private.club_match_json(uuid) owner to postgres;
alter function private.club_leaderboard_payload(uuid, text, text, integer, boolean, uuid) owner to postgres;

alter function public.get_public_club_leaderboard(text, text, text, integer) owner to postgres;
alter function public.get_public_player_matches(text, uuid, integer) owner to postgres;
alter function public.get_club_leaderboard(text, text, integer) owner to postgres;
alter function public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text) owner to postgres;
alter function public.staff_void_club_match(uuid, text) owner to postgres;
alter function public.admin_list_leaderboard_scorers() owner to postgres;
alter function public.admin_set_leaderboard_scorer(uuid, boolean) owner to postgres;

revoke all on function private.can_score_club_matches(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_club_scorer() from public, anon, authenticated, service_role;
revoke all on function private.club_match_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.club_leaderboard_payload(uuid, text, text, integer, boolean, uuid) from public, anon, authenticated, service_role;

revoke all on function public.get_public_club_leaderboard(text, text, text, integer) from public;
grant execute on function public.get_public_club_leaderboard(text, text, text, integer) to anon, authenticated;

revoke all on function public.get_public_player_matches(text, uuid, integer) from public;
grant execute on function public.get_public_player_matches(text, uuid, integer) to anon, authenticated;

revoke all on function public.get_club_leaderboard(text, text, integer) from public, anon;
grant execute on function public.get_club_leaderboard(text, text, integer) to authenticated;

revoke all on function public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text) from public, anon;
grant execute on function public.staff_record_club_match(text, uuid[], uuid[], text, integer, integer, uuid, uuid, text) to authenticated;

revoke all on function public.staff_void_club_match(uuid, text) from public, anon;
grant execute on function public.staff_void_club_match(uuid, text) to authenticated;

revoke all on function public.admin_list_leaderboard_scorers() from public, anon;
grant execute on function public.admin_list_leaderboard_scorers() to authenticated;

revoke all on function public.admin_set_leaderboard_scorer(uuid, boolean) from public, anon;
grant execute on function public.admin_set_leaderboard_scorer(uuid, boolean) to authenticated;

comment on table public.club_leaderboard_scorers is
  'Staff members authorized by a club admin to record and void club match results.';
comment on table public.club_matches is
  'Completed or voided singles/doubles matches within a club. Standings are derived from completed rows.';
comment on table public.club_match_players is
  'Players participating on side a or b of a club match.';
