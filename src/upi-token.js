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
import QRCode from 'qrcode';
import { supabase, supabaseReady } from './supabase-client.js';

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
  if (!canvas || !uri) return false;
  try {
    const fn = (typeof QRCode?.toCanvas === 'function')
      ? QRCode.toCanvas
      : (typeof QRCode?.default?.toCanvas === 'function' ? QRCode.default.toCanvas : null);

    if (fn) {
      await fn(canvas, uri, {
        width: 208,
        margin: 1,
        color: { dark: '#11141a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      return true;
    }
    console.error('[renderQr] QRCode.toCanvas not available:', QRCode);
    return false;
  } catch (err) {
    console.error('[renderQr] failed to render QR to canvas:', err);
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

/** Send the guest's reported UTR to the server (optional or custom format). */
export async function submitUtr(ref, utr) {
  if (!supabaseReady) return { ok: false, error: 'Not configured' };
  const clean = String(utr || '').trim();
  if (!clean) return { ok: true, skipped: true };

  // If 12 digits, try Postgres RPC attach_utr first
  if (/^\d{12}$/.test(clean)) {
    try {
      const { data, error } = await supabase.rpc('attach_utr', {
        p_ref: ref,
        p_utr: clean,
      });
      if (!error && data?.ok) {
        return { ok: true, already: Boolean(data.already) };
      }
    } catch { /* fallback below */ }
  }

  // Direct table update fallback for custom or any format
  try {
    const { error } = await supabase.from('bookings').update({
      utr: clean,
      upi_utr: clean,
    }).eq('ref', ref);
    if (!error) return { ok: true };
  } catch (err) {
    console.warn('[utr] direct update threw:', err);
  }

  return { ok: true };
}
