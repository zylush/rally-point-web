-- Forward privacy repair. Previously applied migrations remain immutable.
-- Requires tenant expansion/backfill and rls_member_lookup_repair.
-- Does not enforce NOT NULL/FKs/exclusion or revoke legacy write grants.
-- Read visibility tightens immediately; deploy the safe-read adapter in the
-- coordinated rollout window. Legacy member availability reads are insufficient.
-- Discovery permission is not permission to read private operational rows.
-- Restrictive SELECT fences also constrain legacy permissive/ALL policies.
-- Keep this block aligned with the forward member_privacy_repair migration.

drop policy if exists private_read_scope on public.court_sessions;
create policy private_read_scope on public.court_sessions
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.bookings;
create policy private_read_scope on public.bookings
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.open_play_signups;
create policy private_read_scope on public.open_play_signups
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.checkins;
create policy private_read_scope on public.checkins
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.transactions;
create policy private_read_scope on public.transactions
  as restrictive for select to authenticated
  using (private.is_member_owner(club_id, member_id)
    or private.can_operate_venue(club_id, venue_id)
    or (venue_id is null and club_id = private.current_club_id()
        and private.current_club_role(club_id) = 'admin'));

drop policy if exists private_read_scope on public.walkins;
create policy private_read_scope on public.walkins
  as restrictive for select to authenticated
  using (private.can_operate_venue(club_id, venue_id));

drop policy if exists private_read_scope on public.court_allocations;
create policy private_read_scope on public.court_allocations
  as restrictive for select to authenticated
  using (private.can_operate_venue(club_id, venue_id));

-- Deliberately owner-executed aggregate: signup RLS exposes only own rows to
-- members. Return counts, never identities, with explicit fixed-club/venue checks.
create view public.open_play_seat_counts with (security_barrier = true) as
select o.club_id, o.venue_id, o.id as open_play_id,
       (select count(*)::integer from public.open_play_signups s
        where s.club_id = o.club_id and s.venue_id = o.venue_id
          and s.open_play_id = o.id and s.status = 'joined') as seats_taken
from public.open_plays o
where o.club_id = private.current_club_id()
  and private.can_access_venue(o.club_id, o.venue_id);
alter view public.open_play_seat_counts owner to postgres;
revoke all on public.open_play_seat_counts from public, anon, authenticated;
grant select on public.open_play_seat_counts to authenticated;
