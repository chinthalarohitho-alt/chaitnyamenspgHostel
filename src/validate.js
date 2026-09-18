/* ===================================================================
   Shared field validation
   -------------------------------------------------------------------
   One place for the rules, so the booking form, the payment step and
   the manager portal all agree. Each validator returns:

     { ok: true }                      – valid
     { ok: false, error }              – reject, show the message
     { ok: true, warn }                – accept, but flag it

   The warn case matters for UPI ids: handles change as banks launch
   new ones, so an unrecognised handle must not be blocked outright —
   only questioned. A typo like "@hdfl" silently sends money nowhere.
   =================================================================== */

/** UPI handles in common use in India. Not exhaustive on purpose. */
const KNOWN_PSP = [
  // banks
  'oksbi', 'okhdfcbank', 'okicici', 'okaxis', 'okbizaxis',
  'hdfcbank', 'icici', 'axisbank', 'sbi', 'kotak', 'yesbank',
  'indus', 'indusind', 'federal', 'idfcbank', 'idfcfirst', 'pnb',
  'unionbank', 'uboi', 'barodampay', 'cnrb', 'cboi', 'iob', 'jkb',
  // apps / PSPs
  'ybl', 'ibl', 'axl',            // PhonePe
  'paytm', 'ptyes', 'ptsbi', 'ptaxis', 'pthdfc',
  'upi', 'apl', 'yapl',           // Amazon Pay
  'abfspay', 'freecharge', 'jupiteraxis', 'fam', 'slice',
  'timecosmos', 'rapl', 'naviaxis', 'superyes', 'seyes',
];

/**
 * UPI Virtual Payment Address.
 * Shape is enforced; the handle is only warned about, because a new PSP
 * that isn't on the list above must still be usable.
 */
export function validateUpiId(raw) {
  const v = String(raw || '').trim();
  if (!v) return { ok: true };                    // blank = feature off
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(v)) {
    return { ok: false, error: 'A UPI ID looks like name@bank — check it in your payment app.' };
  }
  if (v.includes(' ')) return { ok: false, error: 'A UPI ID cannot contain spaces.' };

  const handle = v.split('@')[1].toLowerCase();
  if (!KNOWN_PSP.includes(handle)) {
    return {
      ok: true,
      warn: `"@${handle}" isn't a handle we recognise. Double-check it against your payment app — ` +
            `money sent to a wrong UPI ID does not come back.`,
    };
  }
  return { ok: true };
}

/** Bank UTR / RRN as shown in a UPI app: exactly 12 digits. */
export function validateUtr(raw) {
  const v = String(raw || '').replace(/\s+/g, '');
  if (!v) return { ok: false, error: 'Enter the reference from your payment app.' };
  if (!/^\d+$/.test(v)) return { ok: false, error: 'The reference is digits only.' };
  if (v.length !== 12) {
    return { ok: false, error: `That is ${v.length} digits — a UPI reference is 12.` };
  }
  return { ok: true, value: v };
}

export function validateEmail(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return { ok: false, error: 'An email address is required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) {
    return { ok: false, error: 'That email address does not look right.' };
  }
  return { ok: true, value: v };
}

/** Indian mobile: 10 digits starting 6-9. */
export function validatePhone(raw) {
  const v = String(raw || '').replace(/\D/g, '');
  if (!v) return { ok: false, error: 'A phone number is required.' };
  if (v.length !== 10) return { ok: false, error: `That is ${v.length} digits — a mobile number is 10.` };
  if (!/^[6-9]/.test(v)) return { ok: false, error: 'An Indian mobile number starts with 6, 7, 8 or 9.' };
  return { ok: true, value: v };
}

/** WhatsApp number stored with country code, digits only. */
export function validateWhatsApp(raw) {
  const v = String(raw || '').replace(/\D/g, '');
  if (!v) return { ok: false, error: 'A WhatsApp number is required.' };
  if (v.length < 11 || v.length > 15) {
    return { ok: false, error: 'Include the country code, e.g. 919949785344.' };
  }
  return { ok: true, value: v };
}

export function validateMoney(raw, { min = 0, max = 1000000, label = 'Amount' } = {}) {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (n < min) return { ok: false, error: `${label} cannot be below ${min}.` };
  if (n > max) return { ok: false, error: `${label} looks too high — check the figure.` };
  return { ok: true, value: Math.round(n) };
}

export function validatePercent(raw, label = 'Discount') {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (n < 0 || n > 90) return { ok: false, error: `${label} must be between 0 and 90%.` };
  return { ok: true, value: Math.round(n) };
}

/**
 * Photo fields accept more than an absolute URL, so `type="url"` was the
 * wrong control: it rejected `assets/hostel-exterior.jpg`, which is the
 * app's OWN default value, and the browser blocked the save with "Please
 * enter a URL". resolvePhotoUrl() in app.js resolves three forms, and this
 * mirrors it: an http(s) URL, a data: URI, or a site-relative path.
 * Blank is allowed and falls back to the bundled default.
 */
export function validatePhotoUrl(raw, label = 'Photo') {
  const v = String(raw || '').trim();
  if (!v) return { ok: true, value: '' };

  if (/^https?:\/\//i.test(v)) {
    try { new URL(v); } catch { return { ok: false, error: `${label}: that URL is malformed.` }; }
    return { ok: true, value: v };
  }
  if (/^data:image\//i.test(v)) return { ok: true, value: v };

  // A relative path. Reject a protocol-ish prefix so a typo like
  // "htp://..." or a javascript: URI cannot slip through as a "path".
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    return { ok: false, error: `${label}: use an https:// link or a path like assets/room.jpg.` };
  }
  if (/^\.{0,2}\/?[\w.-]+(\/[\w.-]+)*\.(jpe?g|png|webp|avif|gif|svg)$/i.test(v)) {
    return { ok: true, value: v };
  }
  return { ok: false, error: `${label}: use an https:// link or a path like assets/room.jpg.` };
}

/** Attach/remove the shared invalid styling and an inline message. */
export function markField(el, result, msgEl) {
  if (!el) return result;
  el.classList.toggle('is-invalid', !result.ok);
  el.classList.toggle('is-warned', Boolean(result.ok && result.warn));
  if (msgEl) {
    const text = result.error || result.warn || '';
    msgEl.textContent = text;
    msgEl.className = 'field-msg' + (result.error ? ' is-err' : result.warn ? ' is-warn' : '');
    msgEl.hidden = !text;
  }
  return result;
}
