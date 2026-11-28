-- Tournament fixes from the review of the leaderboard and tournaments release.
--
-- 1. Undo a result in any tournament. Until now a result could only be voided through its
--    leaderboard row (staff_void_club_match), so a match in a tournament that does not count
--    for the leaderboard (no club_matches row) could never be corrected.
--    staff_void_tournament_match works from the tournament match itself: with a leaderboard row
--    it hands over to staff_void_club_match (same rules, the row is voided); without one it
--    applies the same bracket and queue rules directly.
-- 2. Limits: at most 64 players and 300 matches per tournament, so rosters and the public
--    bracket stay a bounded size (a 32-team bracket has at most 63 matches).
-- 3. Courts: a match that is waiting or being played cannot be put on a court that is out of
--    service, and a match that is ready or being played cannot share its court with another
--    such match in the club. A court someone picks is refused; when a match only becomes ready
--    again (a bracket winner advancing, a result undone) on a court that is now busy or out of
--    service, the court is cleared instead, so scoring and undo never fail. The queue draw's
--    automatic court picker now looks across the club as well.
--
-- Nothing in the reservation-write pause is written (courts are only read).

do $$
begin
  if to_regprocedure('public.staff_void_club_match(uuid, text)') is null
     or to_regprocedure('private.require_tournament_scorer(uuid)') is null
     or to_regclass('public.club_tournament_matches') is null then
    raise exception 'Apply 20261126090000_club_tournaments.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Undo a tournament result
-- ---------------------------------------------------------------------------

