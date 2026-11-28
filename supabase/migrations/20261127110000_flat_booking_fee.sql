-- Platform fee: a flat peso amount per booking instead of a percentage.
--
-- Owner decision (2026-11-27): the platform fee is one fixed amount in pesos for each court
-- booking: an online booking or a desk rental. An extension adds time to a booking that already
-- carries its fee, so it adds none. Every club starts at PHP 0 until the superadmin sets its fee.
--
-- The percentage is retired: its default and every club's rate become 0, and the two functions
-- that took a rate (platform_set_commission_rate, platform_provision_club) now take only 0. The
-- commission_rate columns and both signatures stay so earlier checks and the frozen release
-- packages keep working. Ledger lines recorded
-- before this migration keep the amounts they were recorded with.
--
-- Nothing in the reservation-write pause changes: no booking function is touched, and the
-- trigger still only records lines for charges that other functions write.

do $$
begin
  if to_regclass('public.club_accounts') is null
     or to_regclass('public.platform_commissions') is null
     or to_regprocedure('private.record_platform_commission()') is null then
    raise exception 'Apply 20261017090100_platform_control.sql first';
  end if;
end;
$$;

alter table public.club_accounts
  add column booking_fee numeric(10,2) not null default 0;
alter table public.club_accounts
  add constraint club_accounts_booking_fee_check check (booking_fee >= 0 and booking_fee <= 10000);
alter table public.club_accounts alter column commission_rate set default 0;
update public.club_accounts set commission_rate = 0, updated_at = now() where commission_rate <> 0;

comment on column public.club_accounts.booking_fee is
  'Platform fee in pesos for each court booking (online booking or desk rental). Set by the superadmin.';
comment on column public.club_accounts.commission_rate is
  'Retired percentage fee, kept at 0. Use booking_fee.';

-- The flat fee in force when the line was recorded.
alter table public.platform_commissions
  add column booking_fee numeric(10,2) not null default 0;
alter table public.platform_commissions
  add constraint platform_commissions_booking_fee_check check (booking_fee >= 0);

-- ---------------------------------------------------------------------------
-- The ledger trigger: one flat fee per booking
-- ---------------------------------------------------------------------------

-- Court time still gets a ledger line (online bookings, desk rentals and extensions), so the
-- court-charge totals stay whole. The fee applies to bookings and rentals only, and never
-- exceeds the charge, so the club's share is never negative. A rate left above 0 (only
-- possible through the retired function) still adds its percentage. The ledger must never
-- stop a charge from being recorded, so failures only raise a warning.
create or replace function private.record_platform_commission()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_rate numeric(5,2);
  v_fee numeric(10,2);
  v_commission numeric(12,2);
begin
  begin
    select a.commission_rate, a.booking_fee into v_rate, v_fee
    from public.club_accounts a where a.club_id = new.club_id;
    v_rate := coalesce(v_rate, 0);
    v_fee := case when new.type in ('booking', 'court_rental') then coalesce(v_fee, 0) else 0 end;
    v_commission := least(new.amount, v_fee + round(new.amount * v_rate / 100, 2));
    insert into public.platform_commissions (
      club_id, venue_id, transaction_id, gross_amount, commission_rate, booking_fee,
      commission_amount, club_net_amount, verification_status
    )
    values (
      new.club_id, new.venue_id, new.id, new.amount, v_rate, v_fee,
      v_commission, new.amount - v_commission, coalesce(new.verification_status, 'unverified')
    )
    on conflict (transaction_id) do nothing;
  exception when others then
    raise warning 'Platform commission not recorded for transaction %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The superadmin sets each club's fee (audited)
-- ---------------------------------------------------------------------------

create or replace function public.platform_set_booking_fee(p_club_id uuid, p_fee numeric)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old numeric;
begin
  perform private.require_platform_superadmin();
  if p_fee is null or p_fee < 0 or p_fee > 10000 then
    raise exception 'The booking fee must be between 0 and 10,000 pesos' using errcode = '22023';
  end if;
  if p_fee <> round(p_fee, 2) then
    raise exception 'Enter the booking fee in pesos and centavos' using errcode = '22023';
  end if;
  select a.booking_fee into v_old from public.club_accounts a where a.club_id = p_club_id for update;
  if not found then
    raise exception 'Club not found' using errcode = 'P0002';
  end if;
  update public.club_accounts set booking_fee = p_fee, updated_at = now() where club_id = p_club_id;
  perform private.platform_audit('club.booking_fee', p_club_id, jsonb_build_object('from', v_old, 'to', p_fee));
end;
$$;

-- ---------------------------------------------------------------------------
-- No percentage through the API any more
-- ---------------------------------------------------------------------------

-- The old rate setter stays (frozen checks list it) but takes only 0, so no API path can
-- put a percentage back. Setting 0 is still audited as club.commission_rate.
create or replace function public.platform_set_commission_rate(p_club_id uuid, p_rate numeric)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old numeric;
begin
  perform private.require_platform_superadmin();
  if p_rate is distinct from 0 then
    raise exception 'The platform fee is a flat amount per booking. Set the booking fee instead of a percentage.'
      using errcode = '22023';
  end if;
  select a.commission_rate into v_old from public.club_accounts a where a.club_id = p_club_id for update;
  if not found then
    raise exception 'Club not found' using errcode = 'P0002';
  end if;
  update public.club_accounts set commission_rate = 0, updated_at = now() where club_id = p_club_id;
  perform private.platform_audit('club.commission_rate', p_club_id, jsonb_build_object('from', v_old, 'to', 0));
