-- Guest email for invoices. Optional: the form must still work for people
-- who only want WhatsApp, so a missing address simply means no email is sent.
alter table public.bookings add column if not exists email text;

-- Tracks delivery so a retry can't double-send and the manager can see
-- which enquiries were actually emailed.
alter table public.bookings add column if not exists invoice_sent_at timestamptz;

-- Basic shape check; NULL stays allowed.
do $$
begin
  alter table public.bookings
    add constraint bookings_email_format
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
exception when duplicate_object then null;
end $$;
