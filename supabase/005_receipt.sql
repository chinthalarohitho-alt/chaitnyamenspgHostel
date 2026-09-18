-- ===================================================================
-- Two separate emails, tracked separately:
--   · enquiry  — acknowledgement, sent on submit, no invoice
--   · receipt  — real invoice + PDF, sent only after the manager
--                verifies the token actually arrived
-- ===================================================================

alter table public.bookings add column if not exists receipt_sent_at timestamptz;

-- invoice_sent_at was doing double duty; rename its meaning to the
-- acknowledgement so the two are unambiguous.
alter table public.bookings rename column invoice_sent_at to enquiry_mail_sent_at;

comment on column public.bookings.enquiry_mail_sent_at is
  'Acknowledgement email sent on submit. No invoice attached.';
comment on column public.bookings.receipt_sent_at is
  'Paid receipt + PDF invoice. Only set after a manager verified the token.';
