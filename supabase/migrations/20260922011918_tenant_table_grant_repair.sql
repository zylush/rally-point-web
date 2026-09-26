-- Forward repair for inherited grants on the five new tenant tables only.
-- Legacy tables, views, RPCs, policies, and default privileges are unchanged.
-- Safe at the backfill boundary: this is NOT the enforcement cutover.
-- Roll back deployment by reverting the app, not by restoring unsafe grants.
-- If access needs adjustment, use another reviewed forward migration.

revoke all privileges on table
  public.clubs, public.venues, public.club_staff_roles,
  public.staff_venue_grants, public.court_allocations
from public, anon, authenticated;

grant select on table
  public.clubs, public.venues, public.club_staff_roles,
  public.staff_venue_grants, public.court_allocations
to authenticated;
