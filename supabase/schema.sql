-- ===================================================================
-- Chaitanya Mens PG & Hostel — Supabase schema
-- Public site reads config; only managers write. Visitors may submit
-- booking enquiries but can never read them back.
-- ===================================================================

-- ---------- managers -----------------------------------------------
-- Signup is open on this project, so "logged in" is NOT the same as
-- "manager". Membership in this table is what grants write access.
create table if not exists public.managers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so policies on other tables can call it without
-- recursing through managers' own RLS.
create or replace function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.managers where user_id = auth.uid());
$$;

-- ---------- site_config --------------------------------------------
-- Single row ('main') holding everything the manager portal edits.
create table if not exists public.site_config (
  id         text primary key default 'main',
  pricing    jsonb not null default '{}'::jsonb,
  texts      jsonb not null default '{}'::jsonb,
  photos     jsonb not null default '{}'::jsonb,
  inventory  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint site_config_single_row check (id = 'main')
);

-- ---------- bookings -----------------------------------------------
create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique not null,
  name         text not null,
  phone        text not null,
  floor        text,
  room         text,
  move_in_date text,
  duration     text,
  workplace    text,
  status       text not null default 'new',
  created_at   timestamptz not null default now()
);

create index if not exists bookings_created_at_idx
  on public.bookings (created_at desc);

-- ---------- row level security --------------------------------------
alter table public.managers    enable row level security;
alter table public.site_config enable row level security;
alter table public.bookings    enable row level security;

-- managers: you may only see your own row; nobody writes via the API.
drop policy if exists managers_select_self on public.managers;
create policy managers_select_self on public.managers
  for select to authenticated
  using (user_id = auth.uid());

-- site_config: world-readable (the public site needs it), manager-writable.
drop policy if exists site_config_public_read on public.site_config;
create policy site_config_public_read on public.site_config
  for select to anon, authenticated
  using (true);

drop policy if exists site_config_manager_update on public.site_config;
create policy site_config_manager_update on public.site_config
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists site_config_manager_insert on public.site_config;
create policy site_config_manager_insert on public.site_config
  for insert to authenticated
  with check (public.is_manager());

-- bookings: anyone may submit an enquiry; only managers may read them.
-- No anon SELECT policy, so a visitor cannot list other people's data.
drop policy if exists bookings_public_insert on public.bookings;
create policy bookings_public_insert on public.bookings
  for insert to anon, authenticated
  with check (true);

drop policy if exists bookings_manager_read on public.bookings;
create policy bookings_manager_read on public.bookings
  for select to authenticated
  using (public.is_manager());

drop policy if exists bookings_manager_update on public.bookings;
create policy bookings_manager_update on public.bookings
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists bookings_manager_delete on public.bookings;
create policy bookings_manager_delete on public.bookings
  for delete to authenticated
  using (public.is_manager());

-- ---------- realtime -------------------------------------------------
-- Lets an open manager dashboard receive new enquiries live.
do $$
begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null;
end $$;
