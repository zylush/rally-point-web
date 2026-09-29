alter table public.support_inquiries
  add column response text,
  add column responded_by uuid references public.profiles (id) on delete set null,
  add column responded_at timestamptz,
  add constraint support_inquiries_response_length
    check (response is null or char_length(response) between 1 and 2000),
  add constraint support_inquiries_response_metadata
    check (
      (response is null and responded_by is null and responded_at is null)
      or (response is not null and responded_by is not null and responded_at is not null)
    );

revoke update on public.support_inquiries from authenticated;

create or replace function public.admin_update_support_inquiry(
  p_inquiry_id uuid,
  p_status text,
  p_response text default null
)
returns setof public.support_inquiries
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_inquiry public.support_inquiries;
  v_response text := nullif(btrim(p_response), '');
  v_status_label text;
  v_notification_body text;
begin
  if private.current_club_role(private.current_club_id()) is distinct from 'admin'::public.user_role then
    raise exception 'Only admins can update inquiries' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('open', 'in_progress', 'resolved') then
    raise exception 'Invalid inquiry status' using errcode = '22023';
  end if;

  if v_response is not null and char_length(v_response) > 2000 then
    raise exception 'Response must be 2000 characters or fewer' using errcode = '22023';
  end if;

  select *
    into v_inquiry
    from public.support_inquiries
    where id = p_inquiry_id and club_id = private.current_club_id()
    for update;

  if not found then
    raise exception 'Inquiry not found' using errcode = 'P0002';
  end if;

  if v_response is not null and v_inquiry.responded_at is not null then
    raise exception 'This inquiry already has an Admin response' using errcode = 'P0001';
  end if;

  if v_inquiry.status = p_status and v_response is null then
    return next v_inquiry;
    return;
  end if;

  update public.support_inquiries
    set status = p_status,
        response = coalesce(v_response, response),
        responded_by = case when v_response is null then responded_by else auth.uid() end,
        responded_at = case when v_response is null then responded_at else now() end
    where id = p_inquiry_id and club_id = private.current_club_id()
    returning * into v_inquiry;

  v_status_label := replace(v_inquiry.status, '_', ' ');
  v_notification_body := format(
    'Your inquiry "%s" is now %s.%s',
    v_inquiry.subject,
    v_status_label,
    case
      when v_response is null then ''
      else format(' Admin reply: %s', v_inquiry.response)
    end
  );

  insert into public.notifications (club_id, user_id, title, body)
    values (v_inquiry.club_id, v_inquiry.user_id, 'Inquiry update', v_notification_body);

  return next v_inquiry;
end;
$$;

revoke all on function public.admin_update_support_inquiry(uuid, text, text) from public;
revoke all on function public.admin_update_support_inquiry(uuid, text, text) from anon;
grant execute on function public.admin_update_support_inquiry(uuid, text, text) to authenticated;
