-- Phase 2: Club tournaments — Single-Elimination Brackets & Random Queue Mixer.
--
-- Builds directly on Phase 1's club_matches, club_match_players, and
-- club_leaderboard_scorers tables so tournament results immediately update
-- club-wide leaderboards (when counts_for_leaderboard = true) and broadcast
-- clean realtime updates without exposing player contact details.
--
-- All new tables stay closed to direct PostgREST access via restrictive RLS +
-- revoked table privileges; every read and write runs through SECURITY DEFINER
-- functions with explicit club, role, and privacy checks.
-- Nothing inside the reservation-write pause changes.

do $$
begin
  if to_regclass('public.club_matches') is null
     or to_regclass('public.club_match_players') is null
     or to_regclass('public.club_leaderboard_scorers') is null
     or to_regprocedure('private.can_score_club_matches(uuid)') is null
     or to_regprocedure('private.current_club_id()') is null
     or to_regprocedure('private.current_club_role(uuid)') is null
     or to_regprocedure('private.require_club_admin()') is null
     or to_regprocedure('private.tidy_name(text)') is null then
    raise exception 'Club tournaments require the Phase 1 club leaderboard migration first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables and covering foreign-key indexes
-- ---------------------------------------------------------------------------

create table public.club_tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  venue_id uuid,
  title text not null constraint club_tournaments_title_check check (char_length(title) between 1 and 120 and title = btrim(title)),
  format text not null constraint club_tournaments_format_check check (format in ('single_elimination', 'random_queue')),
  team_size smallint not null constraint club_tournaments_team_size_check check (team_size in (1, 2)),
  status text not null default 'setup' constraint club_tournaments_status_check check (status in ('setup', 'live', 'completed', 'cancelled')),
  counts_for_leaderboard boolean not null default true,
  scheduled_at timestamptz,
  notes text constraint club_tournaments_notes_check check (notes is null or (char_length(notes) between 1 and 240 and notes = btrim(notes))),
  created_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, id),
  constraint club_tournaments_venue_fk foreign key (club_id, venue_id) references public.venues (club_id, id) on delete restrict
);
create index club_tournaments_club_created on public.club_tournaments (club_id, created_at desc);
create index club_tournaments_club_venue on public.club_tournaments (club_id, venue_id);
create index club_tournaments_created_by on public.club_tournaments (created_by);

alter table public.club_matches
  add constraint club_matches_tournament_fk
  foreign key (tournament_id) references public.club_tournaments (id) on delete set null;
create index club_matches_tournament_id on public.club_matches (tournament_id);

create table public.club_tournament_scorers (
  club_id uuid not null,
  tournament_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id),
  constraint club_tournament_scorers_tournament_fk
    foreign key (club_id, tournament_id) references public.club_tournaments (club_id, id) on delete cascade
);
create index club_tournament_scorers_club_tournament on public.club_tournament_scorers (club_id, tournament_id);
create index club_tournament_scorers_user_id on public.club_tournament_scorers (user_id);
create index club_tournament_scorers_granted_by on public.club_tournament_scorers (granted_by);

create table public.club_tournament_players (
  club_id uuid not null,
  tournament_id uuid not null,
  member_id uuid not null,
  seed_order integer not null default 1 constraint club_tournament_players_seed_check check (seed_order >= 1),
  created_at timestamptz not null default now(),
  primary key (tournament_id, member_id),
  constraint club_tournament_players_tournament_fk
    foreign key (club_id, tournament_id) references public.club_tournaments (club_id, id) on delete cascade,
  constraint club_tournament_players_member_fk
    foreign key (club_id, member_id) references public.members (club_id, id) on delete restrict
);
create index club_tournament_players_club_tournament on public.club_tournament_players (club_id, tournament_id);
create index club_tournament_players_club_member on public.club_tournament_players (club_id, member_id);

create table public.club_tournament_teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  tournament_id uuid not null,
  seed integer not null constraint club_tournament_teams_seed_check check (seed >= 1),
  name text not null constraint club_tournament_teams_name_check check (char_length(name) between 1 and 160),
  player_1_id uuid not null,
  player_2_id uuid,
  created_at timestamptz not null default now(),
  unique (tournament_id, seed),
  constraint club_tournament_teams_distinct_players check (player_2_id is null or player_1_id <> player_2_id),
  constraint club_tournament_teams_tournament_fk
    foreign key (club_id, tournament_id) references public.club_tournaments (club_id, id) on delete cascade,
  constraint club_tournament_teams_p1_fk
    foreign key (club_id, player_1_id) references public.members (club_id, id) on delete restrict,
  constraint club_tournament_teams_p2_fk
    foreign key (club_id, player_2_id) references public.members (club_id, id) on delete restrict
);
create index club_tournament_teams_club_tournament on public.club_tournament_teams (club_id, tournament_id);
create index club_tournament_teams_club_p1 on public.club_tournament_teams (club_id, player_1_id);
create index club_tournament_teams_club_p2 on public.club_tournament_teams (club_id, player_2_id);

create table public.club_tournament_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  tournament_id uuid not null,
  round_number smallint not null constraint club_tournament_matches_round_check check (round_number >= 1),
  match_order integer not null constraint club_tournament_matches_order_check check (match_order >= 1),
  court_id uuid,
  team_a_id uuid references public.club_tournament_teams (id) on delete cascade,
  team_b_id uuid references public.club_tournament_teams (id) on delete cascade,
  team_a_player_ids uuid[] not null default '{}',
  team_b_player_ids uuid[] not null default '{}',
  status text not null default 'pending'
    constraint club_tournament_matches_status_check check (status in ('pending', 'ready', 'playing', 'completed', 'bye', 'voided')),
  winner_side text constraint club_tournament_matches_winner_check check (winner_side is null or winner_side in ('a', 'b')),
  score_a integer constraint club_tournament_matches_score_a_check check (score_a is null or (score_a between 0 and 99)),
  score_b integer constraint club_tournament_matches_score_b_check check (score_b is null or (score_b between 0 and 99)),
  next_match_id uuid references public.club_tournament_matches (id) on delete set null,
  next_match_side text constraint club_tournament_matches_next_side_check check (next_match_side is null or next_match_side in ('a', 'b')),
  club_match_id uuid references public.club_matches (id) on delete set null,
  recorded_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, round_number, match_order),
  constraint club_tournament_matches_scores_pair check ((score_a is null) = (score_b is null)),
  constraint club_tournament_matches_winner_score check (
    score_a is null
    or (winner_side = 'a' and score_a > score_b)
    or (winner_side = 'b' and score_b > score_a)
  ),
  constraint club_tournament_matches_next_pair check ((next_match_id is null) = (next_match_side is null)),
  constraint club_tournament_matches_tournament_fk
    foreign key (club_id, tournament_id) references public.club_tournaments (club_id, id) on delete cascade,
  constraint club_tournament_matches_court_fk
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict
);
create index club_tournament_matches_club_tournament on public.club_tournament_matches (club_id, tournament_id);
create index club_tournament_matches_club_court on public.club_tournament_matches (club_id, court_id);
create index club_tournament_matches_team_a on public.club_tournament_matches (team_a_id);
create index club_tournament_matches_team_b on public.club_tournament_matches (team_b_id);
create index club_tournament_matches_next_match on public.club_tournament_matches (next_match_id);
create index club_tournament_matches_club_match on public.club_tournament_matches (club_match_id);
create index club_tournament_matches_recorded_by on public.club_tournament_matches (recorded_by);

