-- Tournaments across every club, for the public Tournaments page.
--
-- list_public_club_tournaments shows one club's tournaments. This lists them from every active
-- club, newest first within live, then upcoming (setup), then finished, and adds the club's
-- slug, name and city so each card can say where it is played and link to the club's bracket.
-- Open to visitors like the club pages. The same summary the club page shows
-- (private.tournament_summary_json), so no member contact details; cancelled tournaments and
-- clubs that are not active are left out. Read-only.

do $$
begin
  if to_regprocedure('private.tournament_summary_json(uuid)') is null
     or to_regclass('public.club_tournaments') is null then
    raise exception 'Apply 20261126090000_club_tournaments.sql first';
  end if;
end;
$$;

create or replace function public.list_public_tournaments(
  p_status text default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
begin
  if v_status is not null and v_status not in ('live', 'setup', 'completed') then
    raise exception 'Unknown tournament status' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      private.tournament_summary_json(t.id)
        || jsonb_build_object('club', jsonb_build_object('slug', t.slug, 'name', t.name, 'city', t.city))
      order by t.status_order, t.created_at desc, t.id desc
    )
    from (
      select tr.id, tr.created_at, c.slug, c.name, a.city,
             case tr.status when 'live' then 0 when 'setup' then 1 else 2 end as status_order
      from public.club_tournaments tr
      join public.clubs c on c.id = tr.club_id
      join public.club_accounts a on a.club_id = c.id
      where c.is_active
        and a.status = 'active'
        and tr.status in ('live', 'setup', 'completed')
        and (v_status is null or tr.status = v_status)
      order by status_order, tr.created_at desc, tr.id desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

alter function public.list_public_tournaments(text, integer) owner to postgres;

revoke all on function public.list_public_tournaments(text, integer) from public;
grant execute on function public.list_public_tournaments(text, integer) to anon, authenticated;
