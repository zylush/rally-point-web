-- Desk walk-ins: the amount and the text typed at the desk are checked (security review, 2026-11-28).
--
-- create_desk_walkin (staff with a grant for the venue, or a club admin) stored any amount,
-- so a negative one netted real cash out of the club's revenue (admin_club_analytics sums
-- transactions), and the guest's name, phone and purpose had no length limit.
--   - The amount must be between 0 and 100,000 pesos, like court rates and add-on prices.
--     0 stays allowed: the desk form accepts it (its field has min 0), so a free visit is
--     still recorded, with a 0-peso walk-in charge as before.
--   - The full name is tidied like account names (private.tidy_name: one space between
--     words; control, zero-width and text-direction characters dropped), must not be empty
--     and is limited to 80 characters, like update_my_account. The phone (optional; empty
--     means none) and the purpose are tidied the same way and limited to 24 characters (club
--     and owner phones allow 24 digits, spaces, brackets and dashes) and 200 characters.
-- Only the function changes. walkins and transactions get no new constraints, because rows
-- already stored may not meet them. The venue check still comes first, so a caller without
-- access gets the same refusal as before, whatever they typed.
-- create_desk_walkin is not one of the nine paused booking functions: it writes walkins and
-- transactions, not reservations.
--
-- The function is its definition from 20260921090000_tenant_ready.sql with the checks added;
-- create or replace keeps its grants (signed-in callers only); ownership is set again below.

do $guard$
begin
  if to_regprocedure('public.create_desk_walkin(uuid, text, text, text, numeric)') is null
     or to_regprocedure('private.tidy_name(text)') is null then
    raise exception 'Apply 20261125090000_member_profile.sql first';
  end if;
end
$guard$;

create or replace function public.create_desk_walkin(p_venue_id uuid, p_full_name text, p_phone text, p_purpose text, p_amount numeric)
returns public.walkins
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.walkins;
declare v_club uuid := private.current_club_id();
declare v_name text;
declare v_phone text;
declare v_purpose text;
begin
  if private.can_operate_venue(v_club, p_venue_id) is not true then raise exception 'venue is outside assigned club'; end if;
  v_name := private.tidy_name(p_full_name);
  v_phone := nullif(private.tidy_name(p_phone), '');
  v_purpose := private.tidy_name(p_purpose);
  if v_name = '' then
    raise exception 'Please enter the guest''s full name' using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Full name is limited to 80 characters' using errcode = '22023';
  end if;
  if char_length(v_phone) > 24 then
    raise exception 'Phone is limited to 24 characters' using errcode = '22023';
  end if;
  if char_length(v_purpose) > 200 then
    raise exception 'Purpose is limited to 200 characters' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000 then
    raise exception 'Amount must be between 0 and 100,000 pesos' using errcode = '22023';
  end if;
  insert into public.walkins (club_id, venue_id, full_name, phone, purpose, amount, created_by)
  values (v_club, p_venue_id, v_name, v_phone, v_purpose, p_amount, auth.uid()) returning * into v;
  insert into public.transactions (club_id, venue_id, amount, type, description, created_by, verification_status)
  values (v_club, p_venue_id, p_amount, 'walk_in', 'Walk-in — recorded charge', auth.uid(), 'unverified');
  return v;
end;
$$;

alter function public.create_desk_walkin(uuid, text, text, text, numeric) owner to postgres;
