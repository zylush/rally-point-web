-- Support inquiries start unanswered (security review, 2026-11-28).
--
-- Staff and admins raise an inquiry with a plain insert (src/lib/api.ts createInquiry), and
-- policy inquiries_insert_staff_admin checks the club, the role and the account. The insert
-- grant covers every column, so a new inquiry could already look answered: status
-- 'resolved', a response, responded_by naming any profile, a response time, or a made-up
-- created_at. Only admin_update_support_inquiry may answer an inquiry.
--
-- A BEFORE INSERT trigger now gives every inquiry inserted by an API role (anon or
-- authenticated) the state of a new one: status 'open', no response, no responder, no
-- response time, created now. Grants and policies are unchanged, so the app's insert (it
-- already sends status 'open') and admin_update_support_inquiry work as before. Trusted
-- writers (the table owner, definer functions, data restores) keep the values they give.

do $guard$
begin
  if to_regclass('public.support_inquiries') is null
     or to_regprocedure('public.admin_update_support_inquiry(uuid, text, text)') is null then
    raise exception 'Apply 20260928170000_support_inquiry_replies.sql first';
  end if;
end
$guard$;

create function private.support_inquiry_insert_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.status := 'open';
  new.response := null;
  new.responded_by := null;
  new.responded_at := null;
  new.created_at := now();
  return new;
end;
$$;

create trigger support_inquiries_insert_guard
  before insert on public.support_inquiries
  for each row
  when (current_user in ('anon', 'authenticated'))
  execute function private.support_inquiry_insert_guard();

alter function private.support_inquiry_insert_guard() owner to postgres;
revoke all on function private.support_inquiry_insert_guard() from public, anon, authenticated, service_role;
