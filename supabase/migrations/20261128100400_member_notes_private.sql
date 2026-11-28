-- Staff notes on a member stay with the club's admins (security review, 2026-11-28).
--
-- members.notes is written by admins in the member editor (admin_upsert_member) and read
-- back there through member_admin. Two other paths also handed the notes to the member:
--   1. member_self, the member's own card (private.member_self_rows), now returns no notes.
--   2. ensure_member_qr returns the whole members row to the member or to a club admin; the
--      notes are now left out unless the caller is an admin of that club.
-- Stored notes are not changed, and member_admin and admin_upsert_member still return them.
--
-- Each function is its latest definition copied unchanged except for the notes:
--   private.member_self_rows   from 20261017160000_supabase_advisor_fixes.sql
--   public.ensure_member_qr    from 20260921090000_tenant_ready.sql
-- The result columns stay the same (the app reads member_self with select *), and
-- create or replace keeps each function's grants; ownership is set again below.

do $guard$
begin
  if to_regprocedure('private.member_self_rows()') is null
     or to_regprocedure('public.ensure_member_qr(uuid)') is null
     or to_regclass('public.member_self') is null then
    raise exception 'Apply 20261017160000_supabase_advisor_fixes.sql first';
  end if;
end
$guard$;

create or replace function private.member_self_rows()
returns table (id uuid, user_id uuid, member_code text, full_name text, email text, phone text,
  membership_type public.membership_type, status public.member_status, join_date date, expiry_date date,
  notes text, created_at timestamptz, qr_token text, club_id uuid)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.user_id, m.member_code, m.full_name, m.email, m.phone, m.membership_type, m.status,
         m.join_date, m.expiry_date, null::text, m.created_at, m.qr_token, m.club_id
  from public.members m
  where m.club_id = private.current_club_id()
    and m.user_id = auth.uid()
$$;

create or replace function public.ensure_member_qr(p_member_id uuid)
returns public.members
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.members;
begin
  select * into v from public.members
  where id = p_member_id
    and club_id = private.current_club_id()
    and (user_id = auth.uid() or private.current_club_role(club_id) = 'admin')
  for update;
  if v.id is null then raise exception 'member access denied'; end if;
  if v.qr_token is null then
    update public.members
    set qr_token = 'q_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
    where id = v.id returning * into v;
  end if;
  -- Staff notes are for the club's admins; everyone else gets the row without them.
  if private.current_club_role(v.club_id) is distinct from 'admin' then
    v.notes := null;
  end if;
  return v;
end;
$$;

alter function private.member_self_rows() owner to postgres;
alter function public.ensure_member_qr(uuid) owner to postgres;
