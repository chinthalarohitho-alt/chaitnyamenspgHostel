-- ===================================================================
-- Free UPI token: guest pays straight to the hostel's VPA and reports
-- the UTR. No gateway, so no cut — the manager confirms against their
-- own bank notification.
-- ===================================================================

alter table public.bookings add column if not exists upi_utr text;
alter table public.bookings add column if not exists utr_submitted_at timestamptz;
alter table public.bookings add column if not exists verified_by uuid references auth.users(id);

-- A UTR is the 12-digit bank reference. Stored as text to keep leading zeros.
do $$
begin
  alter table public.bookings
    add constraint bookings_utr_format
    check (upi_utr is null or upi_utr ~ '^[0-9]{12}$');
exception when duplicate_object then null;
end $$;

create index if not exists bookings_utr_idx on public.bookings (upi_utr) where upi_utr is not null;

-- Only a manager may confirm money actually arrived.
drop policy if exists bookings_manager_update on public.bookings;
create policy bookings_manager_update on public.bookings
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- UPI id and token amount live in the manager-editable config.
update public.site_config
   set texts   = texts   || jsonb_build_object('upiId', '', 'upiName', 'Chaitanya Mens PG & Hostel'),
       pricing = pricing || jsonb_build_object('tokenAmount', 500)
 where id = 'main';
