-- ===================================================================
-- Booking token payment fields (gateway-agnostic)
-- ===================================================================

-- A booking starts unpaid and is only promoted to 'paid' by the server
-- after a payment is verified server-side. Never by the browser.
alter table public.bookings add column if not exists payment_status text not null default 'unpaid';
alter table public.bookings add column if not exists payment_order_id  text;
alter table public.bookings add column if not exists payment_id        text;
alter table public.bookings add column if not exists payment_amount    integer;   -- paise
alter table public.bookings add column if not exists paid_at           timestamptz;

do $$
begin
  alter table public.bookings
    add constraint bookings_payment_status_check
    check (payment_status in ('unpaid','pending','paid','failed','refunded'));
exception when duplicate_object then null;
end $$;

create index if not exists bookings_payment_order_idx on public.bookings (payment_order_id);
create unique index if not exists bookings_payment_id_uniq
  on public.bookings (payment_id) where payment_id is not null;

-- ---------- lock down what a visitor may write --------------------
-- A visitor may still create an enquiry, but must not be able to declare
-- it paid. The old policy allowed any column; this one pins the payment
-- fields to their safe initial values.
drop policy if exists bookings_public_insert on public.bookings;
create policy bookings_public_insert on public.bookings
  for insert to anon, authenticated
  with check (
    payment_status = 'unpaid'
    and payment_id is null
    and paid_at is null
  );

-- Visitors still cannot read or update anything (no such policy exists),
-- so only the service role — i.e. the Edge Function — can mark a booking paid.

-- ---------- token amount lives in the manager config ---------------
update public.site_config
   set pricing = pricing || jsonb_build_object('tokenAmount', 500)
 where id = 'main'
   and not (pricing ? 'tokenAmount');
