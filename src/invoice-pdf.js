import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const ORANGE   = rgb(0.792, 0.306, 0.0);   // #ca4e00
const DARK     = rgb(0.067, 0.075, 0.094); // #111318
const MUTED    = rgb(0.42, 0.45, 0.49);    // #6b7280
const LIGHT_BG = rgb(0.97, 0.975, 0.98);   // #f8f9fa
const LINE     = rgb(0.88, 0.89, 0.91);    // #e2e4e8
const GREEN    = rgb(0.086, 0.627, 0.345); // #16a34a
const CARD_BG  = rgb(0.996, 0.965, 0.941);// #fff7ed
const CARD_BD  = rgb(0.992, 0.843, 0.718);// #fed7aa
const GREEN_BG = rgb(0.941, 0.992, 0.957);// #f0fdf4
const GREEN_BD = rgb(0.533, 0.898, 0.678);// #88e5ad

const A4 = { w: 595.28, h: 841.89 };
const M = 40; // 40pt margin

/** Strip characters not encodable in standard WinAnsi Helvetica and normalize currency */
function cleanStr(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/₹/g, 'Rs. ')
    .replace(/[•●]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[^ -~ -ÿ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format INR number with Rs. prefix
 */
export function formatRs(amount) {
  if (typeof amount === 'string') {
    const num = parseInt(amount.replace(/[^\d]/g, ''), 10);
    if (!isNaN(num)) return 'Rs. ' + num.toLocaleString('en-IN');
    return cleanStr(amount);
  }
  if (typeof amount === 'number' && !isNaN(amount)) {
    return 'Rs. ' + amount.toLocaleString('en-IN');
  }
  return 'Rs. 0';
}

/**
 * Build the full vector PDF invoice bytes
 */
export async function buildInvoicePdfDoc(b, h = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${cleanStr(b.ref || 'CMPG')}`);
  doc.setSubject(`Booking Invoice - ${cleanStr(h.name || 'Chaitanya Mens PG & Hostel')}`);
  doc.setProducer(cleanStr(h.name || 'Chaitanya Mens PG & Hostel'));

  const page = doc.addPage([A4.w, A4.h]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const obliq = await doc.embedFont(StandardFonts.HelveticaOblique);

  const text = (s, x, y, size = 9.5, font = reg, color = DARK) => {
    page.drawText(cleanStr(s), { x, y, size, font, color });
  };

  const textR = (s, xRight, y, size = 9.5, font = reg, color = DARK) => {
    const str = cleanStr(s);
    const w = font.widthOfTextAtSize(str, size);
    page.drawText(str, { x: xRight - w, y, size, font, color });
  };

  const rule = (y, x1 = M, x2 = A4.w - M, color = LINE, thickness = 0.75) => {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  };

  // 1. TOP HEADER BRAND BANNER (92pt tall)
  const headerH = 92;
  page.drawRectangle({
    x: 0,
    y: A4.h - headerH,
    width: A4.w,
    height: headerH,
    color: ORANGE,
  });

  const hostelName = h.name || 'Chaitanya Mens PG & Hostel';
  text(hostelName, M, A4.h - 44, 18, bold, rgb(1, 1, 1));
  text('Executive Living & Student PG - Naimnagar, Hanamkonda', M, A4.h - 64, 9.5, reg, rgb(1, 0.92, 0.86));
  text('STAY | STUDY | GROW', M, A4.h - 78, 8, bold, rgb(1, 0.85, 0.75));

  textR('OFFICIAL INVOICE', A4.w - M, A4.h - 44, 16, bold, rgb(1, 1, 1));
  textR(b.ref || '#CMPG-BOOKING', A4.w - M, A4.h - 64, 11, bold, rgb(1, 0.92, 0.86));
  textR('CONFIRMED RESERVATION', A4.w - M, A4.h - 78, 8, bold, rgb(1, 0.85, 0.75));

  let curY = A4.h - headerH - 24;

  // 2. METADATA SUMMARY BAR
  const issueDate = b.dateIssued || new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const isAccepted = b.status === 'accepted' ||
                     b.paymentStatus === 'paid' ||
                     b.payment_status === 'paid' ||
                     b.isVerified === true ||
                     b.verified === true ||
                     !!b.paidAt ||
                     !!b.paid_at;

  const totalPayableVal = parseInt(String(b.payable_move_in || b.payableOnMoveIn || b.dueOnMoveIn || b.total || b.stayTotal || '13900').replace(/[^\d]/g, ''), 10) || 13900;
  const totalPayableStr = 'Rs. ' + totalPayableVal.toLocaleString('en-IN');
  const depositVal = parseInt(String(b.security_deposit || b.deposit || '5400').replace(/[^\d]/g, ''), 10) || 5400;
  const depositStr = 'Rs. ' + depositVal.toLocaleString('en-IN');
  const rawUtr = (b.upi_utr || b.utr || '').trim();
  let amountPaidVal = totalPayableVal;
  if (b.payment_amount) {
    const pAmt = parseInt(String(b.payment_amount).replace(/[^\d]/g, ''), 10);
    if (pAmt >= totalPayableVal) amountPaidVal = pAmt;
  }
  const amountPaidStr = 'Rs. ' + amountPaidVal.toLocaleString('en-IN');
  const balanceDueVal = Math.max(0, totalPayableVal - amountPaidVal);
  const balanceDueStr = balanceDueVal > 0 ? ('Rs. ' + balanceDueVal.toLocaleString('en-IN')) : 'Rs. 0 (Fully Paid)';

  page.drawRectangle({
    x: M,
    y: curY - 34,
    width: A4.w - M * 2,
    height: 42,
    color: LIGHT_BG,
    borderColor: LINE,
    borderWidth: 0.8,
  });

  const colW = (A4.w - M * 2) / 4;
  text('INVOICE DATE', M + 14, curY - 6, 7.5, bold, MUTED);
  text(issueDate, M + 14, curY - 22, 10, bold, DARK);

  text('PAYMENT STATUS', M + colW + 10, curY - 6, 7.5, bold, MUTED);
  if (isAccepted) {
    text('Verified & Confirmed', M + colW + 10, curY - 22, 9.5, bold, GREEN);
  } else {
    text('Pending Move-In Validation', M + colW + 10, curY - 22, 9, bold, ORANGE);
  }

  text('PAYMENT MODE', M + colW * 2 + 10, curY - 6, 7.5, bold, MUTED);
  text('UPI Instant Transfer', M + colW * 2 + 10, curY - 22, 10, bold, DARK);

  text('TOTAL AMOUNT', M + colW * 3 + 10, curY - 6, 7.5, bold, MUTED);
  text(totalPayableStr, M + colW * 3 + 10, curY - 22, 10.5, bold, ORANGE);

  curY -= 54;

  // 3. TWO-COLUMN: BILLED TO vs HOSTEL CONTACT
  const midX = M + (A4.w - M * 2) * 0.50;

  text('BILLED TO (RESIDENT)', M, curY, 8.5, bold, ORANGE);
  text('HOSTEL DETAILS', midX, curY, 8.5, bold, ORANGE);
  curY -= 8;
  rule(curY, M, midX - 16);
  rule(curY, midX, A4.w - M);

  curY -= 15;
  text(b.name || 'Resident Name', M, curY, 11, bold, DARK);
  text(hostelName, midX, curY, 10.5, bold, DARK);

  curY -= 14;
  text(`Phone: ${b.phone || '-'}`, M, curY, 8.5, reg, DARK);
  text('18-5-38/1, Beside Siva Kumar Clinic,', midX, curY, 8.5, reg, MUTED);

  curY -= 12;
  if (b.email) text(`Email: ${b.email}`, M, curY, 8.5, reg, MUTED);
  text('Venkateshwara Colony, Naimnagar,', midX, curY, 8.5, reg, MUTED);

  curY -= 12;
  if (b.workplace) text(`College/Org: ${b.workplace}`, M, curY, 8.5, reg, MUTED);
  text('Hanamkonda, Telangana - 506001', midX, curY, 8.5, reg, MUTED);

  curY -= 12;
  const hostelEmail = (h.email && h.email !== 'jareenaworks@gmail.com') ? h.email : 'chaitnyamenspg@gmail.com';
  text(`Phone: ${h.phone || '+91 99497 85344'} | ${hostelEmail}`, midX, curY, 8, reg, MUTED);

  curY -= 20;

  // 4. BOOKING PARTICULARS & PRICING BREAKDOWN TABLE
  text('BOOKING & ACCOMMODATION CHARGES', M, curY, 8.5, bold, DARK);
  textR('DETAILS / AMOUNT', A4.w - M, curY, 8.5, bold, DARK);
  curY -= 6;
  rule(curY, M, A4.w - M, DARK, 1.2);
  curY -= 16;

  const tableRows = [
    { label: 'Room Sharing Accommodation', val: b.room || '2 Sharing' },
    { label: 'Climate / Ventilation Plan', val: b.climate || 'Non-AC' },
    { label: 'Preferred Floor', val: b.floor || 'Any Floor' },
    { label: 'Scheduled Move-In Date', val: b.date || b.move_in_date || '-' },
    { label: 'Intended Stay Duration', val: b.duration || '1 Month' },
    { label: 'Monthly Subtotal (Rent)', val: formatRs(b.monthly_rent || b.monthly || '8500') + ' / mo' },
  ];

  if (b.term_savings && b.term_savings !== '- Rs. 0' && b.term_savings !== '0') {
    tableRows.push({
      label: 'Long-term Savings / Discount',
      val: cleanStr(b.term_savings),
      highlight: GREEN,
    });
  }

  tableRows.push({
    label: 'Security Deposit (100% Refundable)',
    val: depositStr,
    note: 'Refunded upon move-out',
  });

  tableRows.push({
    label: 'Total Move-In Charges',
    val: totalPayableStr,
    sub: b.move_in_scope || "First month's rent + deposit",
  });

  tableRows.push({
    label: isAccepted ? 'Total Move-In Paid via UPI' : 'Total Move-In Submitted via UPI',
    val: `- ${amountPaidStr}`,
    highlight: GREEN,
    note: isAccepted
      ? (rawUtr ? `UTR: ${rawUtr} (Verified & Approved)` : 'Verified & Approved')
      : (rawUtr ? `UTR: ${rawUtr} (Pending move-in validation)` : 'To be validated'),
  });

  tableRows.push({
    label: 'Remaining Balance Due on Move-In',
    val: balanceDueStr,
    isTotal: true,
    sub: balanceDueVal > 0 ? 'Payable on check-in / room handover' : 'All move-in charges fully settled (Rent + Security Deposit)',
  });

  for (const r of tableRows) {
    if (r.isTotal) {
      curY -= 4;
      rule(curY, M, A4.w - M, ORANGE, 1.2);
      curY -= 18;

      page.drawRectangle({
        x: M,
        y: curY - 14,
        width: A4.w - M * 2,
        height: 32,
        color: rgb(0.99, 0.95, 0.92),
      });

      text(r.label, M + 10, curY + 2, 10.5, bold, DARK);
      if (r.sub) text(r.sub, M + 10, curY - 9, 7.5, reg, MUTED);
      textR(r.val, A4.w - M - 10, curY - 2, 12, bold, ORANGE);

      curY -= 26;
    } else {
      text(r.label, M + 8, curY, 9, reg, DARK);
      if (r.note) {
        text(`(${r.note})`, M + 8 + bold.widthOfTextAtSize(r.label, 9) + 6, curY, 7.5, obliq, MUTED);
      }
      textR(r.val, A4.w - M - 8, curY, 9.5, bold, r.highlight || DARK);
      curY -= 10;
      rule(curY, M, A4.w - M, LINE, 0.5);
      curY -= 14;
    }
  }

  curY -= 6;

  // 5. PAYMENT STATUS CARD (Highlighted)
  page.drawRectangle({
    x: M,
    y: curY - 60,
    width: A4.w - M * 2,
    height: 68,
    color: isAccepted ? GREEN_BG : CARD_BG,
    borderColor: isAccepted ? GREEN_BD : CARD_BD,
    borderWidth: 1.2,
  });

  if (isAccepted) {
    text('TOTAL MOVE-IN PAYMENT VERIFIED & CONFIRMED', M + 16, curY - 12, 8.5, bold, GREEN);
    text('Note: Full move-in payment (Rent + Refundable Deposit) verified against bank records. Bed confirmed.', M + 16, curY - 26, 8, obliq, MUTED);
    const utrDisplay = rawUtr ? `Verified Bank UTR: ${rawUtr}` : 'Verified by Hostel Management';
    text(utrDisplay, M + 16, curY - 44, 9.5, bold, DARK);
    textR(amountPaidStr, A4.w - M - 18, curY - 20, 18, bold, DARK);
    textR('Full Payment (Paid)', A4.w - M - 18, curY - 40, 8.5, bold, GREEN);
  } else {
    text('TOTAL MOVE-IN PAYMENT SUBMITTED — PENDING VALIDATION', M + 16, curY - 12, 8.5, bold, ORANGE);
    text('Note: Total move-in payment (Rent + Deposit) will be verified by the manager before move-in.', M + 16, curY - 26, 8, obliq, MUTED);
    const utrDisplay = rawUtr ? `UPI Ref (UTR): ${rawUtr}` : 'UPI Ref (UTR): Pending Submission';
    text(utrDisplay, M + 16, curY - 44, 9.5, bold, DARK);
    textR(amountPaidStr, A4.w - M - 18, curY - 20, 18, bold, DARK);
    textR('Full Payment (Submitted)', A4.w - M - 18, curY - 40, 8.5, bold, GREEN);
  }

  curY -= 80;

  // 6. TERMS & POLICIES SUMMARY
  text('HOSTEL POLICIES & IMPORTANT INFORMATION', M, curY, 8, bold, DARK);
  curY -= 6;
  rule(curY, M, A4.w - M);
  curY -= 14;

  const validationNote = isAccepted
    ? '- Payment Validation: Verified and officially accepted by hostel management against bank credit records.'
    : '- Payment Validation: This payment is not yet validated. The warden will verify the 12-digit UTR against bank records before you move in.';

  const notes = [
    validationNote,
    '- 100% Refundable Deposit: The security deposit is refunded within 3 days of vacating with 30 days notice.',
    '- Inclusions: 3 daily hygienic homely meals, high-speed Wi-Fi, 24/7 CCTV, RO purified water, biometric access.',
    '- Visiting Hours: 24/7 access with biometric security for enrolled hostel residents.',
  ];

  for (const n of notes) {
    text(n, M + 4, curY, 8, reg, MUTED);
    curY -= 12;
  }

  // 7. FOOTER
  rule(M + 36, M, A4.w - M, LINE, 0.8);
  text(`${hostelName} - Official Booking Receipt`, M, M + 22, 8.5, bold, DARK);
  text('18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda | +91 99497 85344', M, M + 10, 7.5, reg, MUTED);
  textR('Computer generated - valid without physical signature', A4.w - M, M + 16, 7.5, obliq, MUTED);

  return await doc.save();
}

/**
 * Trigger immediate browser download of the PDF
 */
export async function downloadInvoicePdf(booking, hostel) {
  try {
    const pdfBytes = await buildInvoicePdfDoc(booking, hostel);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeRef = (booking.ref || 'Booking').replace(/[^a-zA-Z0-9_-]/g, '');
    link.href = url;
    link.download = `Invoice-${safeRef}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (err) {
    console.error('[invoice] download failed:', err);
    return false;
  }
}
