-- ===================================================================
-- Optional Payment Mode: UPI Transfer or Cash on Hand
-- ===================================================================

alter table public.bookings add column if not exists payment_mode text default 'upi';
comment on column public.bookings.payment_mode is 'Payment method preference: upi or cash';
