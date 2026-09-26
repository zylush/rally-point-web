-- Read-only, fixture-aware staging checks before any privacy repair.
-- Every issue_count must be zero. No row contents or identities are returned.
with checks as (
  select 'missing_club_or_venue_owner'::text as check_name,
    (select count(*) from public.members where club_id is null)
    + (select count(*) from public.courts where club_id is null or venue_id is null)
    + (select count(*) from public.court_sessions where club_id is null or venue_id is null)
    + (select count(*) from public.bookings where club_id is null or venue_id is null)
    + (select count(*) from public.open_plays where club_id is null or venue_id is null)
    + (select count(*) from public.open_play_signups where club_id is null or venue_id is null)
    + (select count(*) from public.checkins where club_id is null or venue_id is null)
    + (select count(*) from public.walkins where club_id is null or venue_id is null)
    + (select count(*) from public.transactions where club_id is null)
    + (select count(*) from public.notifications where club_id is null)
    + (select count(*) from public.reminders where club_id is null) as issue_count

  union all select 'member_club_missing', count(*) from public.members m
    left join public.clubs club on club.id = m.club_id
    where club.id is null

  union all select 'court_venue_mismatch', count(*) from public.courts c
    left join public.venues v on v.id = c.venue_id and v.club_id = c.club_id
    where v.id is null

  union all select 'session_relationship_mismatch', count(*) from public.court_sessions s
    left join public.courts c on c.id = s.court_id
    left join public.members m on m.id = s.member_id
    left join public.bookings b on b.id = s.booking_id
    where c.id is null
      or (s.club_id, s.venue_id) is distinct from (c.club_id, c.venue_id)
      or (s.member_id is not null and (m.id is null or m.club_id is distinct from s.club_id))
      or (s.booking_id is not null and (b.id is null or (b.club_id, b.venue_id) is distinct from (s.club_id, s.venue_id)))

  union all select 'booking_relationship_mismatch', count(*) from public.bookings b
    left join public.courts c on c.id = b.court_id
    left join public.members m on m.id = b.member_id
    left join public.court_sessions s on s.id = b.session_id
    where c.id is null
      or (b.club_id, b.venue_id) is distinct from (c.club_id, c.venue_id)
      or (b.member_id is not null and (m.id is null or m.club_id is distinct from b.club_id))
      or (b.session_id is not null and (s.id is null or (s.club_id, s.venue_id) is distinct from (b.club_id, b.venue_id)))

  union all select 'open_play_relationship_mismatch', count(*) from public.open_plays o
    left join public.venues v on v.id = o.venue_id and v.club_id = o.club_id
    left join public.courts c on c.id = o.court_id
    where v.id is null
      or (o.court_id is not null and (c.id is null or (c.club_id, c.venue_id) is distinct from (o.club_id, o.venue_id)))

  union all select 'signup_relationship_mismatch', count(*) from public.open_play_signups s
    left join public.open_plays o on o.id = s.open_play_id
    left join public.members m on m.id = s.member_id
    where o.id is null or m.id is null
      or (s.club_id, s.venue_id) is distinct from (o.club_id, o.venue_id)
      or m.club_id is distinct from s.club_id

  union all select 'checkin_relationship_mismatch', count(*) from public.checkins c
    left join public.members m on m.id = c.member_id
    left join public.venues v on v.id = c.venue_id and v.club_id = c.club_id
    where m.id is null or v.id is null or m.club_id is distinct from c.club_id

  union all select 'walkin_venue_mismatch', count(*) from public.walkins w
    left join public.venues v on v.id = w.venue_id and v.club_id = w.club_id
    where v.id is null

  union all select 'transaction_relationship_mismatch', count(*) from public.transactions t
    left join public.members m on m.id = t.member_id
    left join public.venues v on v.id = t.venue_id and v.club_id = t.club_id
    where (t.member_id is not null and (m.id is null or m.club_id is distinct from t.club_id))
      or (t.venue_id is not null and v.id is null)

  union all select 'notification_relationship_mismatch', count(*) from public.notifications n
    left join public.profiles p on p.id = n.user_id
    left join public.venues v on v.id = n.venue_id and v.club_id = n.club_id
    where p.id is null
      or (n.venue_id is not null and v.id is null)

  union all select 'reminder_relationship_mismatch', count(*) from public.reminders r
    left join public.venues v on v.id = r.venue_id and v.club_id = r.club_id
    left join public.bookings b on b.id = r.booking_id
    left join public.open_plays o on o.id = r.open_play_id
    where (r.venue_id is not null and v.id is null)
      or (r.booking_id is not null and (b.id is null or b.club_id is distinct from r.club_id))
      or (r.open_play_id is not null and (o.id is null or o.club_id is distinct from r.club_id))

  union all select 'staff_grant_relationship_mismatch', count(*) from public.staff_venue_grants g
    left join public.venues v on v.id = g.venue_id and v.club_id = g.club_id
    left join public.club_staff_roles sr on sr.club_id = g.club_id and sr.user_id = g.user_id
    where v.id is null or sr.user_id is null

  union all select 'allocation_relationship_mismatch', count(*) from public.court_allocations a
    left join public.venues v on v.id = a.venue_id and v.club_id = a.club_id
    left join public.courts c on c.id = a.court_id
    left join public.bookings b on a.source = 'booking' and b.id = a.source_id
    left join public.court_sessions s on a.source = 'session' and s.id = a.source_id
    left join public.open_plays o on a.source = 'open_play' and o.id = a.source_id
    where v.id is null or c.id is null
      or (c.club_id, c.venue_id) is distinct from (a.club_id, a.venue_id)
      or (a.source = 'booking' and (b.id is null or (b.club_id, b.venue_id, b.court_id) is distinct from (a.club_id, a.venue_id, a.court_id)
        or a.interval is distinct from tstzrange(b.start_at, b.end_at, '[)')))
      or (a.source = 'session' and (s.id is null or (s.club_id, s.venue_id, s.court_id) is distinct from (a.club_id, a.venue_id, a.court_id)
        or a.interval is distinct from tstzrange(s.start_at, s.end_at, '[)')))
      or (a.source = 'open_play' and (o.id is null or (o.club_id, o.venue_id, o.court_id) is distinct from (a.club_id, a.venue_id, a.court_id)
        or a.interval is distinct from tstzrange(o.start_at, o.end_at, '[)')))

  union all select 'active_allocation_overlap', count(*) from public.court_allocations a
    join public.court_allocations b on a.id < b.id and a.club_id = b.club_id and a.court_id = b.court_id
      and a.interval && b.interval
    where a.status in ('held', 'reserved', 'playing')
      and b.status in ('held', 'reserved', 'playing')

  union all select 'financial_entry_not_unverified', count(*) from public.transactions
    where verification_status is distinct from 'unverified'
)
select check_name, issue_count from checks order by check_name;
