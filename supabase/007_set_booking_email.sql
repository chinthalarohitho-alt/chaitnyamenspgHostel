-- ===================================================================
-- Capture the guest's email at the moment they commit to paying.
--
-- The booking row already exists by then, and visitors have no UPDATE
-- rights on bookings, so this goes through a SECURITY DEFINER function
-- like attach_utr. It only ever fills a blank address — it cannot be
-- used to change one already on record.
-- ===================================================================

create or replace function public.set_booking_email(p_ref text, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.bookings%rowtype;
begin
  -- Normalise BEFORE validating: people paste addresses with stray
  -- whitespace and mixed case, and rejecting those reads as a bug.
  p_email := lower(btrim(coalesce(p_email, '')));
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if p_ref is null or length(p_ref) > 40 then
    return json_build_object('ok', false, 'error', 'A booking reference is required.');
  end if;

  select * into v from public.bookings where ref = p_ref;
  if not found then
    return json_build_object('ok', false, 'error', 'Unknown booking.');
  end if;

  -- Never overwrite an address the guest already gave.
  if v.email is not null and v.email <> '' then
    return json_build_object('ok', true, 'already', true);
  end if;

  update public.bookings
     set email = p_email
   where ref = p_ref
     and (email is null or email = '');

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.set_booking_email(text, text) from public;
grant execute on function public.set_booking_email(text, text) to anon, authenticated;

comment on function public.set_booking_email is
  'Fills a blank guest email on an existing booking. Cannot overwrite one.';