end;
$$;

-- Set-up keeps its signature (the app and frozen checks call it) but its rate must be 0; the
-- booking fee is set right after with platform_set_booking_fee. Otherwise unchanged: a new club
-- starts in setup (inactive, hidden from players) with one venue and its courts, through this
-- audited definer path only.
create or replace function public.platform_provision_club(
  p_name text,
  p_slug text,
  p_city text,
  p_address text,
  p_contact_email text,
  p_contact_phone text,
  p_commission_rate numeric,
  p_court_count integer default 2
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_club uuid := extensions.gen_random_uuid();
  v_venue uuid := extensions.gen_random_uuid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_courts integer := coalesce(p_court_count, 2);
begin
  perform private.require_platform_superadmin();
  if v_name = '' then
    raise exception 'Enter the club name' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'Use 3 to 50 lowercase letters, numbers or dashes for the link name' using errcode = '22023';
  end if;
  if exists (select 1 from public.clubs c where c.slug = v_slug) then
    raise exception 'That link name is already used by another club' using errcode = '23505';
  end if;
  if p_commission_rate is distinct from 0 then
    raise exception 'The platform fee is a flat amount per booking. Set the booking fee instead of a percentage.'
      using errcode = '22023';
  end if;
  if v_courts < 1 or v_courts > 12 then
    raise exception 'Choose between 1 and 12 courts' using errcode = '22023';
  end if;

  insert into public.clubs (id, slug, name, is_active) values (v_club, v_slug, v_name, false);
  -- The clubs trigger created a provisioning account; fill in the agreed terms.
  update public.club_accounts
  set status = 'provisioning',
      commission_rate = 0,
      city = nullif(btrim(p_city), ''),
      address = nullif(btrim(p_address), ''),
      contact_email = nullif(lower(btrim(p_contact_email)), ''),
      contact_phone = nullif(btrim(p_contact_phone), ''),
      updated_at = now()
  where club_id = v_club;
  insert into public.venues (id, club_id, slug, name) values (v_venue, v_club, 'main', v_name);
  insert into public.courts (club_id, venue_id, name)
  select v_club, v_venue, 'Court ' || n from generate_series(1, v_courts) as n;

  perform private.platform_audit('club.provision', v_club, jsonb_build_object(
    'slug', v_slug, 'name', v_name, 'court_count', v_courts
  ));
  return v_club;
end;
$$;

-- The club list now carries each club's booking fee. Its row type changes, so it is
-- dropped and created again with the same owner and grants.
drop function public.platform_list_clubs();

create function public.platform_list_clubs()
returns table (
  club_id uuid, slug text, name text, status text, commission_rate numeric, booking_fee numeric,
  city text, address text, contact_email text, contact_phone text,
  venue_count bigint, court_count bigint, member_count bigint, admin_count bigint,
  gross_amount numeric, commission_amount numeric, club_net_amount numeric,
  entry_count bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_platform_superadmin();
  return query
  select
    c.id, c.slug, c.name,
    coalesce(a.status, case when c.is_active then 'active' else 'provisioning' end),
    coalesce(a.commission_rate, 0),
    coalesce(a.booking_fee, 0),
    a.city, a.address, a.contact_email, a.contact_phone,
    (select count(*) from public.venues v where v.club_id = c.id),
    (select count(*) from public.courts ct where ct.club_id = c.id),
    (select count(*) from public.members m where m.club_id = c.id),
    (select count(*) from public.club_staff_roles r where r.club_id = c.id and r.role = 'admin' and r.is_active),
    coalesce((select sum(pc.gross_amount) from public.platform_commissions pc where pc.club_id = c.id), 0),
    coalesce((select sum(pc.commission_amount) from public.platform_commissions pc where pc.club_id = c.id), 0),
    coalesce((select sum(pc.club_net_amount) from public.platform_commissions pc where pc.club_id = c.id), 0),
    (select count(*) from public.platform_commissions pc where pc.club_id = c.id),
    c.created_at
  from public.clubs c
  left join public.club_accounts a on a.club_id = c.id
  order by c.name, c.id;
end;
$$;

alter function private.record_platform_commission() owner to postgres;
alter function public.platform_set_booking_fee(uuid, numeric) owner to postgres;
alter function public.platform_list_clubs() owner to postgres;
alter function public.platform_set_commission_rate(uuid, numeric) owner to postgres;
alter function public.platform_provision_club(text, text, text, text, text, text, numeric, integer) owner to postgres;
revoke all on function private.record_platform_commission() from public, anon, authenticated;
revoke all on function public.platform_set_booking_fee(uuid, numeric) from public, anon;
revoke all on function public.platform_list_clubs() from public, anon;
revoke all on function public.platform_set_commission_rate(uuid, numeric) from public, anon;
revoke all on function public.platform_provision_club(text, text, text, text, text, text, numeric, integer) from public, anon;
grant execute on function public.platform_set_booking_fee(uuid, numeric) to authenticated;
grant execute on function public.platform_list_clubs() to authenticated;
grant execute on function public.platform_set_commission_rate(uuid, numeric) to authenticated;
grant execute on function public.platform_provision_club(text, text, text, text, text, text, numeric, integer) to authenticated;

comment on function public.platform_set_booking_fee(uuid, numeric) is
  'Platform superadmin only: sets a club''s flat platform fee in pesos per court booking. Audited as club.booking_fee.';
