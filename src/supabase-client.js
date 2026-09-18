/* ===================================================================
   Supabase client + data layer
   -------------------------------------------------------------------
   Replaces localStorage for anything that must be shared between the
   manager and visitors: site config, bed inventory, booking enquiries.

   Only the anon key ships to the browser. Every write is gated by row
   level security (see supabase/schema.sql), so a visitor editing this
   file in devtools still cannot change pricing or read enquiries.
   =================================================================== */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!supabaseReady) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — ' +
    'falling back to local-only mode. Config changes will not be shared.'
  );
}

export const supabase = supabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;

/* ---------------- site config ---------------- */

/** Read the shared config. Returns null if unavailable (caller falls back). */
export async function fetchSiteConfig() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('site_config')
    .select('pricing, texts, photos, inventory')
    .eq('id', 'main')
    .single();
  if (error) {
    console.warn('[supabase] config read failed:', error.message);
    return null;
  }
  return data;
}

/** Write the shared config. Requires a signed-in manager; RLS enforces it. */
export async function saveSiteConfig(cfg) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('site_config')
    .update({
      pricing: cfg.pricing,
      texts: cfg.texts,
      photos: cfg.photos,
      inventory: cfg.inventory,
      updated_at: new Date().toISOString(),
      updated_by: user ? user.id : null
    })
    .eq('id', 'main');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ---------------- bookings ---------------- */

export function getLocalBookings() {
  try {
    return JSON.parse(localStorage.getItem('hostel_local_bookings') || '[]');
  } catch {
    return [];
  }
}

export function saveLocalBooking(b) {
  try {
    const list = getLocalBookings();
    const idx = list.findIndex(x => x.ref === b.ref);
    const item = {
      ...b,
      status: b.status || 'pending',
      paymentStatus: b.paymentStatus || (b.payment_status || 'unpaid'),
      utr: b.upi_utr || b.utr || '',
      createdAt: b.createdAt || new Date().toISOString(),
      time: b.time || 'Just now'
    };
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...item };
    } else {
      list.unshift(item);
    }
    localStorage.setItem('hostel_local_bookings', JSON.stringify(list));
  } catch (err) {
    console.warn('[local-bookings] save failed:', err);
  }
}

export function updateLocalBooking(ref, patch) {
  try {
    const list = getLocalBookings();
    const idx = list.findIndex(x => x.ref === ref);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      localStorage.setItem('hostel_local_bookings', JSON.stringify(list));
      return list[idx];
    }
  } catch (err) {
    console.warn('[local-bookings] update failed:', err);
  }
  return null;
}