create or replace function public.staff_void_tournament_match(
  p_tournament_id uuid,
  p_match_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_tournament_scorer(p_tournament_id);
  v_reason text := nullif(private.tidy_name(p_reason), '');
  v_t public.club_tournaments;
  v_tm public.club_tournament_matches;
  v_next_status text;
  v_tournament_status text;
  v_match_status text;
  v_club_match_id uuid;
begin
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'Reason is limited to 200 characters' using errcode = '22023';
  end if;

  -- First look without locks: a counted result is handed to staff_void_club_match before this
  -- function locks anything, so both take their locks in the same order (leaderboard row first).
  select t.status into v_tournament_status
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club;
  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_tournament_status not in ('live', 'completed') then
    raise exception 'Results can only be undone in a running or finished tournament' using errcode = '22023';
  end if;

  select m.status, m.club_match_id into v_match_status, v_club_match_id
  from public.club_tournament_matches m
  where m.id = p_match_id and m.tournament_id = p_tournament_id and m.club_id = v_club;
  if not found then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;
  if v_match_status <> 'completed' then
    raise exception 'Only a finished match can be undone' using errcode = '22023';
  end if;

  -- Counts for the leaderboard: the leaderboard row is voided and the bracket or queue reset there.
  if v_club_match_id is not null then
    perform public.staff_void_club_match(v_club_match_id, v_reason);
    return public.get_club_tournament(p_tournament_id);
  end if;

  -- No leaderboard row: lock the tournament, then the match (as scoring does), and check again.
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;
  select * into v_tm
  from public.club_tournament_matches m
  where m.id = p_match_id and m.tournament_id = p_tournament_id and m.club_id = v_club
  for update;
  if v_t.status not in ('live', 'completed') or v_tm.status <> 'completed' or v_tm.club_match_id is not null then
    raise exception 'This result changed while it was being undone; try again' using errcode = '40001';
  end if;

  -- The same rules as staff_void_club_match.
  if v_t.format = 'single_elimination' then
    if v_tm.next_match_id is not null then
      select nm.status into v_next_status
      from public.club_tournament_matches nm
      where nm.id = v_tm.next_match_id and nm.club_id = v_club
      for update;

      if v_next_status = 'completed' then
        raise exception 'Cannot void a bracket match after the next round has been played' using errcode = '22023';
      end if;

      if v_tm.next_match_side = 'a' then
        update public.club_tournament_matches
        set team_a_id = null, team_a_player_ids = '{}'::uuid[], status = 'pending'
        where id = v_tm.next_match_id and club_id = v_club;
      else
        update public.club_tournament_matches
        set team_b_id = null, team_b_player_ids = '{}'::uuid[], status = 'pending'
        where id = v_tm.next_match_id and club_id = v_club;
      end if;
    else
      update public.club_tournaments
      set status = 'live', completed_at = null
      where id = v_tm.tournament_id and club_id = v_club and status = 'completed';
    end if;

    update public.club_tournament_matches
    set status = 'ready',
        winner_side = null,
        score_a = null,
        score_b = null,
        club_match_id = null,
        completed_at = null
    where id = v_tm.id and club_id = v_club;
  else
    update public.club_tournament_matches
    set status = 'voided',
        club_match_id = null
    where id = v_tm.id and club_id = v_club;
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tournament size limits
-- ---------------------------------------------------------------------------

create or replace function private.enforce_tournament_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'club_tournament_players' then
    if exists (
      select 1
      from (select distinct n.tournament_id from new_rows n) t
      where (select count(*) from public.club_tournament_players p where p.tournament_id = t.tournament_id) > 64
    ) then
      raise exception 'A tournament can have at most 64 players' using errcode = '22023';
    end if;
  elsif exists (
    select 1
    from (select distinct n.tournament_id from new_rows n) t
    where (select count(*) from public.club_tournament_matches m where m.tournament_id = t.tournament_id) > 300
  ) then
    raise exception 'This tournament has reached its limit of 300 matches' using errcode = '22023';
  end if;
  return null;
end;
$$;

create trigger club_tournament_players_limit
  after insert on public.club_tournament_players
  referencing new table as new_rows
  for each statement execute function private.enforce_tournament_limits();

create trigger club_tournament_matches_limit
  after insert on public.club_tournament_matches
  referencing new table as new_rows
  for each statement execute function private.enforce_tournament_limits();

-- ---------------------------------------------------------------------------
-- 3. Court checks
-- ---------------------------------------------------------------------------

create or replace function private.check_tournament_match_court()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_court_status text;
  v_court_chosen boolean;
begin
  if new.court_id is null or new.status not in ('pending', 'ready', 'playing') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.court_id is not distinct from old.court_id
     and new.status is not distinct from old.status then
    return new;
  end if;
  -- Someone picked this court (a new match, or a court change). Otherwise the match only changed
  -- status, keeping an earlier court: a bracket winner advancing, or a result being undone.
  v_court_chosen := tg_op = 'INSERT' or new.court_id is distinct from old.court_id;

  -- One court at a time: two staff assigning the same court wait for each other.
  perform pg_advisory_xact_lock(hashtextextended('club_tournament_court:' || new.court_id::text, 0));

  select co.status into v_court_status
  from public.courts co
  where co.id = new.court_id and co.club_id = new.club_id;

  -- A waiting bracket match may be lined up on a busy court; a match being played may not share it.
  if v_court_status = 'maintenance'
     or (new.status in ('ready', 'playing') and exists (
       select 1
       from public.club_tournament_matches m
       where m.club_id = new.club_id
         and m.court_id = new.court_id
         and m.id <> new.id
         and m.status in ('ready', 'playing'))) then
    if v_court_chosen then
      if v_court_status = 'maintenance' then
        raise exception 'That court is out of service' using errcode = '22023';
      end if;
      raise exception 'That court already has a match on it' using errcode = '22023';
    end if;
    -- Never block scoring or an undo: the match loses its old court and staff pick a free one.
    new.court_id := null;
  end if;

  return new;
end;
$$;

create trigger club_tournament_matches_court_check
  before insert or update of court_id, status on public.club_tournament_matches
  for each row execute function private.check_tournament_match_court();

-- The automatic court picker for queue draws now skips courts that any match in the club is
-- using, not only this tournament's, so it agrees with the court check above. The function is
-- otherwise unchanged from 20261126090000_club_tournaments.sql (one line removed in the picker).
create or replace function private.draw_next_tournament_queue_match(
  p_club_id uuid,
  p_tournament_id uuid,
  p_court_id uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_t public.club_tournaments;
  v_picked uuid[];
  v_team_a uuid[];
  v_team_b uuid[];
  v_court_id uuid := p_court_id;
  v_court_venue_id uuid;
  v_next_order integer;
  v_match_id uuid;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = p_club_id
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.format <> 'random_queue' then
    raise exception 'Random match draws are only available for queue mixer tournaments' using errcode = '22023';
  end if;
  if v_t.status <> 'live' then
    raise exception 'Start the tournament before drawing queue matches' using errcode = '22023';
  end if;

  if v_court_id is not null then
    select co.venue_id into v_court_venue_id
    from public.courts co
    where co.id = v_court_id and co.club_id = p_club_id;
    if not found then
      raise exception 'Court not found in this club' using errcode = 'P0002';
    end if;
    if v_t.venue_id is not null and v_court_venue_id <> v_t.venue_id then
      raise exception 'Court belongs to another venue' using errcode = '22023';
    end if;
  else
    select co.id into v_court_id
    from public.courts co
    where co.club_id = p_club_id
      and co.status <> 'maintenance'
      and (v_t.venue_id is null or co.venue_id = v_t.venue_id)
      and not exists (
        select 1 from public.club_tournament_matches m
        where m.club_id = p_club_id
          and m.status in ('ready', 'playing')
          and m.court_id = co.id
      )
    order by co.name asc, co.id asc
    limit 1;
  end if;

  with active_players as (
    select unnest(m.team_a_player_ids || m.team_b_player_ids) as member_id
    from public.club_tournament_matches m
    where m.club_id = p_club_id
      and m.tournament_id = p_tournament_id
      and m.status in ('ready', 'playing')
  ),
  game_counts as (
    select u.member_id, count(*)::integer as games
    from public.club_tournament_matches m
    cross join lateral unnest(m.team_a_player_ids || m.team_b_player_ids) as u(member_id)
    where m.club_id = p_club_id
      and m.tournament_id = p_tournament_id
      and m.status = 'completed'
    group by u.member_id
  ),
  free_players as (
    select
      tp.member_id,
      coalesce(gc.games, 0) as games
    from public.club_tournament_players tp
    left join game_counts gc on gc.member_id = tp.member_id
    where tp.club_id = p_club_id
      and tp.tournament_id = p_tournament_id
      and not exists (select 1 from active_players ap where ap.member_id = tp.member_id)
    order by coalesce(gc.games, 0) asc, random()
    limit (v_t.team_size * 2)
  )
  select coalesce(array_agg(fp.member_id), '{}'::uuid[])
  into v_picked
  from free_players fp;

  if coalesce(array_length(v_picked, 1), 0) < (v_t.team_size * 2) then
    raise exception 'Not enough free players for another match right now. Finish a current game or add more players.' using errcode = '22023';
  end if;

  if v_t.team_size = 1 then
    v_team_a := array[v_picked[1]];
    v_team_b := array[v_picked[2]];
  else
    with pair_options as (
      select
        array[v_picked[1], v_picked[2]] as team_a,
        array[v_picked[3], v_picked[4]] as team_b
      union all
      select
        array[v_picked[1], v_picked[3]],
        array[v_picked[2], v_picked[4]]
      union all
      select
        array[v_picked[1], v_picked[4]],
        array[v_picked[2], v_picked[3]]
    ),
    scored as (
      select
        po.team_a,
        po.team_b,
        (
          select count(*)::integer
          from public.club_tournament_matches m
          where m.club_id = p_club_id
            and m.tournament_id = p_tournament_id
            and m.status <> 'voided'
            and (
              m.team_a_player_ids @> po.team_a
              or m.team_b_player_ids @> po.team_a
              or m.team_a_player_ids @> po.team_b
              or m.team_b_player_ids @> po.team_b
            )
        ) as repeat_partners
      from pair_options po
    )
    select s.team_a, s.team_b
    into v_team_a, v_team_b
    from scored s
    order by s.repeat_partners asc, random()
    limit 1;
  end if;

  select coalesce(max(m.match_order), 0) + 1
  into v_next_order
  from public.club_tournament_matches m
  where m.club_id = p_club_id and m.tournament_id = p_tournament_id;

  insert into public.club_tournament_matches (
    club_id, tournament_id, round_number, match_order, court_id,
    team_a_player_ids, team_b_player_ids, status
  )
  values (
    p_club_id, p_tournament_id, 1, v_next_order, v_court_id,
    v_team_a, v_team_b, 'ready'
  )
  returning id into v_match_id;

  return v_match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function public.staff_void_tournament_match(uuid, uuid, text) owner to postgres;
alter function private.enforce_tournament_limits() owner to postgres;
alter function private.check_tournament_match_court() owner to postgres;

revoke all on function private.enforce_tournament_limits() from public, anon, authenticated, service_role;
revoke all on function private.check_tournament_match_court() from public, anon, authenticated, service_role;

revoke all on function public.staff_void_tournament_match(uuid, uuid, text) from public, anon;
grant execute on function public.staff_void_tournament_match(uuid, uuid, text) to authenticated;
