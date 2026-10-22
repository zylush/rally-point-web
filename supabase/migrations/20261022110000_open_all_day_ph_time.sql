-- Courts can be booked 24 hours a day, and every club keeps Philippine time.
--
-- Hours: every venue opens 0:00 to 24:00, and new venues default to that. The
-- booking functions already accept any start hour as long as the booking ends
-- by midnight, so they need no change.
--
-- Timezone: every club is in the Philippines. Booking functions already turn a
-- date and hour into a timestamp with the venue's timezone, and the app now
-- shows and books times in Asia/Manila whatever the phone's own timezone. To
-- keep the two in step, venues and clubs are held to Asia/Manila. Supporting
-- another timezone later means dropping these checks and teaching the app
-- per-venue time, not just changing data.

do $$
begin
  if exists (select 1 from public.venues where timezone <> 'Asia/Manila')
     or exists (select 1 from public.clubs where default_timezone <> 'Asia/Manila') then
    raise exception 'A venue or club uses a timezone other than Asia/Manila. Review it before applying this migration.';
  end if;
end;
$$;

update public.venues set open_hour = 0, close_hour = 24
where open_hour <> 0 or close_hour <> 24;
alter table public.venues alter column open_hour set default 0;
alter table public.venues alter column close_hour set default 24;

alter table public.venues add constraint venues_timezone_ph_check check (timezone = 'Asia/Manila');
alter table public.clubs add constraint clubs_timezone_ph_check check (default_timezone = 'Asia/Manila');

comment on column public.venues.timezone is
  'Always Asia/Manila (Philippine time); the app and booking functions both rely on it.';
