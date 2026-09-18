-- ===================================================================
-- Attach a UPI reference WITHOUT deploying an Edge Function.
--
-- The column-grant approach doesn't work here: PostgREST must locate the
-- row before updating it, and anon has no SELECT policy on bookings (nor
-- should it — that would expose every resident's enquiry). So the logic
-- lives in a SECURITY DEFINER function instead. It runs as the owner,
-- bypassing RLS, but only does the one narrow thing written below.
--
-- Callable by anon over /rest/v1/rpc/attach_utr with just the public key.
-- ===================================================================

-- undo the column grants; the function is the only path in
revoke update (upi_utr, utr_submitted_at, payment_status) on public.bookings from anon;
drop policy if exists bookings_public_attach_utr on public.bookings;

create or replace function public.attach_utr(p_ref text, p_utr text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.bookings%rowtype;
begin
  -- shape check first, so nothing else runs on junk input
  if p_utr is null or p_utr !~ '^[0-9]{12}$' then
    return json_build_object('ok', false, 'error', 'A UPI reference is 12 digits.');
  end if;
  if p_ref is null or length(p_ref) > 40 then
    return json_build_object('ok', false, 'error', 'A booking reference is required.');
  end if;

  select * into v from public.bookings where ref = p_ref;
  if not found then
    return json_build_object('ok', false, 'error', 'Unknown booking.');
  end if;

  -- a settled booking is untouchable
  if v.payment_status = 'paid' then
    return json_build_object('ok', true, 'already', true, 'status', 'paid');
  end if;

  -- already claimed: report success but change nothing, so a guessed
  -- reference can never overwrite a real one
  if v.upi_utr is not null then
    return json_build_object('ok', true, 'already', true, 'status', 'pending');
  end if;

  update public.bookings
     set upi_utr          = p_utr,
         utr_submitted_at = now(),
         payment_status   = 'pending'
   where ref = p_ref
     and upi_utr is null;          -- guards a racing second submit

  return json_build_object('ok', true, 'status', 'pending');
end;
$$;

-- Only this function is exposed, and only these two arguments.
revoke all on function public.attach_utr(text, text) from public;
grant execute on function public.attach_utr(text, text) to anon, authenticated;

comment on function public.attach_utr is
  'Records a guest-reported UPI reference. A claim, not proof — the manager still verifies.';
