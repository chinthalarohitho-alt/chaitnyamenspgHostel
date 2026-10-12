-- ===================================================================
-- Optional Payment Mode: UPI Transfer, Advance Payment or Cash on Hand
-- ===================================================================

alter table public.bookings add column if not exists payment_mode text default 'upi';
comment on column public.bookings.payment_mode is 'Payment method preference: upi, advance, or cash';

alter table public.bookings add column if not exists advance_amount numeric;
comment on column public.bookings.advance_amount is 'Advance token amount paid/payable to reserve bed';

alter table public.bookings add column if not exists balance_amount numeric;
comment on column public.bookings.balance_amount is 'Remaining balance payable upon check-in';
