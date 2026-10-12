/**
 * Invoice email template.
 *
 * Email clients are not browsers: Gmail strips <style> blocks in some views,
 * Outlook uses Word for layout. So this uses table layout, inline styles,
 * and web-safe fonts only — no flexbox, no grid, no external CSS.
 */

import { calculateStayPeriod } from "./invoice-pdf.ts";

export interface Booking {
  ref: string;
  name: string;
  phone: string;
  email?: string | null;
  room?: string | null;
  floor?: string | null;
  move_in_date?: string | null;
  duration?: string | null;
  workplace?: string | null;
  upi_utr?: string | null;
  created_at?: string;
  monthly_rent?: string | null;
  security_deposit?: string | null;
  payable_move_in?: string | null;
  stay_period?: string | null;
  payment_mode?: string | null;
  advance_amount?: number | string | null;
  balance_amount?: number | string | null;
}

export interface Hostel {
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
}

const ORANGE = "#ca4e00";
const INK = "#1b1d21";
const MUTED = "#6b7280";
const LINE = "#e6e8eb";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function row(label: string, value: string, last = false) {
  return `
  <tr>
    <td style="padding:11px 0;${last ? "" : `border-bottom:1px solid ${LINE};`}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};">${esc(label)}</td>
    <td align="right" style="padding:11px 0;${last ? "" : `border-bottom:1px solid ${LINE};`}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:bold;">${esc(value)}</td>
  </tr>`;
}

/** Plain-text alternative. Every email should carry one. */
export function invoiceText(b: Booking, h: Hostel, forManager = false, hasPdf = false, isReceipt = false): string {
  const stayPeriod = b.stay_period || (b.move_in_date ? calculateStayPeriod(b.move_in_date, b.duration) : null);
  const isCash = b.payment_mode === "cash" || String(b.payment_mode || "").toLowerCase().includes("cash");
  const isAdvance = b.payment_mode === "advance" || String(b.payment_mode || "").toLowerCase().includes("advance");
  const advStr = b.advance_amount ? `Rs. ${Number(b.advance_amount).toLocaleString("en-IN")}` : "Rs. 1,000";
  const balStr = b.balance_amount !== undefined && b.balance_amount !== null ? `Rs. ${Number(b.balance_amount).toLocaleString("en-IN")}` : "";

  const paymentOptionText = isCash
    ? "Cash on Hand (Pay at Hostel upon Arrival)"
    : isAdvance
    ? `Advance Token (${advStr} Paid via UPI, Balance ${balStr || "due on move-in"})`
    : "UPI / Online Transfer";

  return [
    isReceipt
      ? (forManager
          ? (isCash ? `Cash Booking Verified — ${h.name}` : (isAdvance ? `Advance Token Verified — ${h.name}` : `Token verified — ${h.name}`))
          : (isCash ? `Booking Confirmed (Cash) — ${h.name}` : (isAdvance ? `Advance Token Verified — ${h.name}` : `Payment received — ${h.name}`)))
      : (forManager ? `New booking enquiry — ${h.name}` : `Booking enquiry received — ${h.name}`),
    ``,
    `Reference: ${b.ref}`,
    `Name: ${b.name}`,
    `Phone: ${b.phone}`,
    b.email ? `Email: ${b.email}` : ``,
    `Payment Option: ${paymentOptionText}`,
    b.room ? `Room: ${b.room}` : ``,
    b.floor ? `Preferred floor: ${b.floor}` : ``,
    b.move_in_date ? `Move-in: ${b.move_in_date}` : ``,
    stayPeriod ? `Stay Period: ${stayPeriod}` : ``,
    b.duration ? `Stay: ${b.duration}` : ``,
    b.monthly_rent ? `Monthly Rent: ${b.monthly_rent} / mo` : ``,
    b.security_deposit ? `Security Deposit: ${b.security_deposit}` : ``,
    b.payable_move_in ? `Total Move-In Charges: ${b.payable_move_in}` : ``,
    isAdvance ? `Advance Token (UPI): ${advStr}` : ``,
    isAdvance && balStr ? `Remaining Balance Due (Move-in): ${balStr}` : ``,
    b.workplace ? `College / Company: ${b.workplace}` : ``,
    ``,
    hasPdf ? `Your invoice is attached to this email as a PDF.` : ``,
    isReceipt && b.upi_utr ? `UPI reference: ${b.upi_utr}` : ``,
    ``,
    forManager
      ? `Contact the applicant on ${b.phone}.`
      : (isReceipt
          ? (isCash
              ? `Your Cash on Hand booking is recorded and your bed is held. Please pay upon arrival at the hostel.`
              : isAdvance
              ? `Your Advance Token payment (${advStr}) has been verified and your bed is held. Remaining balance (${balStr}) is payable upon move-in.`
              : `Your payment has been verified and your bed is held. The manager will be in touch about move-in.`)
          : (isCash
              ? `This is a Cash on Hand enquiry. The manager will contact you on ${b.phone} to confirm bed availability. Payment is collected upon check-in.`
              : isAdvance
              ? `This is an Advance Token enquiry. Pay the ${advStr} advance via UPI to hold your bed. Remaining balance (${balStr}) is payable upon arrival.`
              : `This is an enquiry, not a confirmed booking. The manager will contact you on ${b.phone} to confirm bed availability.`)),
    ``,
    `${h.name}`,
    `${h.address}`,
    `Phone: ${h.phone}`,
  ].filter(Boolean).join("\n");
}

