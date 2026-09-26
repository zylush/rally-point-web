-- RLS policies for operational tables must not depend on direct SELECT access
-- to public.members. Enforcement intentionally exposes membership through
-- limited views only, so the old inline EXISTS expressions could raise 42501
-- before an otherwise-valid staff/admin branch was evaluated.

create or replace function private.is_member_owner(p_club_id uuid, p_member_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_club_id = private.current_club_id()
    and exists (
      select 1 from public.members m
      where m.club_id = p_club_id
        and m.id = p_member_id
        and m.user_id = auth.uid()
    );
$$;

alter function private.is_member_owner(uuid, uuid) owner to postgres;
revoke all on function private.is_member_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_member_owner(uuid, uuid) to authenticated;

drop policy if exists sessions_access_select on public.court_sessions;
create policy sessions_access_select on public.court_sessions
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

drop policy if exists bookings_access_select on public.bookings;
create policy bookings_access_select on public.bookings
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

drop policy if exists open_play_signups_access_select on public.open_play_signups;
create policy open_play_signups_access_select on public.open_play_signups
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

drop policy if exists checkins_access_select on public.checkins;
create policy checkins_access_select on public.checkins
  for select to authenticated
  using (
    private.can_access_venue(club_id, venue_id)
    or private.is_member_owner(club_id, member_id)
  );

drop policy if exists transactions_access_select on public.transactions;
create policy transactions_access_select on public.transactions
  for select to authenticated
  using (
    private.is_member_owner(club_id, member_id)
    or (venue_id is not null and private.can_access_venue(club_id, venue_id))
    or (venue_id is null and private.current_club_role(club_id) = 'admin')
  );
