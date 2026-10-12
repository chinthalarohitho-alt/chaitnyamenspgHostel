-- Migration 009: Add Government ID Proof columns to bookings table
-- Captures resident identification type, official ID number, and uploaded document proof URL/data

alter table public.bookings
  add column if not exists id_type text,
  add column if not exists id_number text,
  add column if not exists id_proof_url text;

comment on column public.bookings.id_type is 'Type of government ID provided (e.g. Aadhaar Card, PAN Card, Driving License, Voter ID, Passport)';
comment on column public.bookings.id_number is 'Government identification number provided by resident';
comment on column public.bookings.id_proof_url is 'Base64 data URI or storage URL of uploaded ID document proof';

-- Force Supabase PostgREST to reload schema cache immediately
notify pgrst, 'reload schema';
