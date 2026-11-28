-- Coaches and open lesson times across every active club, for the public Rent a coach page.
--
-- get_public_club_profile shows one club's coaches without lesson slots, and member_list_coach_slots
-- requires a signed-in member of one club. This lists active coaches from every active club along
-- with their open future booking slots so visitors and signed-in players can discover coaches and
-- times across clubs.
-- Open to visitors like the club and tournament pages. Only safe public fields are returned:
-- accepts_requests is a boolean (never account_user_id), and no member or player contact data is
-- included. Suspended or inactive clubs, inactive coaches, closed/past slots, pending-held slots,
-- and full slots are left out. Read-only.

do $$
begin
  if to_regclass('public.club_coaches') is null
     or to_regclass('public.coach_booking_slots') is null then
    raise exception 'Apply 20261124110000_rent_a_coach.sql first';
  end if;
end;
$$;

create or replace function public.list_public_coaches(
  p_club_slug text default null,
  p_from timestamptz default now(),
  p_until timestamptz default now() + interval '30 days'
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_slug text := nullif(lower(btrim(coalesce(p_club_slug, ''))), '');
  v_until timestamptz;
begin
  if p_from is null or p_until is null or p_until <= p_from then
    raise exception 'Choose a valid date range' using errcode = '22023';
  end if;
  v_until := least(p_until, greatest(p_from, now()) + interval '90 days');

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', co.id,
        'full_name', co.full_name,
        'headline', co.headline,
        'bio', co.bio,
        'hourly_rate', co.hourly_rate,
        'contact_phone', co.contact_phone,
        'contact_url', co.contact_url,
        'photo_path', co.photo_path,
        'booking_policy', co.booking_policy,
        'accepts_requests', (co.account_user_id is not null),
        'club', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'name', c.name,
          'city', a.city
        ),
        'slots', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'slot_id', s.id,
              'starts_at', s.starts_at,
              'ends_at', s.ends_at,
              'lesson_type', s.lesson_type,
              'pricing_model', s.pricing_model,
              'rate', s.rate,
              'max_students', s.max_students,
              'remaining_students', s.max_students - coalesce((
                select sum(r.student_count)::integer
                from public.coach_booking_requests r
                where r.slot_id = s.id and r.status in ('requested', 'accepted')
              ), 0)
            )
            order by s.starts_at, s.id
          )
          from public.coach_booking_slots s
          where s.coach_id = co.id
            and s.club_id = c.id
            and s.is_open
            and s.starts_at >= greatest(p_from, now())
            and s.starts_at < v_until
            and not exists (
              select 1 from public.coach_booking_requests r
              where r.slot_id = s.id and r.status = 'requested'
            )
            and s.max_students > coalesce((
              select sum(r.student_count)::integer
              from public.coach_booking_requests r
              where r.slot_id = s.id and r.status in ('requested', 'accepted')
            ), 0)
        ), '[]'::jsonb)
      )
      order by (c.slug <> 'rally-point-gensan'), c.name, co.position, co.created_at, co.id
    )
    from public.club_coaches co
    join public.clubs c on c.id = co.club_id
    join public.club_accounts a on a.club_id = c.id
    where c.is_active
      and a.status = 'active'
      and co.is_active
      and (v_slug is null or c.slug = v_slug)
  ), '[]'::jsonb);
end;
$$;

alter function public.list_public_coaches(text, timestamptz, timestamptz) owner to postgres;

revoke all on function public.list_public_coaches(text, timestamptz, timestamptz) from public;
grant execute on function public.list_public_coaches(text, timestamptz, timestamptz) to anon, authenticated;
