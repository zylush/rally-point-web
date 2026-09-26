-- Local-only seed for tenant boundary and venue-assignment checks.
-- Auth users/profiles are deliberately not fabricated here because profiles
-- reference auth.users. Database tests create their own trusted identities.

insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gensan-lagao', 'Rally Point Lagao', 'Asia/Manila', 6, 22, true)
on conflict (id) do nothing;

insert into public.courts (id, club_id, venue_id, name, status, hourly_rate)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court A', 'available', 500),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', 'Lagao Court B', 'available', 500)
on conflict (id) do nothing;

insert into public.clubs (id, slug, name, default_timezone, is_active)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'synthetic-second-club', 'Synthetic Second Club', 'Asia/Manila', true)
on conflict (id) do nothing;

insert into public.venues (id, club_id, slug, name, timezone, open_hour, close_hour, is_active)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'synthetic-main', 'Synthetic Main', 'Asia/Manila', 6, 22, true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'synthetic-east', 'Synthetic East', 'Asia/Manila', 6, 22, true)
on conflict (id) do nothing;

insert into public.courts (id, club_id, venue_id, name, status, hourly_rate)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'Synthetic Court A', 'available', 400)
on conflict (id) do nothing;
