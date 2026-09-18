/* ===================================================================
   UPI booking token — no gateway, no fees
   -------------------------------------------------------------------
   The guest pays straight into the hostel's UPI id and reports the
   12-digit UTR their app shows. Money never touches a third party, so
   nothing is deducted.

   The reference is recorded through the attach_utr Postgres function
   rather than an Edge Function, so this half of the flow works with no
   deployment step at all.

   What this is: a commitment filter. Someone idly filling in the form
   will not transfer ₹500. What it is NOT: proof of payment. Nothing
   here can check with a bank, so a UTR is only a claim until the
   manager matches it against their own UPI notification and presses
   Verify in the portal. The UI says so plainly rather than implying
   the bed is secured.
   =================================================================== */
import { supabase, supabaseReady } from './supabase-client.js';

let qrPromise = null;
function getQR() {
  if (!qrPromise) {
    qrPromise = import('qrcode')
      .then(m => m.default || m)
      .catch(() => { qrPromise = null; return null; });
  }
  return qrPromise;
}

/** Build the UPI intent URI that every Indian payment app understands. */
export function buildUpiUri({ vpa, payeeName, amount, ref, note }) {
  const p = new URLSearchParams({
    pa: vpa,
    pn: payeeName || 'Hostel',
    am: String(amount),
    cu: 'INR',
    tn: note || `Move-in payment ${ref}`,
  });
  return `upi://pay?${p.toString()}`;
}

/** Render the URI as a QR into a <canvas>. Returns false if it couldn't. */
export async function renderQr(canvas, uri) {
  const QR = await getQR();
  if (!QR || !canvas) return false;
  try {
    await QR.toCanvas(canvas, uri, {
      width: 208,
      margin: 1,
      color: { dark: '#11141a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record the guest's email against an existing booking.
 * Used when they reach the payment step without having given one — a
 * ₹500 token deserves a receipt. Fills a blank address only.
 */
export async function setBookingEmail(ref, email) {
  if (!supabaseReady) return { ok: false, error: 'Not configured' };
  const clean = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: 'That email address does not look right.' };
  }
  try {
    const { data, error } = await supabase.rpc('set_booking_email', {
      p_ref: ref, p_email: clean
    });
    if (error) {
      console.warn('[email] save failed:', error.message);
      return { ok: false, error: "We couldn't save that just now — you can still continue." };
    }
    if (!data?.ok) return { ok: false, error: data?.error || 'Could not save it.' };
    return { ok: true };
  } catch (err) {
    console.warn('[email] save threw:', err.message);
    return { ok: false, error: "We couldn't save that just now — you can still continue." };
  }
}

/** Send the guest's reported UTR to the server. */
export async function submitUtr(ref, utr) {
  if (!supabaseReady) return { ok: false, error: 'Not configured' };
  const clean = String(utr || '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(clean)) return { ok: false, error: 'A UPI reference is 12 digits.' };
  // Anything that isn't a clean success is reported to the guest in plain
  // language. Raw transport errors ("Failed to send a request to the Edge
  // Function") tell them nothing and make a working payment look lost.
  const unreachable =
    "We couldn't save your reference just now. Your payment is safe — " +
    'send the reference to the manager on WhatsApp and it will be matched up.';

  // Postgres RPC, not an Edge Function: this runs inside the database and
  // needs no deployment. attach_utr is SECURITY DEFINER and does the same
  // checks the function did — 12-digit shape, booking must exist, and it
  // refuses to overwrite a reference that is already there.
  try {
    const { data, error } = await supabase.rpc('attach_utr', {
      p_ref: ref,
      p_utr: clean,
    });
    if (error) {
      console.warn('[utr] submit failed:', error.message);
      return { ok: false, error: unreachable, unreachable: true };
    }
    if (!data?.ok) {
      // A real validation reply from the server is worth showing verbatim.
      return { ok: false, error: data?.error || unreachable };
    }
    return { ok: true, already: Boolean(data.already) };
  } catch (err) {
    console.warn('[utr] submit threw:', err.message);
    return { ok: false, error: unreachable, unreachable: true };
  }
}