/** Visitor-side: submit an enquiry. Allowed for anon by RLS. */
export async function submitBooking(b) {
  saveLocalBooking(b);
  if (!supabase) return { ok: true };
  const { error } = await supabase.from('bookings').insert({
    ref: b.ref,
    name: b.name,
    phone: b.phone,
    floor: b.floor,
    room: b.room,
    move_in_date: b.date,
    duration: b.duration,
    workplace: b.workplace,
    email: b.email || null,
    status: b.status || 'pending',
    payment_status: b.paymentStatus || 'unpaid',
    payment_amount: b.payment_amount || (b.payable_move_in ? parseInt(String(b.payable_move_in).replace(/[^\d]/g, ''), 10) : (b.security_deposit ? parseInt(String(b.security_deposit).replace(/[^\d]/g, ''), 10) : null)),
    upi_utr: b.upi_utr || b.utr || null
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Ask the server to send a booking email.
 *
 *   'enquiry'  acknowledgement on submit — no invoice, nothing is confirmed yet
 *   'receipt'  paid invoice + PDF, after a manager verified the token
 *
 * Only the reference and type are sent. The Edge Function reads every detail
 * from the database, and refuses a receipt unless it can see payment_status
 * is already 'paid' — so asking for one proves nothing.
 */
export async function sendInvoiceEmail(ref, type = 'enquiry', extra = {}) {
  // Try local dev SMTP relay first if running locally
  try {
    const localRes = await fetch('/api/send-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, type, ...extra })
    });
    if (localRes.ok) {
      const json = await localRes.json();
      if (json.ok) return { ok: true, ...json };
    }
  } catch { /* fallback to supabase function */ }

  if (!supabase || !ref) return { ok: false, error: 'Supabase not configured' };
  try {
    const { data, error } = await supabase.functions.invoke('send-invoice', {
      body: { ref, type, ...extra }
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Manager-side: list enquiries. Returns [] for non-managers (RLS). */
export async function fetchBookings() {
  const local = getLocalBookings();
  let remote = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[supabase] bookings read failed:', error.message);
      } else if (data) {
        remote = data.map(r => ({
          status: r.status || (r.payment_status === 'paid' ? 'accepted' : 'pending'),
          paymentStatus: r.payment_status,
          utr: r.upi_utr,
          receiptSentAt: r.receipt_sent_at,
          email: r.email,
          paidAt: r.paid_at,
          paymentAmount: r.payment_amount,
          payable_move_in: r.payable_move_in || (r.payment_amount ? `₹${Number(r.payment_amount).toLocaleString('en-IN')}` : undefined),
          security_deposit: r.security_deposit || '₹5,400',
          ref: r.ref,
          name: r.name,
          phone: r.phone,
          floor: r.floor,
          room: r.room,
          date: r.move_in_date,
          duration: r.duration,
          workplace: r.workplace,
          time: relativeTime(r.created_at),
          createdAt: r.created_at
        }));
      }
    } catch (e) {
      console.warn('[supabase] bookings read error:', e);
    }
  }

  // Merge remote and local by ref
  const map = new Map();
  for (const item of remote) {
    if (item && item.ref) map.set(item.ref, item);
  }
  for (const item of local) {
    if (item && item.ref) {
      if (map.has(item.ref)) {
        map.set(item.ref, { ...map.get(item.ref), ...item });
      } else {
        map.set(item.ref, item);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const da = new Date(a.createdAt || 0).getTime();
    const db = new Date(b.createdAt || 0).getTime();
    return db - da;
  });
}

/**
 * Manager-side: accept a booking and confirm the UPI UTR.
 * Marks payment as paid, status as accepted, records UTR, and emails verified receipt PDF.
 */
export async function acceptBookingWithUtr(ref, utr, extra = {}) {
  const now = new Date().toISOString();
  const extraBooking = extra.booking || {};
  updateLocalBooking(ref, {
    status: 'accepted',
    paymentStatus: 'paid',
    payment_status: 'paid',
    isVerified: true,
    utr: utr,
    upi_utr: utr,
    paidAt: now,
    ...(extraBooking.payable_move_in ? { payable_move_in: extraBooking.payable_move_in } : {}),
    ...(extraBooking.security_deposit ? { security_deposit: extraBooking.security_deposit } : {}),
    ...(extraBooking.payment_amount ? { payment_amount: extraBooking.payment_amount, paymentAmount: extraBooking.payment_amount } : {})
  });

  if (supabase) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from('bookings')
        .update({
          status: 'accepted',
          payment_status: 'paid',
          upi_utr: utr,
          paid_at: now,
          verified_by: user?.id ?? null
        })
        .eq('ref', ref);
    } catch (err) {
      console.warn('[supabase] accept update failed:', err);
    }
  }

  try {
    const mail = await sendInvoiceEmail(ref, 'receipt', extra);
    if (!mail.ok) console.warn('[receipt] invoice mail not sent:', mail.error);
    return { ok: true, receipt: mail.ok };
  } catch (err) {
    console.warn('[receipt] invoice mail threw:', err);
    return { ok: true, receipt: false, error: err.message };
  }
}

/** Manager-side: reject an enquiry. */
export async function rejectBooking(ref) {
  updateLocalBooking(ref, { status: 'rejected' });
  if (supabase) {
    try {
      await supabase
        .from('bookings')
        .update({ status: 'rejected' })
        .eq('ref', ref);
    } catch (err) {
      console.warn('[supabase] reject update failed:', err);
    }
  }
  return { ok: true };
}

/**
 * Manager-side: confirm the money actually arrived.
 * RLS restricts this to accounts in the managers table.
 */
export async function markBookingPaid(ref, paid = true) {
  updateLocalBooking(ref, {
    paymentStatus: paid ? 'paid' : 'unpaid',
    status: paid ? 'accepted' : 'pending',
    paidAt: paid ? new Date().toISOString() : null
  });
  if (!supabase) return { ok: true };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('bookings')
    .update(paid
      ? { payment_status: 'paid', status: 'accepted', paid_at: new Date().toISOString(), verified_by: user?.id ?? null }
      : { payment_status: 'unpaid', status: 'pending', paid_at: null, verified_by: null })
    .eq('ref', ref);
  if (error) return { ok: false, error: error.message };

  if (paid) {
    const mail = await sendInvoiceEmail(ref, 'receipt');
    if (!mail.ok) console.warn('[receipt] not sent:', mail.error);
    return { ok: true, receipt: mail.ok };
  }
  return { ok: true };
}

/** Manager-side: clear all enquiries. */
export async function clearBookings() {
  localStorage.removeItem('hostel_local_bookings');
  if (!supabase) return { ok: true };
  const { error } = await supabase.from('bookings').delete().neq('ref', '');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Push new enquiries to an open manager dashboard. */
export function onBookingsChange(cb) {
  if (!supabase) return () => {};
  const ch = supabase
    .channel('bookings-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, cb)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/* ---------------- auth ---------------- */

export async function signIn(email, password) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };

  // A password alone is not enough if the account has an authenticator
  // enrolled — Supabase reports that via the assurance level.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
    return { ok: true, mfaRequired: true, user: data.user };
  }
  return { ok: true, mfaRequired: false, user: data.user };
}

/** Second step: verify the 6-digit code from the authenticator app. */
export async function verifyMfaCode(code) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
  if (fErr) return { ok: false, error: fErr.message };
  const totp = (factors.totp || []).find(f => f.status === 'verified');
  if (!totp) return { ok: false, error: 'No authenticator enrolled on this account' };

  const { data: chal, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
  if (cErr) return { ok: false, error: cErr.message };

  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId: totp.id, challengeId: chal.id, code
  });
  if (vErr) return { ok: false, error: vErr.message };
  return { ok: true };
}

/**
 * Enrol an authenticator app. Returns a QR to scan.
 *
 * Abandoning enrolment (the "Skip for now" path) leaves an unverified factor
 * behind, and Supabase rejects a second enrol with the same friendly name.
 * So clear stale unverified factors first and always use a unique name.
 */
export async function enrollAuthenticator() {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  const { data: existing } = await supabase.auth.mfa.listFactors();
  if (existing) {
    for (const f of (existing.all || existing.totp || [])) {
      if (f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Manager device ${new Date().toISOString().replace(/[:.]/g, '-')}`
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirm enrolment with the first code the app shows. */
export async function confirmAuthenticator(factorId, code) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data: chal, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr) return { ok: false, error: cErr.message };
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: chal.id, code });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

/** True only if the signed-in user is listed in the managers table. */
export async function isManager() {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('managers').select('user_id').eq('user_id', user.id).maybeSingle();
  return !error && Boolean(data);
}

export async function currentUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function hasAuthenticator() {
  if (!supabase) return false;
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  return (data.totp || []).some(f => f.status === 'verified');
}

/* ---------------- helpers ---------------- */

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