export function invoiceHtml(b: Booking, h: Hostel, forManager = false, hasPdf = false, isReceipt = false): string {
  const isCash = b.payment_mode === "cash" || String(b.payment_mode || "").toLowerCase().includes("cash");
  const isAdvance = b.payment_mode === "advance" || String(b.payment_mode || "").toLowerCase().includes("advance");
  const advStr = b.advance_amount ? `Rs. ${Number(b.advance_amount).toLocaleString("en-IN")}` : "Rs. 1,000";
  const balStr = b.balance_amount !== undefined && b.balance_amount !== null ? `Rs. ${Number(b.balance_amount).toLocaleString("en-IN")}` : "";

  const first = esc(b.name.split(" ")[0] || b.name);
  const title = isReceipt
    ? (forManager
        ? (isCash ? "Cash Booking Verified" : (isAdvance ? "Advance Token Verified" : "Payment verified"))
        : (isCash ? "Booking Confirmed (Cash on Hand)" : (isAdvance ? "Advance Token Verified" : "Payment received")))
    : (forManager ? "New booking enquiry" : "We've got your enquiry");
  const lead = isReceipt
    ? (forManager
        ? `You marked this booking as accepted. The resident has been sent their verified invoice.`
        : (isCash
            ? `Thanks ${first} — your booking is confirmed and your bed is held. Settle the move-in charges in cash upon arrival. Your verified invoice is attached.`
            : isAdvance
            ? `Thanks ${first} — your advance token of ${advStr} is verified and your bed is reserved! The remaining balance of ${balStr} is due upon arrival. Your verified invoice is attached.`
            : `Thanks ${first} — your booking token is confirmed and your bed is held. Your invoice is attached.`))
    : (forManager
        ? `A new enquiry came in from the website. Payment option: ${isCash ? "Cash on Hand" : (isAdvance ? "Advance Token" : "UPI Transfer")}.`
        : `Thanks ${first} — here are your enquiry details. Keep the reference handy for your visit.`);

  const stayPeriod = b.stay_period || (b.move_in_date ? calculateStayPeriod(b.move_in_date, b.duration) : null);
  const waLink = `https://wa.me/${esc(h.whatsapp)}?text=${encodeURIComponent(`Hello, my booking reference is ${b.ref}`)}`;

  const paymentOptionDisplay = isCash
    ? "Cash on Hand (Pay at Hostel)"
    : isAdvance
    ? `Advance Token (${advStr} Now + ${balStr} on Move-in)`
    : "UPI / Online Transfer";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.ref)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <!-- preheader: shown in the inbox list, hidden in the body -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${esc(b.ref)} · ${esc(b.room || "Bed enquiry")} · ${esc(b.move_in_date || "")}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE};">

        <tr>
          <td style="background:${isReceipt ? "#1da851" : ORANGE};padding:22px 28px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;">${esc(h.name)}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${isReceipt ? "#d6f5e3" : "#ffe9dc"};padding-top:3px;">Mens PG &amp; Hostel · Hanamkonda</div>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 28px 6px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:${INK};">${esc(title)}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${MUTED};padding-top:8px;">${lead}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fff6f0;border:1px solid #ffd9c2;border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${ORANGE};font-weight:bold;">Reference</td>
                <td align="right" style="padding:14px 16px;font-family:'Courier New',Courier,monospace;font-size:17px;font-weight:bold;color:${INK};">${esc(b.ref)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("Name", b.name)}
              ${row("Phone", b.phone)}
              ${b.email ? row("Email", b.email) : ""}
              ${row("Payment Option", paymentOptionDisplay)}
              ${isReceipt && b.upi_utr ? row("UPI reference", b.upi_utr) : ""}
              ${b.room ? row("Room", b.room) : ""}
              ${b.floor ? row("Preferred floor", b.floor) : ""}
              ${b.move_in_date ? row("Move-in date", b.move_in_date) : ""}
              ${stayPeriod ? row("Stay period", stayPeriod) : ""}
              ${b.duration ? row("Stay duration", b.duration) : ""}
              ${b.monthly_rent ? row("Monthly Rent", `${b.monthly_rent} / mo`) : ""}
              ${b.security_deposit ? row("Security Deposit", b.security_deposit) : ""}
              ${b.payable_move_in ? row("Total Move-In Charges", b.payable_move_in) : ""}
              ${isAdvance ? row("Advance Token (Paid/Reserved)", advStr) : ""}
              ${isAdvance && balStr ? row("Balance Due on Move-In", balStr) : ""}
              ${b.workplace ? row("College / Company", b.workplace, true) : ""}
            </table>
          </td>
        </tr>

        ${hasPdf ? `
        <tr>
          <td style="padding:20px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="border:1px solid ${LINE};border-radius:10px;">
              <tr>
                <td style="padding:13px 15px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};">
                  <strong>Invoice attached</strong>
                  <span style="color:${MUTED};">&nbsp;·&nbsp;PDF, download from this email</span>
                </td>
                <td align="right" style="padding:13px 15px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">
                  Invoice-${esc(b.ref.replace(/[^\w-]/g, ""))}.pdf
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ``}

        <tr>
          <td style="padding:22px 28px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" style="background:#1da851;border-radius:10px;">
                  <a href="${waLink}"
                     style="display:inline-block;padding:13px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">
                    ${forManager ? "Message the applicant" : "Chat with the manager"}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 28px 0;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};background:#f7f8f9;border-radius:9px;padding:13px 15px;">
              ${forManager
                ? `Reply to this email or call <strong style="color:${INK};">${esc(b.phone)}</strong> to follow up.`
                : (isReceipt
                    ? (isCash
                        ? `Your bed is held. Please pay cash upon move-in on <strong style="color:${INK};">${esc(b.move_in_date ?? "your chosen date")}</strong>.`
                        : isAdvance
                        ? `Your bed is reserved with ${advStr} advance token. Remaining balance of ${balStr} is payable upon move-in on <strong style="color:${INK};">${esc(b.move_in_date ?? "your chosen date")}</strong>.`
                        : `Your bed is held. The manager will be in touch about move-in on <strong style="color:${INK};">${esc(b.move_in_date ?? "your chosen date")}</strong>.`)
                    : `This is an enquiry, not a confirmed booking. The manager will contact you on <strong style="color:${INK};">${esc(b.phone)}</strong> to confirm bed availability.`)}
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 28px 28px;">
            <div style="border-top:1px solid ${LINE};padding-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:${MUTED};">
              <strong style="color:${INK};">${esc(h.name)}</strong><br>
              ${esc(h.address)}<br>
              Phone: <a href="tel:${esc(h.phone)}" style="color:${ORANGE};text-decoration:none;">${esc(h.phone)}</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