-- Closed to direct PostgREST access: every operation goes through the checked RPCs below.
alter table public.club_tournaments enable row level security;
alter table public.club_tournament_scorers enable row level security;
alter table public.club_tournament_players enable row level security;
alter table public.club_tournament_teams enable row level security;
alter table public.club_tournament_matches enable row level security;

revoke all on table public.club_tournaments from public, anon, authenticated;
revoke all on table public.club_tournament_scorers from public, anon, authenticated;
revoke all on table public.club_tournament_players from public, anon, authenticated;
revoke all on table public.club_tournament_teams from public, anon, authenticated;
revoke all on table public.club_tournament_matches from public, anon, authenticated;

create policy no_direct_api_access on public.club_tournaments
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_tournament_scorers
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_tournament_players
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_tournament_teams
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy no_direct_api_access on public.club_tournament_matches
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

-- Keep Phase 1 match payloads enriched with tournament_title when linked.
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
    'tournament_title', t.title,
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
  left join public.club_tournaments t on t.club_id = m.club_id and t.id = m.tournament_id
  where m.id = p_match_id;
$$;

create or replace function private.can_score_tournament(p_club_id uuid, p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and p_club_id is not null
     and p_tournament_id is not null
     and (
       private.can_score_club_matches(p_club_id)
       or (
         private.current_club_role(p_club_id) = 'staff'::public.user_role
         and exists (
           select 1 from public.club_tournament_scorers ts
           where ts.club_id = p_club_id
             and ts.tournament_id = p_tournament_id
             and ts.user_id = auth.uid()
         )
       )
     );
$$;

create or replace function private.require_tournament_scorer(p_tournament_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
begin
  if auth.uid() is null or v_club is null or p_tournament_id is null
     or private.can_score_tournament(v_club, p_tournament_id) is not true then
    raise exception 'Only club admins and designated scorers can score this tournament' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.club_tournaments t
    where t.id = p_tournament_id and t.club_id = v_club
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  return v_club;
end;
$$;

create or replace function private.tournament_round_label(
  p_format text,
  p_round integer,
  p_total_rounds integer,
  p_match_order integer
)
returns text
language sql immutable security definer set search_path = ''
as $$
  select case
    when p_format = 'random_queue' then 'Game ' || p_match_order
    when p_round >= p_total_rounds then 'Finals'
    when p_round = p_total_rounds - 1 and p_total_rounds >= 2 then 'Semifinals'
    when p_round = p_total_rounds - 2 and p_total_rounds >= 3 then 'Quarterfinals'
    else 'Round ' || p_round
  end;
$$;

create or replace function private.build_tournament_bracket_draw(
  p_club_id uuid,
  p_tournament_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_t public.club_tournaments;
  v_players uuid[];
  v_names text[];
  v_player_count integer;
  v_team_count integer;
  v_team_ids uuid[] := '{}'::uuid[];
  v_p1 uuid;
  v_p2 uuid;
  v_n1 text;
  v_n2 text;
  v_team_name text;
  v_team_id uuid;
  v_bracket_size integer := 2;
  v_total_rounds integer := 1;
  v_seed_order integer[] := array[1, 2];
  v_next_order integer[];
  v_cur_size integer := 2;
  v_round integer;
  v_match_count integer;
  v_match_idx integer;
  v_next_round_ids uuid[] := '{}'::uuid[];
  v_cur_round_ids uuid[] := '{}'::uuid[];
  v_next_match_id uuid;
  v_next_side text;
  v_new_match_id uuid;
  v_seed_a integer;
  v_seed_b integer;
  v_ta_id uuid;
  v_tb_id uuid;
  v_ta_players uuid[];
  v_tb_players uuid[];
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = p_club_id
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.format <> 'single_elimination' then
    raise exception 'Bracket draws apply only to single-elimination tournaments' using errcode = '22023';
  end if;
  if v_t.status <> 'setup' then
    raise exception 'Teams can only be randomized before the tournament starts' using errcode = '22023';
  end if;

  select
    coalesce(array_agg(tp.member_id order by ord), '{}'::uuid[]),
    coalesce(array_agg(coalesce(nullif(btrim(prof.nickname), ''), mem.full_name) order by ord), '{}'::text[])
  into v_players, v_names
  from (
    select tp.member_id, row_number() over (order by random()) as ord
    from public.club_tournament_players tp
    where tp.club_id = p_club_id and tp.tournament_id = p_tournament_id
  ) tp
  join public.members mem on mem.club_id = p_club_id and mem.id = tp.member_id
  left join public.profiles prof on prof.id = mem.user_id;

  v_player_count := coalesce(array_length(v_players, 1), 0);
  if v_t.team_size = 1 and v_player_count < 2 then
    raise exception 'Add at least 2 players to create a singles bracket' using errcode = '22023';
  end if;
  if v_t.team_size = 2 and (v_player_count < 4 or mod(v_player_count, 2) <> 0) then
    raise exception 'Doubles brackets need an even number of players (at least 4)' using errcode = '22023';
  end if;

  v_team_count := v_player_count / v_t.team_size;
  if v_team_count > 32 then
    raise exception 'Brackets support up to 32 teams' using errcode = '22023';
  end if;

  delete from public.club_tournament_matches
  where club_id = p_club_id and tournament_id = p_tournament_id;

  delete from public.club_tournament_teams
  where club_id = p_club_id and tournament_id = p_tournament_id;

  for v_match_idx in 1..v_team_count loop
    if v_t.team_size = 1 then
      v_p1 := v_players[v_match_idx];
      v_p2 := null;
      v_n1 := v_names[v_match_idx];
      v_team_name := left(v_n1, 160);
    else
      v_p1 := v_players[(v_match_idx - 1) * 2 + 1];
      v_p2 := v_players[(v_match_idx - 1) * 2 + 2];
      v_n1 := v_names[(v_match_idx - 1) * 2 + 1];
      v_n2 := v_names[(v_match_idx - 1) * 2 + 2];
      v_team_name := left(v_n1 || ' / ' || v_n2, 160);
    end if;

    insert into public.club_tournament_teams (
      club_id, tournament_id, seed, name, player_1_id, player_2_id
    )
    values (
      p_club_id, p_tournament_id, v_match_idx, v_team_name, v_p1, v_p2
    )
    returning id into v_team_id;

    v_team_ids := v_team_ids || v_team_id;
  end loop;

  while v_bracket_size < v_team_count loop
    v_bracket_size := v_bracket_size * 2;
    v_total_rounds := v_total_rounds + 1;
  end loop;

  while v_cur_size < v_bracket_size loop
    v_next_order := '{}'::integer[];
    for v_match_idx in 1..v_cur_size loop
      v_next_order := v_next_order
        || v_seed_order[v_match_idx]
        || ((v_cur_size * 2) + 1 - v_seed_order[v_match_idx]);
    end loop;
    v_seed_order := v_next_order;
    v_cur_size := v_cur_size * 2;
  end loop;

  -- Build rounds from the Finals back down to Round 1 so next_match_id links cleanly.
  for v_round in reverse v_total_rounds..1 loop
    v_match_count := (power(2, v_total_rounds - v_round))::integer;
    v_cur_round_ids := '{}'::uuid[];

    for v_match_idx in 1..v_match_count loop
      if v_round = v_total_rounds then
        v_next_match_id := null;
        v_next_side := null;
      else
        v_next_match_id := v_next_round_ids[((v_match_idx - 1) / 2) + 1];
        v_next_side := case when mod(v_match_idx, 2) = 1 then 'a' else 'b' end;
      end if;

      if v_round = 1 then
        v_seed_a := v_seed_order[(v_match_idx - 1) * 2 + 1];
        v_seed_b := v_seed_order[(v_match_idx - 1) * 2 + 2];

        v_ta_id := v_team_ids[v_seed_a];
        select case when tt.player_2_id is null then array[tt.player_1_id] else array[tt.player_1_id, tt.player_2_id] end
        into v_ta_players
        from public.club_tournament_teams tt
        where tt.id = v_ta_id;

        if v_seed_b <= v_team_count then
          v_tb_id := v_team_ids[v_seed_b];
          select case when tt.player_2_id is null then array[tt.player_1_id] else array[tt.player_1_id, tt.player_2_id] end
          into v_tb_players
          from public.club_tournament_teams tt
          where tt.id = v_tb_id;

          insert into public.club_tournament_matches (
            club_id, tournament_id, round_number, match_order,
            team_a_id, team_b_id, team_a_player_ids, team_b_player_ids,
            status, next_match_id, next_match_side
          )
          values (
            p_club_id, p_tournament_id, v_round, v_match_idx,
            v_ta_id, v_tb_id, v_ta_players, v_tb_players,
            'ready', v_next_match_id, v_next_side
          )
          returning id into v_new_match_id;
        else
          insert into public.club_tournament_matches (
            club_id, tournament_id, round_number, match_order,
            team_a_id, team_b_id, team_a_player_ids, team_b_player_ids,
            status, winner_side, next_match_id, next_match_side, completed_at
          )
          values (
            p_club_id, p_tournament_id, v_round, v_match_idx,
            v_ta_id, null, v_ta_players, '{}'::uuid[],
            'bye', 'a', v_next_match_id, v_next_side, now()
          )
          returning id into v_new_match_id;

          if v_next_match_id is not null then
            if v_next_side = 'a' then
              update public.club_tournament_matches
              set team_a_id = v_ta_id,
                  team_a_player_ids = v_ta_players
              where id = v_next_match_id;
            else
              update public.club_tournament_matches
              set team_b_id = v_ta_id,
                  team_b_player_ids = v_ta_players
              where id = v_next_match_id;
            end if;
          end if;
        end if;
      else
        insert into public.club_tournament_matches (
          club_id, tournament_id, round_number, match_order,
          status, next_match_id, next_match_side
        )
        values (
          p_club_id, p_tournament_id, v_round, v_match_idx,
          'pending', v_next_match_id, v_next_side
        )
        returning id into v_new_match_id;
      end if;

      v_cur_round_ids := v_cur_round_ids || v_new_match_id;
    end loop;

    v_next_round_ids := v_cur_round_ids;
  end loop;

  -- Any second-round slot filled on both sides by Round 1 BYEs is immediately ready.
  update public.club_tournament_matches
  set status = 'ready'
  where club_id = p_club_id
    and tournament_id = p_tournament_id
    and status = 'pending'
    and team_a_id is not null
    and team_b_id is not null;
end;
$$;

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
          and m.tournament_id = p_tournament_id
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

create or replace function private.tournament_summary_json(p_tournament_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'club_id', t.club_id,
    'venue_id', t.venue_id,
    'venue_name', v.name,
    'title', t.title,
    'format', t.format,
    'team_size', t.team_size,
    'status', t.status,
    'counts_for_leaderboard', t.counts_for_leaderboard,
    'scheduled_at', t.scheduled_at,
    'notes', t.notes,
    'started_at', t.started_at,
    'completed_at', t.completed_at,
    'created_at', t.created_at,
    'player_count', (
      select count(*)::integer from public.club_tournament_players tp
      where tp.tournament_id = t.id
    ),
    'team_count', (
      select count(*)::integer from public.club_tournament_teams tt
      where tt.tournament_id = t.id
    ),
    'active_matches', (
      select count(*)::integer from public.club_tournament_matches m
      where m.tournament_id = t.id and m.status in ('ready', 'playing')
    ),
    'completed_matches', (
      select count(*)::integer from public.club_tournament_matches m
      where m.tournament_id = t.id and m.status = 'completed'
    ),
    'total_matches', (
      select count(*)::integer from public.club_tournament_matches m
      where m.tournament_id = t.id and m.status not in ('bye', 'voided')
    ),
    'champion_label', case
      when t.status <> 'completed' then null
      when t.format = 'single_elimination' then (
        select case when m.winner_side = 'a' then ta.name else tb.name end
        from public.club_tournament_matches m
        left join public.club_tournament_teams ta on ta.id = m.team_a_id
        left join public.club_tournament_teams tb on tb.id = m.team_b_id
        where m.tournament_id = t.id
          and m.next_match_id is null
          and m.status = 'completed'
        limit 1
      )
      else (
        select coalesce(nullif(btrim(prof.nickname), ''), mem.full_name)
        from (
          select
            u.member_id,
            count(*) filter (where u.won) as wins,
            count(*) filter (where not u.won) as losses,
            (count(*) filter (where u.won) * 3 + count(*) filter (where not u.won)) as points,
            sum(u.diff) as score_diff,
            count(*) as games_played
          from (
            select
              mp_id as member_id,
              (m.winner_side = side_label) as won,
              case
                when m.score_a is null or m.score_b is null then 0
                when side_label = 'a' then m.score_a - m.score_b
                else m.score_b - m.score_a
              end as diff
            from public.club_tournament_matches m
            cross join lateral (
              select unnest(m.team_a_player_ids) as mp_id, 'a'::text as side_label
              union all
              select unnest(m.team_b_player_ids) as mp_id, 'b'::text as side_label
            ) sides
            where m.tournament_id = t.id and m.status = 'completed'
          ) u
          group by u.member_id
        ) st
        join public.members mem on mem.club_id = t.club_id and mem.id = st.member_id
        left join public.profiles prof on prof.id = mem.user_id
        order by
          st.points desc,
          st.wins desc,
          (st.wins::numeric / greatest(st.games_played, 1)) desc,
          st.score_diff desc,
          st.games_played desc,
          lower(mem.full_name) asc,
          mem.id asc
        limit 1
      )
    end
  )
  from public.club_tournaments t
  left join public.venues v on v.club_id = t.club_id and v.id = t.venue_id
  where t.id = p_tournament_id;
$$;

create or replace function private.tournament_detail_payload(
  p_club_id uuid,
  p_tournament_id uuid,
  p_my_member_id uuid default null,
  p_include_admin boolean default false
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t public.club_tournaments;
  v_club jsonb;
  v_summary jsonb;
  v_players jsonb;
  v_teams jsonb;
  v_matches jsonb;
  v_standings jsonb;
  v_scorers jsonb := '[]'::jsonb;
  v_total_rounds integer := 1;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = p_club_id;

  if not found then
    return null;
  end if;

  select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name)
  into v_club
  from public.clubs c
  where c.id = p_club_id;

  v_summary := private.tournament_summary_json(p_tournament_id);

  select greatest(coalesce(max(m.round_number), 1), 1)::integer
  into v_total_rounds
  from public.club_tournament_matches m
  where m.tournament_id = p_tournament_id and m.club_id = p_club_id;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'member_id', mem.id,
      'full_name', mem.full_name,
      'nickname', prof.nickname,
      'photo_path', prof.photo_path
    ) order by tp.seed_order asc, lower(mem.full_name) asc, mem.id asc)
    from public.club_tournament_players tp
    join public.members mem on mem.club_id = tp.club_id and mem.id = tp.member_id
    left join public.profiles prof on prof.id = mem.user_id
    where tp.club_id = p_club_id and tp.tournament_id = p_tournament_id
  ), '[]'::jsonb)
  into v_players;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', tt.id,
      'seed', tt.seed,
      'name', tt.name,
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', mem.id,
          'full_name', mem.full_name,
          'nickname', prof.nickname,
          'photo_path', prof.photo_path
        ) order by slot_num)
        from (
          select tt.player_1_id as member_id, 1 as slot_num
          union all
          select tt.player_2_id as member_id, 2 as slot_num where tt.player_2_id is not null
        ) slots
        join public.members mem on mem.club_id = p_club_id and mem.id = slots.member_id
        left join public.profiles prof on prof.id = mem.user_id
      ), '[]'::jsonb)
    ) order by tt.seed asc)
    from public.club_tournament_teams tt
    where tt.club_id = p_club_id and tt.tournament_id = p_tournament_id
  ), '[]'::jsonb)
  into v_teams;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'tournament_id', m.tournament_id,
      'round_number', m.round_number,
      'match_order', m.match_order,
      'round_label', private.tournament_round_label(v_t.format, m.round_number, v_total_rounds, m.match_order),
      'court_id', m.court_id,
      'court_name', co.name,
      'team_a_id', m.team_a_id,
      'team_b_id', m.team_b_id,
      'team_a_name', ta.name,
      'team_b_name', tb.name,
      'team_a_seed', ta.seed,
      'team_b_seed', tb.seed,
      'team_a_players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', mem.id,
          'full_name', mem.full_name,
          'nickname', prof.nickname,
          'photo_path', prof.photo_path
        ) order by u.ord)
        from unnest(m.team_a_player_ids) with ordinality as u(member_id, ord)
        join public.members mem on mem.club_id = p_club_id and mem.id = u.member_id
        left join public.profiles prof on prof.id = mem.user_id
      ), '[]'::jsonb),
      'team_b_players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', mem.id,
          'full_name', mem.full_name,
          'nickname', prof.nickname,
          'photo_path', prof.photo_path
        ) order by u.ord)
        from unnest(m.team_b_player_ids) with ordinality as u(member_id, ord)
        join public.members mem on mem.club_id = p_club_id and mem.id = u.member_id
        left join public.profiles prof on prof.id = mem.user_id
      ), '[]'::jsonb),
      'status', m.status,
      'winner_side', m.winner_side,
      'score_a', m.score_a,
      'score_b', m.score_b,
      'next_match_id', m.next_match_id,
      'next_match_side', m.next_match_side,
      'club_match_id', m.club_match_id,
      'completed_at', m.completed_at,
      'created_at', m.created_at
    ) order by m.round_number asc, m.match_order asc)
    from public.club_tournament_matches m
    left join public.courts co on co.club_id = p_club_id and co.id = m.court_id
    left join public.club_tournament_teams ta on ta.id = m.team_a_id
    left join public.club_tournament_teams tb on tb.id = m.team_b_id
    where m.club_id = p_club_id
      and m.tournament_id = p_tournament_id
      and m.status <> 'voided'
  ), '[]'::jsonb)
  into v_matches;

  with tournament_games as (
    select
      u.member_id,
      (m.winner_side = u.side_label) as won,
      case
        when m.score_a is null or m.score_b is null then 0
        when u.side_label = 'a' then m.score_a - m.score_b
        else m.score_b - m.score_a
      end as diff,
      row_number() over (
        partition by u.member_id
        order by coalesce(m.completed_at, m.created_at) desc, m.match_order desc, m.id desc
      ) as rn
    from public.club_tournament_matches m
    cross join lateral (
      select unnest(m.team_a_player_ids) as member_id, 'a'::text as side_label
      union all
      select unnest(m.team_b_player_ids) as member_id, 'b'::text as side_label
    ) u
    where m.club_id = p_club_id
      and m.tournament_id = p_tournament_id
      and m.status = 'completed'
  ),
  latest_outcomes as (
    select member_id, won as first_won
    from tournament_games
    where rn = 1
  ),
  streak_breaks as (
    select tg.member_id, min(tg.rn) as break_rn
    from tournament_games tg
    join latest_outcomes lo on lo.member_id = tg.member_id
    where tg.won <> lo.first_won
    group by tg.member_id
  ),
  agg as (
    select
      tp.member_id,
      count(tg.member_id) filter (where tg.won)::integer as wins,
      count(tg.member_id) filter (where not tg.won)::integer as losses,
      count(tg.member_id)::integer as games_played,
      (count(tg.member_id) filter (where tg.won) * 3 + count(tg.member_id) filter (where not tg.won))::integer as points,
      coalesce(sum(tg.diff), 0)::integer as score_diff,
      case
        when lo.first_won is null then 0
        when lo.first_won then coalesce(sb.break_rn - 1, count(tg.member_id))::integer
        else -coalesce(sb.break_rn - 1, count(tg.member_id))::integer
      end as streak
    from public.club_tournament_players tp
    left join tournament_games tg on tg.member_id = tp.member_id
    left join latest_outcomes lo on lo.member_id = tp.member_id
    left join streak_breaks sb on sb.member_id = tp.member_id
    where tp.club_id = p_club_id and tp.tournament_id = p_tournament_id
    group by tp.member_id, lo.first_won, sb.break_rn
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
      case when a.games_played = 0 then 0 else round((a.wins::numeric * 100.0) / a.games_played)::integer end as win_pct,
      a.score_diff,
      a.streak
    from agg a
    join public.members mem on mem.club_id = p_club_id and mem.id = a.member_id
    left join public.profiles prof on prof.id = mem.user_id
  )
  select coalesce((
    select jsonb_agg(to_jsonb(r) order by r.rank)
    from ranked r
  ), '[]'::jsonb)
  into v_standings;

  if p_include_admin then
    select coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.user_id,
        'full_name', coalesce(p.full_name, 'Staff'),
        'email', coalesce(p.email, ''),
        'is_club_scorer', (cs.user_id is not null),
        'can_score', (cs.user_id is not null or ts.user_id is not null)
      ) order by lower(coalesce(p.full_name, '')), r.user_id)
      from public.club_staff_roles r
      left join public.profiles p on p.id = r.user_id
      left join public.club_leaderboard_scorers cs on cs.club_id = r.club_id and cs.user_id = r.user_id
      left join public.club_tournament_scorers ts
        on ts.club_id = r.club_id and ts.tournament_id = p_tournament_id and ts.user_id = r.user_id
      where r.club_id = p_club_id
        and r.role = 'staff'::public.user_role
        and r.is_active
    ), '[]'::jsonb)
    into v_scorers;
  end if;

  return jsonb_build_object(
    'club', v_club,
    'tournament', v_summary,
    'players', v_players,
    'teams', v_teams,
    'matches', v_matches,
    'standings', v_standings,
    'scorers', v_scorers,
    'my_member_id', p_my_member_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public and club-member reads
-- ---------------------------------------------------------------------------

create or replace function public.list_public_club_tournaments(
  p_slug text,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
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
    select jsonb_agg(private.tournament_summary_json(t.id) order by
      case t.status when 'live' then 0 when 'setup' then 1 when 'completed' then 2 else 3 end,
      t.created_at desc,
      t.id desc
    )
    from (
      select t.id, t.status, t.created_at
      from public.club_tournaments t
      where t.club_id = v_club_id
        and t.status <> 'cancelled'
      order by
        case t.status when 'live' then 0 when 'setup' then 1 when 'completed' then 2 else 3 end,
        t.created_at desc,
        t.id desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_public_tournament(
  p_slug text,
  p_tournament_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club_id uuid;
  v_payload jsonb;
begin
  select c.id into v_club_id
  from public.clubs c
  join public.club_accounts a on a.club_id = c.id
  where c.slug = lower(btrim(coalesce(p_slug, '')))
    and c.is_active
    and a.status = 'active';
  if v_club_id is null or p_tournament_id is null then
    return null;
  end if;

  v_payload := private.tournament_detail_payload(v_club_id, p_tournament_id, null, false);
  if v_payload is null or (v_payload -> 'tournament' ->> 'status') = 'cancelled' then
    return null;
  end if;
  return v_payload || jsonb_build_object('can_score', false, 'can_manage', false);
end;
$$;

create or replace function public.list_club_tournaments(
  p_limit integer default 50
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_role public.user_role;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null or v_club is null then
    raise exception 'Sign in to view club tournaments' using errcode = '42501';
  end if;
  v_role := private.current_club_role(v_club);
  if v_role is null then
    raise exception 'You do not belong to this club' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(private.tournament_summary_json(t.id) order by
      case t.status when 'live' then 0 when 'setup' then 1 when 'completed' then 2 else 3 end,
      t.created_at desc,
      t.id desc
    )
    from (
      select t.id, t.status, t.created_at
      from public.club_tournaments t
      where t.club_id = v_club
        and (v_role = 'admin'::public.user_role or t.status <> 'cancelled')
      order by
        case t.status when 'live' then 0 when 'setup' then 1 when 'completed' then 2 else 3 end,
        t.created_at desc,
        t.id desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_club_tournament(
  p_tournament_id uuid
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
    raise exception 'Sign in to view tournament details' using errcode = '42501';
  end if;
  v_role := private.current_club_role(v_club);
  if v_role is null then
    raise exception 'You do not belong to this club' using errcode = '42501';
  end if;
  if p_tournament_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select mem.id into v_member_id
  from public.members mem
  where mem.club_id = v_club and mem.user_id = auth.uid()
  limit 1;

  v_payload := private.tournament_detail_payload(
    v_club,
    p_tournament_id,
    v_member_id,
    v_role = 'admin'::public.user_role
  );
  if v_payload is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return v_payload || jsonb_build_object(
    'can_score', private.can_score_tournament(v_club, p_tournament_id),
    'can_manage', (v_role = 'admin'::public.user_role)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin tournament lifecycle & setup
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_tournament(
  p_title text,
  p_format text,
  p_team_size integer,
  p_venue_id uuid default null,
  p_counts_for_leaderboard boolean default true,
  p_scheduled_at timestamptz default null,
  p_notes text default null,
  p_player_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_title text := private.tidy_name(p_title);
  v_format text := lower(btrim(coalesce(p_format, '')));
  v_notes text := nullif(private.tidy_name(p_notes), '');
  v_players uuid[] := coalesce(p_player_ids, '{}'::uuid[]);
  v_distinct_players integer := 0;
  v_member_count integer := 0;
  v_tournament_id uuid;
begin
  if v_title = '' or char_length(v_title) > 120 then
    raise exception 'Enter a tournament title (up to 120 characters)' using errcode = '22023';
  end if;
  if v_format not in ('single_elimination', 'random_queue') then
    raise exception 'Choose bracket or random queue format' using errcode = '22023';
  end if;
  if p_team_size not in (1, 2) then
    raise exception 'Choose singles or doubles' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 240 then
    raise exception 'Notes are limited to 240 characters' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.club_id = v_club
  ) then
    raise exception 'Venue not found in this club' using errcode = 'P0002';
  end if;

  if array_length(v_players, 1) is not null then
    select count(distinct x)::integer into v_distinct_players
    from unnest(v_players) as t(x)
    where x is not null;
    if v_distinct_players <> array_length(v_players, 1) then
      raise exception 'Each player can only be added once' using errcode = '22023';
    end if;
    select count(*)::integer into v_member_count
    from public.members m
    where m.club_id = v_club and m.id = any(v_players);
    if v_member_count <> v_distinct_players then
      raise exception 'Every player must belong to this club' using errcode = '22023';
    end if;
  end if;

  insert into public.club_tournaments (
    club_id, venue_id, title, format, team_size, counts_for_leaderboard,
    scheduled_at, notes, created_by
  )
  values (
    v_club, p_venue_id, v_title, v_format, p_team_size::smallint,
    coalesce(p_counts_for_leaderboard, true), p_scheduled_at, v_notes, auth.uid()
  )
  returning id into v_tournament_id;

  if v_distinct_players > 0 then
    insert into public.club_tournament_players (club_id, tournament_id, member_id, seed_order)
    select v_club, v_tournament_id, u.member_id, u.ord::integer
    from unnest(v_players) with ordinality as u(member_id, ord);
  end if;

  return public.get_club_tournament(v_tournament_id);
end;
$$;

create or replace function public.admin_set_tournament_players(
  p_tournament_id uuid,
  p_player_ids uuid[]
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_t public.club_tournaments;
  v_players uuid[] := coalesce(p_player_ids, '{}'::uuid[]);
  v_distinct_players integer := 0;
  v_member_count integer := 0;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.status in ('completed', 'cancelled') then
    raise exception 'Finished or cancelled tournaments cannot be edited' using errcode = '22023';
  end if;
  if v_t.status = 'live' and v_t.format <> 'random_queue' then
    raise exception 'Bracket rosters cannot change after the tournament starts' using errcode = '22023';
  end if;

  if array_length(v_players, 1) is not null then
    select count(distinct x)::integer into v_distinct_players
    from unnest(v_players) as t(x)
    where x is not null;
    if v_distinct_players <> array_length(v_players, 1) then
      raise exception 'Each player can only be added once' using errcode = '22023';
    end if;
    select count(*)::integer into v_member_count
    from public.members m
    where m.club_id = v_club and m.id = any(v_players);
    if v_member_count <> v_distinct_players then
      raise exception 'Every player must belong to this club' using errcode = '22023';
    end if;
  end if;

  if v_t.status = 'live' then
    -- Queue mixer allows adding late players, never removing existing ones.
    if exists (
      select 1 from public.club_tournament_players tp
      where tp.club_id = v_club
        and tp.tournament_id = p_tournament_id
        and not (tp.member_id = any(v_players))
    ) then
      raise exception 'Players cannot be removed after the tournament starts' using errcode = '22023';
    end if;
    insert into public.club_tournament_players (club_id, tournament_id, member_id, seed_order)
    select v_club, p_tournament_id, u.member_id,
      coalesce((select max(seed_order) from public.club_tournament_players where tournament_id = p_tournament_id), 0) + u.ord::integer
    from unnest(v_players) with ordinality as u(member_id, ord)
    on conflict (tournament_id, member_id) do nothing;
  else
    delete from public.club_tournament_matches
    where club_id = v_club and tournament_id = p_tournament_id;

    delete from public.club_tournament_teams
    where club_id = v_club and tournament_id = p_tournament_id;

    delete from public.club_tournament_players
    where club_id = v_club and tournament_id = p_tournament_id;

    if v_distinct_players > 0 then
      insert into public.club_tournament_players (club_id, tournament_id, member_id, seed_order)
      select v_club, p_tournament_id, u.member_id, u.ord::integer
      from unnest(v_players) with ordinality as u(member_id, ord);
    end if;
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.admin_generate_tournament_draw(
  p_tournament_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  perform private.build_tournament_bracket_draw(v_club, p_tournament_id);
  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.admin_start_tournament(
  p_tournament_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_t public.club_tournaments;
  v_player_count integer;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.status <> 'setup' then
    raise exception 'Tournament has already started or ended' using errcode = '22023';
  end if;

  select count(*)::integer into v_player_count
  from public.club_tournament_players tp
  where tp.club_id = v_club and tp.tournament_id = p_tournament_id;

  if v_t.format = 'single_elimination' then
    if not exists (
      select 1 from public.club_tournament_teams tt
      where tt.club_id = v_club and tt.tournament_id = p_tournament_id
    ) then
      perform private.build_tournament_bracket_draw(v_club, p_tournament_id);
    end if;
    update public.club_tournaments
    set status = 'live', started_at = clock_timestamp()
    where id = p_tournament_id and club_id = v_club;
  else
    if v_player_count < (v_t.team_size * 2) then
      raise exception 'Add at least % players to start this queue mixer', (v_t.team_size * 2) using errcode = '22023';
    end if;
    update public.club_tournaments
    set status = 'live', started_at = clock_timestamp()
    where id = p_tournament_id and club_id = v_club;
    perform private.draw_next_tournament_queue_match(v_club, p_tournament_id, null);
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.admin_set_tournament_scorer(
  p_tournament_id uuid,
  p_user_id uuid,
  p_can_score boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
begin
  if not exists (
    select 1 from public.club_tournaments t
    where t.id = p_tournament_id and t.club_id = v_club
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

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
    insert into public.club_tournament_scorers (club_id, tournament_id, user_id, granted_by)
    values (v_club, p_tournament_id, p_user_id, auth.uid())
    on conflict (tournament_id, user_id) do nothing;
  else
    delete from public.club_tournament_scorers ts
    where ts.club_id = v_club and ts.tournament_id = p_tournament_id and ts.user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.admin_complete_tournament(
  p_tournament_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_t public.club_tournaments;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.status <> 'live' then
    raise exception 'Only live tournaments can be marked finished' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.club_tournament_matches m
    where m.club_id = v_club and m.tournament_id = p_tournament_id and m.status in ('ready', 'playing')
  ) then
    raise exception 'Finish or cancel active court matches before ending the tournament' using errcode = '22023';
  end if;

  update public.club_tournaments
  set status = 'completed', completed_at = clock_timestamp()
  where id = p_tournament_id and club_id = v_club;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.admin_cancel_tournament(
  p_tournament_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_club_admin();
  v_t public.club_tournaments;
begin
  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.status in ('completed', 'cancelled') then
    raise exception 'Tournament has already ended' using errcode = '22023';
  end if;

  update public.club_tournaments
  set status = 'cancelled', completed_at = clock_timestamp()
  where id = p_tournament_id and club_id = v_club;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Courtside designated scorer and admin match operations
-- ---------------------------------------------------------------------------

create or replace function public.staff_draw_tournament_queue_match(
  p_tournament_id uuid,
  p_court_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_tournament_scorer(p_tournament_id);
begin
  perform private.draw_next_tournament_queue_match(v_club, p_tournament_id, p_court_id);
  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.staff_assign_tournament_match_court(
  p_tournament_id uuid,
  p_match_id uuid,
  p_court_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_tournament_scorer(p_tournament_id);
  v_t_venue uuid;
  v_court_venue uuid;
begin
  select t.venue_id into v_t_venue
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club;

  if p_court_id is not null then
    select co.venue_id into v_court_venue
    from public.courts co
    where co.id = p_court_id and co.club_id = v_club;
    if not found then
      raise exception 'Court not found in this club' using errcode = 'P0002';
    end if;
    if v_t_venue is not null and v_court_venue <> v_t_venue then
      raise exception 'Court belongs to another venue' using errcode = '22023';
    end if;
  end if;

  update public.club_tournament_matches m
  set court_id = p_court_id
  where m.id = p_match_id
    and m.tournament_id = p_tournament_id
    and m.club_id = v_club
    and m.status in ('pending', 'ready', 'playing');

  if not found then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.staff_cancel_tournament_queue_match(
  p_tournament_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_tournament_scorer(p_tournament_id);
  v_format text;
begin
  select t.format into v_format
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club;

  if v_format <> 'random_queue' then
    raise exception 'Only queued mixer matches can be cancelled' using errcode = '22023';
  end if;

  update public.club_tournament_matches m
  set status = 'voided'
  where m.id = p_match_id
    and m.tournament_id = p_tournament_id
    and m.club_id = v_club
    and m.status in ('ready', 'playing');

  if not found then
    raise exception 'Active queue match not found' using errcode = 'P0002';
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

create or replace function public.staff_score_tournament_match(
  p_tournament_id uuid,
  p_match_id uuid,
  p_winner_side text,
  p_score_a integer default null,
  p_score_b integer default null,
  p_court_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.require_tournament_scorer(p_tournament_id);
  v_winner text := lower(btrim(coalesce(p_winner_side, '')));
  v_t public.club_tournaments;
  v_m public.club_tournament_matches;
  v_total_rounds integer := 1;
  v_court_id uuid;
  v_court_venue_id uuid;
  v_club_match_id uuid := null;
  v_notes text;
  v_win_team_id uuid;
  v_win_players uuid[];
begin
  if v_winner not in ('a', 'b') then
    raise exception 'Choose which team won' using errcode = '22023';
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

  select * into v_t
  from public.club_tournaments t
  where t.id = p_tournament_id and t.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if v_t.status <> 'live' then
    raise exception 'Start the tournament before scoring matches' using errcode = '22023';
  end if;

  select * into v_m
  from public.club_tournament_matches m
  where m.id = p_match_id and m.tournament_id = p_tournament_id and m.club_id = v_club
  for update;

  if not found then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;
  if v_m.status not in ('ready', 'playing') then
    raise exception 'This match is not ready to be scored' using errcode = '22023';
  end if;
  if coalesce(array_length(v_m.team_a_player_ids, 1), 0) <> v_t.team_size
     or coalesce(array_length(v_m.team_b_player_ids, 1), 0) <> v_t.team_size then
    raise exception 'Both teams must be set before scoring' using errcode = '22023';
  end if;

  v_court_id := coalesce(p_court_id, v_m.court_id);
  if v_court_id is not null then
    select co.venue_id into v_court_venue_id
    from public.courts co
    where co.id = v_court_id and co.club_id = v_club;
    if not found then
      raise exception 'Court not found in this club' using errcode = 'P0002';
    end if;
    if v_t.venue_id is not null and v_court_venue_id <> v_t.venue_id then
      raise exception 'Court belongs to another venue' using errcode = '22023';
    end if;
  end if;

  select greatest(coalesce(max(m.round_number), 1), 1)::integer
  into v_total_rounds
  from public.club_tournament_matches m
  where m.tournament_id = p_tournament_id and m.club_id = v_club;

  if v_t.counts_for_leaderboard then
    v_notes := left(
      v_t.title || ' · ' || private.tournament_round_label(v_t.format, v_m.round_number, v_total_rounds, v_m.match_order),
      200
    );

    insert into public.club_matches (
      club_id, venue_id, court_id, tournament_id, format, winner_side, score_a, score_b, notes, recorded_by
    )
    values (
      v_club,
      coalesce(v_court_venue_id, v_t.venue_id),
      v_court_id,
      p_tournament_id,
      case when v_t.team_size = 1 then 'singles' else 'doubles' end,
      v_winner,
      p_score_a,
      p_score_b,
      v_notes,
      auth.uid()
    )
    returning id into v_club_match_id;

    insert into public.club_match_players (match_id, club_id, member_id, side, slot)
    select v_club_match_id, v_club, u.member_id, 'a', u.ord::smallint
    from unnest(v_m.team_a_player_ids) with ordinality as u(member_id, ord)
    union all
    select v_club_match_id, v_club, u.member_id, 'b', u.ord::smallint
    from unnest(v_m.team_b_player_ids) with ordinality as u(member_id, ord);
  end if;

  update public.club_tournament_matches
  set status = 'completed',
      winner_side = v_winner,
      score_a = p_score_a,
      score_b = p_score_b,
      court_id = v_court_id,
      club_match_id = v_club_match_id,
      recorded_by = auth.uid(),
      completed_at = clock_timestamp()
  where id = p_match_id and club_id = v_club;

  if v_t.format = 'single_elimination' then
    if v_winner = 'a' then
      v_win_team_id := v_m.team_a_id;
      v_win_players := v_m.team_a_player_ids;
    else
      v_win_team_id := v_m.team_b_id;
      v_win_players := v_m.team_b_player_ids;
    end if;

    if v_m.next_match_id is not null then
      if v_m.next_match_side = 'a' then
        update public.club_tournament_matches
        set team_a_id = v_win_team_id,
            team_a_player_ids = v_win_players,
            status = case when team_b_id is not null then 'ready' else status end
        where id = v_m.next_match_id and club_id = v_club;
      else
        update public.club_tournament_matches
        set team_b_id = v_win_team_id,
            team_b_player_ids = v_win_players,
            status = case when team_a_id is not null then 'ready' else status end
        where id = v_m.next_match_id and club_id = v_club;
      end if;
    else
      update public.club_tournaments
      set status = 'completed', completed_at = clock_timestamp()
      where id = p_tournament_id and club_id = v_club;
    end if;
  end if;

  return public.get_club_tournament(p_tournament_id);
end;
$$;

-- Synchronize Phase 1 voiding with tournament bracket/queue state and per-tournament scorers.
create or replace function public.staff_void_club_match(
  p_match_id uuid,
  p_reason text default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := private.current_club_id();
  v_reason text := nullif(private.tidy_name(p_reason), '');
  v_match public.club_matches;
  v_tm public.club_tournament_matches;
  v_t_format text;
  v_next_status text;
begin
  if auth.uid() is null or v_club is null then
    raise exception 'Only club admins and designated scorers can record match results' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'Reason is limited to 200 characters' using errcode = '22023';
  end if;

  select * into v_match
  from public.club_matches m
  where m.id = p_match_id
    and m.club_id = v_club
    and m.status = 'completed'
  for update;

  if not found then
    if private.can_score_club_matches(v_club) is not true
       and not exists (
         select 1 from public.club_tournament_scorers ts
         where ts.club_id = v_club and ts.user_id = auth.uid()
       ) then
      raise exception 'Only club admins and designated scorers can record match results' using errcode = '42501';
    end if;
    raise exception 'Match not found or already voided' using errcode = 'P0002';
  end if;

  if v_match.tournament_id is not null then
    if private.can_score_tournament(v_club, v_match.tournament_id) is not true then
      raise exception 'Only club admins and designated scorers can record match results' using errcode = '42501';
    end if;
  elsif private.can_score_club_matches(v_club) is not true then
    raise exception 'Only club admins and designated scorers can record match results' using errcode = '42501';
  end if;

  select * into v_tm
  from public.club_tournament_matches tm
  where tm.club_match_id = p_match_id and tm.club_id = v_club
  for update;

  if found then
    select t.format into v_t_format
    from public.club_tournaments t
    where t.id = v_tm.tournament_id and t.club_id = v_club;

    if v_t_format = 'single_elimination' then
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
  end if;

  update public.club_matches
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = clock_timestamp(),
      void_reason = v_reason
  where id = p_match_id and club_id = v_club;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

alter function private.club_match_json(uuid) owner to postgres;
alter function private.can_score_tournament(uuid, uuid) owner to postgres;
alter function private.require_tournament_scorer(uuid) owner to postgres;
alter function private.tournament_round_label(text, integer, integer, integer) owner to postgres;
alter function private.build_tournament_bracket_draw(uuid, uuid) owner to postgres;
alter function private.draw_next_tournament_queue_match(uuid, uuid, uuid) owner to postgres;
alter function private.tournament_summary_json(uuid) owner to postgres;
alter function private.tournament_detail_payload(uuid, uuid, uuid, boolean) owner to postgres;

alter function public.list_public_club_tournaments(text, integer) owner to postgres;
alter function public.get_public_tournament(text, uuid) owner to postgres;
alter function public.list_club_tournaments(integer) owner to postgres;
alter function public.get_club_tournament(uuid) owner to postgres;
alter function public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[]) owner to postgres;
alter function public.admin_set_tournament_players(uuid, uuid[]) owner to postgres;
alter function public.admin_generate_tournament_draw(uuid) owner to postgres;
alter function public.admin_start_tournament(uuid) owner to postgres;
alter function public.admin_set_tournament_scorer(uuid, uuid, boolean) owner to postgres;
alter function public.admin_complete_tournament(uuid) owner to postgres;
alter function public.admin_cancel_tournament(uuid) owner to postgres;
alter function public.staff_draw_tournament_queue_match(uuid, uuid) owner to postgres;
alter function public.staff_assign_tournament_match_court(uuid, uuid, uuid) owner to postgres;
alter function public.staff_cancel_tournament_queue_match(uuid, uuid) owner to postgres;
alter function public.staff_score_tournament_match(uuid, uuid, text, integer, integer, uuid) owner to postgres;
alter function public.staff_void_club_match(uuid, text) owner to postgres;

revoke all on function private.can_score_tournament(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_tournament_scorer(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_round_label(text, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.build_tournament_bracket_draw(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.draw_next_tournament_queue_match(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_summary_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_detail_payload(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;

revoke all on function public.list_public_club_tournaments(text, integer) from public;
grant execute on function public.list_public_club_tournaments(text, integer) to anon, authenticated;

revoke all on function public.get_public_tournament(text, uuid) from public;
grant execute on function public.get_public_tournament(text, uuid) to anon, authenticated;

revoke all on function public.list_club_tournaments(integer) from public, anon;
grant execute on function public.list_club_tournaments(integer) to authenticated;

revoke all on function public.get_club_tournament(uuid) from public, anon;
grant execute on function public.get_club_tournament(uuid) to authenticated;

revoke all on function public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[]) from public, anon;
grant execute on function public.admin_create_tournament(text, text, integer, uuid, boolean, timestamptz, text, uuid[]) to authenticated;

revoke all on function public.admin_set_tournament_players(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_tournament_players(uuid, uuid[]) to authenticated;

revoke all on function public.admin_generate_tournament_draw(uuid) from public, anon;
grant execute on function public.admin_generate_tournament_draw(uuid) to authenticated;

revoke all on function public.admin_start_tournament(uuid) from public, anon;
grant execute on function public.admin_start_tournament(uuid) to authenticated;

revoke all on function public.admin_set_tournament_scorer(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_set_tournament_scorer(uuid, uuid, boolean) to authenticated;

revoke all on function public.admin_complete_tournament(uuid) from public, anon;
grant execute on function public.admin_complete_tournament(uuid) to authenticated;

revoke all on function public.admin_cancel_tournament(uuid) from public, anon;
grant execute on function public.admin_cancel_tournament(uuid) to authenticated;

revoke all on function public.staff_draw_tournament_queue_match(uuid, uuid) from public, anon;
grant execute on function public.staff_draw_tournament_queue_match(uuid, uuid) to authenticated;

revoke all on function public.staff_assign_tournament_match_court(uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_assign_tournament_match_court(uuid, uuid, uuid) to authenticated;

revoke all on function public.staff_cancel_tournament_queue_match(uuid, uuid) from public, anon;
grant execute on function public.staff_cancel_tournament_queue_match(uuid, uuid) to authenticated;

revoke all on function public.staff_score_tournament_match(uuid, uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.staff_score_tournament_match(uuid, uuid, text, integer, integer, uuid) to authenticated;

comment on table public.club_tournaments is
  'Club single-elimination brackets and random queue mixers feeding derived leaderboard matches.';
comment on table public.club_tournament_scorers is
  'Per-tournament staff scorer assignments granted by a club admin.';
comment on table public.club_tournament_players is
  'Participating club members registered in a tournament.';
comment on table public.club_tournament_teams is
  'Seeded or randomized pairs/players for single-elimination brackets.';
comment on table public.club_tournament_matches is
  'Bracket nodes or random queue matches linking courts, teams/players, and recorded club_matches.';
