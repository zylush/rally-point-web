create table public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null default private.current_club_id() references public.clubs (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('booking', 'membership', 'payment', 'technical', 'other')),
  subject text not null check (char_length(subject) between 1 and 120),
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.support_inquiries enable row level security;

revoke all on public.support_inquiries from public, anon, authenticated;

create policy "inquiries_insert_staff_admin"
  on public.support_inquiries for insert to authenticated
  with check (
    club_id = private.current_club_id()
    and private.current_club_role(club_id) in ('staff', 'admin')
    and user_id = auth.uid()
  );

create policy "inquiries_read_own_or_admin"
  on public.support_inquiries for select to authenticated
  using (
    club_id = private.current_club_id()
    and (user_id = auth.uid() or private.current_club_role(club_id) = 'admin')
  );

grant select, insert on public.support_inquiries to authenticated;
