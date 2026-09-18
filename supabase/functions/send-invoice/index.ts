/**
 * send-invoice — sends one of two emails to the guest and the manager.
 *
 *   type "enquiry"  acknowledgement on submit. NO invoice attached: at this
 *                   point nobody has paid and nothing is confirmed, so an
 *                   invoice would be a lie.
 *   type "receipt"  the real invoice + PDF, and only once the server itself
 *                   confirms payment_status = 'paid'. A caller asking for a
 *                   receipt on an unpaid booking gets a 409.
 *
 * Runs server-side so the Gmail App Password never reaches the browser.
 *
 * Security: the request carries only a booking `ref`. Every detail — including
 * the recipient address — is read from the database with the service role key.
 * A caller cannot choose who gets mailed or what the mail says, so this is not
 * an open relay. Already-sent bookings are skipped, making retries idempotent.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { invoiceHtml, invoiceText, type Booking, type Hostel } from "./template.ts";
import { buildInvoicePdf } from "./invoice-pdf.ts";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const GMAIL_USER = Deno.env.get("GMAIL_USER");
  const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return json({ error: "Mail not configured: set GMAIL_USER and GMAIL_APP_PASSWORD" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "Supabase env missing" }, 500);
  }

  let ref: string, type: string;
  try {
    ({ ref, type = "enquiry" } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!ref || typeof ref !== "string" || ref.length > 40) {
    return json({ error: "A booking ref is required" }, 400);
  }
  if (type !== "enquiry" && type !== "receipt") {
    return json({ error: "type must be 'enquiry' or 'receipt'" }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: booking, error } = await db
    .from("bookings")
    .select("ref,name,phone,email,room,floor,move_in_date,duration,workplace,created_at,enquiry_mail_sent_at,receipt_sent_at,payment_status,upi_utr,paid_at")
    .eq("ref", ref)
    .maybeSingle();

  if (error) return json({ error: "Lookup failed" }, 500);
  if (!booking) return json({ error: "Unknown booking" }, 404);
  const isReceipt = type === "receipt";

  // A receipt asserts money was received, so the server checks that itself
  // rather than trusting the caller. Nothing else can conjure one.
  if (isReceipt && booking.payment_status !== "paid") {
    return json({ error: "Booking is not marked paid" }, 409);
  }

  const alreadySent = isReceipt ? booking.receipt_sent_at : booking.enquiry_mail_sent_at;
  if (alreadySent) return json({ ok: true, skipped: "already sent" });

  // Hostel details come from the manager-editable config, so the email
  // always shows the current phone/address without a redeploy.
  const { data: cfg } = await db
    .from("site_config").select("texts,pricing").eq("id", "main").maybeSingle();
  const t = (cfg?.texts ?? {}) as Record<string, string>;
  const hostel: Hostel = {
    name: t.hostelName ?? "Chaitanya Mens PG & Hostel",
    phone: t.phone ?? "",
    whatsapp: t.whatsapp ?? "",
    email: t.email ?? GMAIL_USER,
    address: t.address ?? "",
  };

  const b = booking as Booking;
  const managerTo = hostel.email || GMAIL_USER;

  // Build the PDF once and attach the same bytes to both copies.
  // A failure here must not lose the email, so it degrades to no attachment.
  const tokenAmount = Number((cfg?.pricing as Record<string, unknown>)?.tokenAmount ?? 0);
  let pdfBase64: string | null = null;
  if (isReceipt) {
    try {
      const bytes = await buildInvoicePdf(b, hostel, {
        paid: true,
        tokenAmount,
        utr: booking.upi_utr,
      });
      pdfBase64 = btoa(String.fromCharCode(...bytes));
    } catch (err) {
      console.error("invoice pdf failed, sending without attachment:", err);
    }
  }

  const attachments = pdfBase64
    ? [{
        filename: `Invoice-${b.ref.replace(/[^\w-]/g, "")}.pdf`,
        contentType: "application/pdf",
        encoding: "base64" as const,
        content: pdfBase64,
      }]
    : [];

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });

  const sent: string[] = [];
  const failed: string[] = [];

  async function send(to: string, subject: string, forManager: boolean) {
    try {
      await client.send({
        from: `${hostel.name} <${GMAIL_USER}>`,
        to,
        replyTo: forManager ? (b.email || managerTo) : managerTo,
        subject,
        content: invoiceText(b, hostel, forManager, Boolean(pdfBase64), isReceipt),
        html: invoiceHtml(b, hostel, forManager, Boolean(pdfBase64), isReceipt),
        attachments,
      });
      sent.push(to);
    } catch (err) {
      console.error(`send to ${to} failed:`, err);
      failed.push(to);
    }
  }

  try {
    if (b.email) {
      await send(
        b.email,
        isReceipt
          ? `Payment received — invoice ${b.ref} · ${hostel.name}`
          : `We got your enquiry ${b.ref} · ${hostel.name}`,
        false,
      );
    }
    if (managerTo) {
      await send(
        managerTo,
        isReceipt
          ? `Token verified ${b.ref} — ${b.name}`
          : `New enquiry ${b.ref} — ${b.name}`,
        true,
      );
    }
  } finally {
    try { await client.close(); } catch { /* connection already gone */ }
  }

  // Only mark as sent if at least one message left, so a total failure retries.
  if (sent.length) {
    const stamp = isReceipt
      ? { receipt_sent_at: new Date().toISOString() }
      : { enquiry_mail_sent_at: new Date().toISOString() };
    await db.from("bookings").update(stamp).eq("ref", b.ref);
  }

  return json({ ok: sent.length > 0, sent, failed });
});
